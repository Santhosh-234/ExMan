import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyStatement, listStatements, previewStatement, undoStatement } from '../db/statements';
import { effectiveBalance } from '../db/anchors';
import { ledgerGaps } from '../db/ledger';
import { parseStatement } from './statement';
import { makeDb } from './testdb';

// Synthetic statement for account ending 4321 (Oct 1-5) and a second account ending 1234.
const axis = [
  ['Statement of Axis Account No - 910000000004321 for the period'], [],
  ['SRL NO', 'Tran Date', 'CHQNO', 'PARTICULARS', 'DR', 'CR', 'BAL'],
  [1, '01-10-2026', '', 'UPI/P2M/111111111111/Swiggy Ltd /Pay fo/AXIS BANK', '305.00', ' ', '10000.00'],
  [2, '02-10-2026', '', 'UPI/P2A/222222222222/Mr Friend/UPI/INDIAN BANK', '200.00', ' ', '9800.00'],
  [3, '03-10-2026', '', 'CreditCard Payment XX 2498 Ref#1Q2GEYXSRYNSI1', '4000.00', ' ', '5800.00'],
  [4, '05-10-2026', '', 'INT.PD:01-07-2026 to 30-09-2026', ' ', '23.50', '5823.50'],
];

async function seed() {
  const { db } = await makeDb();
  const a = (await db.runAsync("INSERT INTO accounts (name, kind, bank, last4) VALUES ('Axis a/c 4321', 'bank', 'AXIS', '4321')")).lastInsertRowId;
  const b = (await db.runAsync("INSERT INTO accounts (name, kind, bank, last4) VALUES ('Indian a/c 1234', 'bank', 'INDIAN', '1234')")).lastInsertRowId;
  const ins = (acct: number, d: number, h: number, dir: string, rupees: number, raw: string, bal: number | null = null) =>
    db.runAsync(`INSERT INTO transactions (amount_paise, direction, merchant, account_id, source, ts, status, raw_text, balance_paise) VALUES (?, ?, 'x', ?, 'sms', ?, 'confirmed', ?, ?)`, rupees * 100, dir, acct, new Date(2026, 9, d, h).getTime(), raw, bal);
  await ins(a, 1, 13, 'debit', 305, 'INR 305.00 debited UPI/P2M/111111111111/SWIGGY');
  await ins(a, 9, 10, 'debit', 999, 'unrelated, outside the statement');
  await ins(a, 2, 9, 'debit', 777, 'a duplicate that the bank never showed');
  // the other side of the ₹200 payment, on the second account
  const partner = (await ins(b, 3, 8, 'credit', 200, 'Credited Rs 200 UPI/P2A/222222222222/x')).lastInsertRowId;
  return { db, a, b, partner };
}

test('preview then apply: missing lines go to Review, balances fill in, closing balance becomes the account balance', async () => {
  const { db, a, partner } = await seed();
  const parsed = parseStatement(axis);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const st = parsed.statement;
  const rec = await previewStatement(db, a, st);
  assert.equal(rec.matched.length, 1);
  assert.equal(rec.missing.length, 3);
  assert.deepEqual(rec.extra.map((t) => t.amount_paise), [77700]);
  assert.equal(rec.missing[0].partner?.id, partner);

  const res = await applyStatement(db, a, st, rec, { add: new Set(rec.missing.map((m) => m.line.seq)), useBalance: true });
  assert.equal(res.added, 3);
  assert.equal(res.balanceSet, true);
  assert.equal(res.linked, 1);

  const rows = await db.getAllAsync("SELECT * FROM transactions WHERE stmt_id = ? ORDER BY ts", res.id);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r: { status: string }) => r.status === 'pending'));
  const interest = rows.find((r: { raw_text: string }) => r.raw_text.startsWith('INT.PD'));
  assert.equal(interest.merchant, 'Bank Interest'); // merchant names are title-cased
  assert.equal(interest.balance_paise, 582350);
  const card = rows.find((r: { raw_text: string }) => r.raw_text.startsWith('CreditCard'));
  assert.equal(card.is_transfer, 1); // card bill payments are transfers, found by the existing detector
  const friend = rows.find((r: { raw_text: string }) => r.raw_text.includes('222222222222'));
  assert.equal(friend.is_transfer, 1);
  assert.equal(friend.transfer_pair_id, partner);
  assert.equal((await db.getFirstAsync('SELECT is_transfer, transfer_pair_id FROM transactions WHERE id = ?', partner)).transfer_pair_id, friend.id);

  const matched = await db.getFirstAsync("SELECT balance_paise FROM transactions WHERE raw_text LIKE '%111111111111%' AND stmt_id IS NULL");
  assert.equal(matched.balance_paise, 1000000);
  const eff = await effectiveBalance(db, a);
  // 5,823.50 at the end of the statement, then the ₹999 payment on Oct 9 that came after it
  assert.equal(eff?.paise, 482450);
  assert.equal(eff?.source, 'entered');
  assert.equal(eff?.rolled, true);

  const hist = await listStatements(db);
  assert.equal(hist.length, 1);
  assert.equal(hist[0].added, 3);
  assert.equal(hist[0].pending, 3);
});

