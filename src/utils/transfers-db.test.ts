import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { migrate } from '../db/schema';
import { setTransferMerchant, acknowledgeAutoTransfers, backfillTransfers, countAutoTransfers, detectTransfers, markTransferByUser, rejectTransfer } from '../db/transfers';

const T = 1_760_000_000_000;
const MIN = 60_000;

async function setup() {
  const raw = new DatabaseSync(':memory:');
  const db: any = {
    execAsync: async (s: string) => raw.exec(s),
    getFirstAsync: async (s: string, ...p: any[]) => (s.includes('user_version') ? { user_version: 0 } : raw.prepare(s).get(...p)),
    getAllAsync: async (s: string, ...p: any[]) => raw.prepare(s).all(...p),
    runAsync: async (s: string, ...p: any[]) => { const r = raw.prepare(s).run(...p); return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes }; },
    withExclusiveTransactionAsync: async (fn: any) => fn(db),
  };
  await migrate(db);
  raw.exec("insert into accounts (id,name,kind,bank,last4) values (11,'Indian a/c','bank','INDIAN','1111'),(12,'Axis a/c','bank','AXIS','2222'),(13,'Axis card','card','AXIS','3333')");
  let seq = 0;
  const add = (o: { amount?: number; dir: 'debit' | 'credit'; acct: number; ts: number; mode?: string; text?: string; merchant?: string }) =>
    Number(raw.prepare("insert into transactions (amount_paise,direction,source,ts,status,account_id,payment_mode,raw_text,merchant,msg_hash) values (?,?,?,?,?,?,?,?,?,?)")
      .run(o.amount ?? 500_000, o.dir, 'sms', o.ts, 'pending', o.acct, o.mode ?? 'UPI', o.text ?? null, o.merchant ?? null, `h${++seq}`).lastInsertRowid);
  const row = (id: number) => raw.prepare('select is_transfer,transfer_auto,transfer_reason,transfer_pair_id,transfer_blocked from transactions where id=?').get(id) as any;
  return { raw, db, add, row };
}

test('own-account transfer: second leg pairs with the first', async () => {
  const { db, add, row } = await setup();
  const out = add({ dir: 'debit', acct: 12, ts: T });
  assert.equal(await detectTransfers(db, [out]), 0); // nothing to pair with yet
  const inn = add({ dir: 'credit', acct: 11, ts: T + MIN });
  assert.equal(await detectTransfers(db, [inn]), 2);
  assert.deepEqual([row(out).is_transfer, row(out).transfer_pair_id, row(out).transfer_reason], [1, inn, 'own-account transfer']);
  assert.deepEqual([row(inn).is_transfer, row(inn).transfer_pair_id], [1, out]);
  assert.equal(await countAutoTransfers(db), 2);
  await acknowledgeAutoTransfers(db);
  assert.equal(await countAutoTransfers(db), 0);
  assert.equal(row(out).is_transfer, 1); // acknowledging keeps the flag
});

test('card payment received marks itself and the funding bank debit', async () => {
  const { db, add, row } = await setup();
  const debit = add({ dir: 'debit', acct: 12, ts: T - 3 * 60 * MIN, amount: 1_200_000, text: 'Rs 12000 debited from a/c XX2222 via BILLDESK' });
  const credit = add({ dir: 'credit', acct: 13, ts: T, amount: 1_200_000, mode: 'Card', text: 'Payment of Rs.12,000.00 received towards your Axis Bank Credit Card XX3333' });
  assert.equal(await detectTransfers(db, [credit]), 2);
  assert.equal(row(credit).transfer_reason, 'card payment received');
  assert.equal(row(debit).transfer_reason, 'credit card bill payment');
  assert.equal(row(debit).transfer_pair_id, credit);
});

