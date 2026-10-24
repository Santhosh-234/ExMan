import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyKindToMerchant, backfillKinds, setKindRule } from '../db/kinds';
import { totalFor, updateTxn } from '../db/queries';
import { run } from '../ingest/core';
import { dumpAll, restoreAll } from '../backup/dump';
import { makeDb } from './testdb';

const T0 = Date.parse('2026-09-10T10:00:00Z');
const FROM = Date.parse('2026-09-01T00:00:00Z'), TO = Date.parse('2026-10-01T00:00:00Z');
const msg = (i: number, text: string) => ({ kind: 'sms' as const, sender: 'VM-HDFCBK-S', ts: T0 + i * 3_600_000, text });

async function seed() {
  const { db, raw } = await makeDb();
  await run(db, [
    msg(1, 'Rs.5000.00 debited from a/c XX1234 on 10-09-26 towards SIP for HDFC Mutual Fund folio 9988. Avl bal Rs.45000.00'),
    msg(2, 'Rs.12450.00 debited from a/c XX1234 on 10-09-26 for EMI of loan a/c 77 Bajaj Finance. Avl bal Rs.32550.00'),
    msg(3, 'Rs.349.00 debited from a/c XX1234 on 10-09-26 to VPA swiggy@icici (UPI Ref No 400000000003). Avl bal Rs.32201.00'),
    msg(4, 'Rs.5000.00 withdrawn at ATM Koramangala from a/c XX1234 on 10-09-26. Avl bal Rs.27201.00'),
    msg(5, 'Rs.85000.00 credited to a/c XX1234 on 10-09-26 by NEFT SALARY ACME. Avl bal Rs.112201.00'),
  ], 0);
  raw.prepare("UPDATE transactions SET status = 'confirmed'").run();
  return { db, raw };
}

test('SIPs and EMIs get their kind at ingest and stay out of spending', async () => {
  const { db, raw } = await seed();
  const kinds = raw.prepare('SELECT kind, amount_paise FROM transactions ORDER BY ts').all() as { kind: string; amount_paise: number }[];
  assert.deepEqual(kinds.map((k) => k.kind), ['investment', 'loan', 'normal', 'cash', 'normal']);
  // spending counts the Swiggy order and the ATM cash, not the SIP or the EMI
  assert.equal(await totalFor(db, 'debit', FROM, TO), 34900 + 500000);
  assert.equal(await totalFor(db, 'credit', FROM, TO), 8500000);
});

test('the balance quoted in each message is stored', async () => {
  const { raw } = await seed();
  const bals = (raw.prepare('SELECT balance_paise AS b FROM transactions ORDER BY ts').all() as { b: number }[]).map((r) => r.b);
  assert.deepEqual(bals, [4500000, 3255000, 3220100, 2720100, 11220100]);
});

test('changing a kind moves it in and out of the totals, and a merchant rule applies to its other transactions', async () => {
  const { db, raw } = await seed();
  const swiggy = raw.prepare("SELECT id, merchant_id FROM transactions WHERE amount_paise = 34900").get() as { id: number; merchant_id: number };
  await updateTxn(db, swiggy.id, { kind: 'investment' }); // silly, but proves the totals follow the kind
  assert.equal(await totalFor(db, 'debit', FROM, TO), 500000);
  await setKindRule(db, swiggy.merchant_id, 'normal');
  const r = await applyKindToMerchant(db, swiggy.merchant_id, 'normal');
  assert.equal(r.n, 1);
  assert.equal(await totalFor(db, 'debit', FROM, TO), 534900);
  await r.undo();
  assert.equal(await totalFor(db, 'debit', FROM, TO), 500000);
});

test('a merchant rule decides the kind of new transactions', async () => {
  const { db, raw } = await seed();
  const m = raw.prepare("SELECT merchant_id FROM transactions WHERE amount_paise = 34900").get() as { merchant_id: number };
  await setKindRule(db, m.merchant_id, 'investment');
  await run(db, [msg(30, 'Rs.100.00 debited from a/c XX1234 on 11-09-26 to VPA swiggy@icici (UPI Ref No 400000000030).')], 0);
  assert.equal((raw.prepare("SELECT kind FROM transactions WHERE amount_paise = 10000").get() as { kind: string }).kind, 'investment');
});

test('backfill classifies existing rows once and fills balances', async () => {
  const { db, raw } = await seed();
  raw.prepare("UPDATE transactions SET kind = 'normal', balance_paise = NULL").run();
  raw.prepare("DELETE FROM settings WHERE key = 'kinds_v1'").run();
  assert.equal(await backfillKinds(db), 3); // SIP, EMI, ATM
  assert.equal(await backfillKinds(db), 0); // only once
  assert.equal((raw.prepare("SELECT kind FROM transactions WHERE amount_paise = 500000 AND merchant IS NULL OR kind = 'investment'").get() as { kind: string }).kind, 'investment');
  assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM transactions WHERE balance_paise IS NOT NULL').get() as { n: number }).n, 5);
});

test('backup round-trips the new tables and an old backup without them still restores', async () => {
  const { db, raw } = await seed();
  const m = raw.prepare("SELECT merchant_id FROM transactions WHERE amount_paise = 34900").get() as { merchant_id: number };
  await setKindRule(db, m.merchant_id, 'investment');
  const dump = await dumpAll(db);
  assert.ok(dump.tables.kind_rules && dump.tables.holdings && dump.tables.bills);
  const old = { ...dump, tables: { ...dump.tables } };
  for (const t of ['kind_rules', 'holdings', 'net_items', 'ledger_ignored', 'bills', 'recurring_dismissed']) delete old.tables[t];
  const { db: db2 } = await makeDb();
  await restoreAll(db2, old);
  const { db: db3, raw: raw3 } = await makeDb();
  await restoreAll(db3, dump);
  assert.equal((raw3.prepare('SELECT COUNT(*) AS n FROM kind_rules').get() as { n: number }).n, 1);
  assert.equal((raw3.prepare("SELECT COUNT(*) AS n FROM transactions WHERE kind = 'investment'").get() as { n: number }).n, 1);
});

test('the ledger finds money that left without a message, and adding it closes the gap', async () => {
  const { ledgerGaps, ledgerHealth, ignoreGap } = await import('../db/ledger');
  const { addManualTxn } = await import('../db/queries');
  const { db, raw } = await makeDb();
  // the EMI message of Rs 12,450 (between these two) never arrived
  await run(db, [
    msg(1, 'Rs.5000.00 debited from a/c XX1234 on 10-09-26 towards SIP for HDFC Mutual Fund folio 9988. Avl bal Rs.45000.00'),
    msg(3, 'Rs.349.00 debited from a/c XX1234 on 10-09-26 to VPA swiggy@icici (UPI Ref No 400000000003). Avl bal Rs.32201.00'),
  ], 0);
  const now = T0 + 10 * 3_600_000;
  const gaps = await ledgerGaps(db, 120, now);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].amountPaise, -1245000); // balance fell 45,000 -> 32,201 but only 349 is on record
  const health = await ledgerHealth(db, 120, now);
  assert.equal(health[0].gaps, 1);
  await addManualTxn(db, { amount_paise: 1245000, direction: 'debit', merchant: 'EMI', category_id: null, account_id: gaps[0].accountId, ts: gaps[0].toTs - 1000, tags: '', notes: null });
  assert.equal((await ledgerGaps(db, 120, now)).length, 0);
  await ignoreGap(db, gaps[0].toId);
  assert.equal((await ledgerGaps(db, 120, now)).length, 0);
  void raw;
});