test('importing the same statement twice adds nothing the second time', async () => {
  const { db, a } = await seed();
  const parsed = parseStatement(axis);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const st = parsed.statement;
  const r1 = await previewStatement(db, a, st);
  await applyStatement(db, a, st, r1, { add: new Set(r1.missing.map((m) => m.line.seq)), useBalance: true });
  const r2 = await previewStatement(db, a, st);
  assert.equal(r2.missing.length, 0);
  assert.equal(r2.matched.length, 4);
  const before = (await db.getFirstAsync('SELECT COUNT(*) AS n FROM transactions')).n;
  const res2 = await applyStatement(db, a, st, r2, { add: new Set(), useBalance: true });
  assert.equal(res2.added, 0);
  assert.equal((await db.getFirstAsync('SELECT COUNT(*) AS n FROM transactions')).n, before);
});

test('only chosen lines are added; a statement whose balances do not add up never sets the balance', async () => {
  const { db, a } = await seed();
  const bad = axis.map((r) => [...r]);
  bad[4][4] = '250.00';
  const parsed = parseStatement(bad);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const st = parsed.statement;
  assert.ok(st.chainBroken > 0);
  const rec = await previewStatement(db, a, st);
  const res = await applyStatement(db, a, st, rec, { add: new Set([rec.missing[0].line.seq]), useBalance: true });
  assert.equal(res.added, 1);
  assert.equal(res.balanceSet, false);
  assert.equal(await effectiveBalance(db, a), null);
});

test('undo removes the pending additions and un-links the partner transfer', async () => {
  const { db, a, partner } = await seed();
  const parsed = parseStatement(axis);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const rec = await previewStatement(db, a, parsed.statement);
  const res = await applyStatement(db, a, parsed.statement, rec, { add: new Set(rec.missing.map((m) => m.line.seq)), useBalance: false });
  assert.equal(await undoStatement(db, res.id), 3);
  assert.equal((await db.getFirstAsync('SELECT COUNT(*) AS n FROM transactions WHERE stmt_id IS NOT NULL')).n, 0);
  assert.equal((await db.getFirstAsync('SELECT is_transfer FROM transactions WHERE id = ?', partner)).is_transfer, 0);
  assert.equal((await listStatements(db)).length, 0);
});

test('with the statement added, the Books check can follow the account and finds no gaps', async () => {
  const { db, a } = await seed();
  await db.runAsync("DELETE FROM transactions WHERE raw_text LIKE '%duplicate%' OR raw_text LIKE '%unrelated%'");
  const parsed = parseStatement(axis);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const rec = await previewStatement(db, a, parsed.statement);
  await applyStatement(db, a, parsed.statement, rec, { add: new Set(rec.missing.map((m) => m.line.seq)), useBalance: true });
  const now = new Date(2026, 9, 20).getTime();
  assert.deepEqual(await ledgerGaps(db, 120, now), []);
});