test('bank debit arriving after the card-side payment still links', async () => {
  const { db, add, row } = await setup();
  const credit = add({ dir: 'credit', acct: 13, ts: T, amount: 700_000, mode: 'Card', text: 'Payment of Rs.7,000.00 received towards your Axis Bank Credit Card XX3333' });
  await detectTransfers(db, [credit]);
  assert.equal(row(credit).transfer_pair_id, null);
  const debit = add({ dir: 'debit', acct: 12, ts: T + 5 * 60 * MIN, amount: 700_000, text: 'Rs 7000 debited via IMPS' });
  assert.equal(await detectTransfers(db, [debit]), 1);
  assert.equal(row(debit).transfer_reason, 'credit card bill payment');
  assert.equal(row(credit).transfer_pair_id, debit);
});

test('rejecting clears both legs and the detector respects the veto', async () => {
  const { db, add, row } = await setup();
  const a = add({ dir: 'debit', acct: 12, ts: T });
  const b = add({ dir: 'credit', acct: 11, ts: T + MIN });
  await detectTransfers(db, [b]);
  await rejectTransfer(db, a);
  assert.deepEqual([row(a).is_transfer, row(b).is_transfer, row(a).transfer_blocked, row(b).transfer_blocked], [0, 0, 1, 1]);
  assert.equal(await detectTransfers(db, [a, b]), 0);
});

test('real spending is untouched', async () => {
  const { db, add, row } = await setup();
  const spend = add({ dir: 'debit', acct: 13, ts: T, mode: 'Card', text: 'Spent Rs 5000 on your Axis Bank Credit Card at CRED STORE', merchant: 'CRED STORE' });
  const upi = add({ dir: 'debit', acct: 12, ts: T, text: 'Rs 5000 debited to swiggy@icici', merchant: 'Swiggy' });
  assert.equal(await detectTransfers(db, [spend, upi]), 0);
  assert.equal(row(spend).is_transfer + row(upi).is_transfer, 0);
});

test('user marking is not an auto-detection; backfill runs once', async () => {
  const { db, add, row, raw } = await setup();
  const x = add({ dir: 'debit', acct: 12, ts: T });
  await markTransferByUser(db, x);
  assert.deepEqual([row(x).is_transfer, row(x).transfer_auto, row(x).transfer_reason], [1, 0, 'marked by you']);
  const a = add({ dir: 'debit', acct: 12, ts: T + 60 * MIN, amount: 900_000 });
  const b = add({ dir: 'credit', acct: 11, ts: T + 61 * MIN, amount: 900_000 });
  assert.equal(await backfillTransfers(db), 2);
  assert.equal(row(a).transfer_pair_id, b);
  assert.equal(await backfillTransfers(db), 0);
  assert.equal((raw.prepare("select count(*) c from settings where key = 'transfers_backfilled_v1'").get() as any).c, 1);
});

test('"always a transfer" for a merchant marks existing rows and new ones, and can be undone', async () => {
  const { db, raw, row, add } = await setup();
  raw.exec("insert into merchants (id,key,name) values (7,'my axis card','My Axis Card')");
  const mk = (ts: number) => { const id = add({ dir: 'debit', acct: 12, ts, amount: 321_00, merchant: 'My Axis Card' }); raw.prepare('update transactions set merchant_id = 7 where id = ?').run(id); return id; };
  const old = mk(T);
  const { n, undo } = await setTransferMerchant(db, 7, true);
  assert.equal(n, 1);
  assert.deepEqual([row(old).is_transfer, row(old).transfer_reason, row(old).transfer_auto], [1, 'always a transfer (your rule)', 0]);

  const fresh = mk(T + 60 * MIN);
  assert.equal(await detectTransfers(db, [fresh]), 1); // a later payment there is caught on arrival
  assert.equal(row(fresh).is_transfer, 1);
  assert.equal(await countAutoTransfers(db), 0); // the user's own rule is not surfaced as a surprise

  // a "not a transfer" veto on one row still wins over the rule
  const vetoed = mk(T + 120 * MIN);
  await rejectTransfer(db, vetoed);
  assert.equal(await detectTransfers(db, [vetoed]), 0);

  await undo();
  assert.equal(row(old).is_transfer, 0);
  assert.equal(await setTransferMerchant(db, 7, false).then((r) => r.n), 1); // turning off un-marks the rule's remaining row (the fresh one)
  assert.equal(row(fresh).is_transfer, 0);
});
