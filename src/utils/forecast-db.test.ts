import assert from 'node:assert/strict';
import { test } from 'node:test';

import { backfillBills, markBillPaid, openBills, recordBill } from '../db/bills';
import { loadForecast } from '../db/forecast';
import { run } from '../ingest/core';
import { makeDb } from './testdb';

const NOW = Date.parse('2026-10-20T10:00:00Z');
const D = 864e5;
const sms = (daysAgo: number, text: string) => ({ kind: 'sms' as const, sender: 'VM-HDFCBK-S', ts: NOW - daysAgo * D, text });

async function seed() {
  const { db, raw } = await makeDb();
  const msgs = [];
  let bal = 200000;
  // 4 months of salary on the 1st, rent on the 5th, a SIP on the 7th, daily spending
  for (let m = 4; m >= 1; m--) {
    msgs.push(sms(m * 30 + 18, `Rs.85000.00 credited to a/c XX1234 by NEFT SALARY ACME CORP. Avl bal Rs.${(bal += 85000)}.00`));
    msgs.push(sms(m * 30 + 14, `Rs.20000.00 debited from a/c XX1234 to VPA landlord@okaxis (UPI Ref No ${500000000000 + m}). Avl bal Rs.${(bal -= 20000)}.00`));
    msgs.push(sms(m * 30 + 12, `Rs.5000.00 debited from a/c XX1234 towards SIP for HDFC Mutual Fund folio 9988. Avl bal Rs.${(bal -= 5000)}.00`));
  }
  for (let d = 60; d >= 1; d -= 2) msgs.push(sms(d, `Rs.600.00 debited from a/c XX1234 to VPA shop${d}@upi (UPI Ref No ${600000000000 + d}). Avl bal Rs.${(bal -= 600)}.00`));
  await run(db, msgs, 0);
  raw.prepare("UPDATE transactions SET status = 'confirmed'").run();
  return { db, raw };
}

test('bill notices become bills, not unrecognised messages, and a payment closes them', async () => {
  const { db, raw } = await makeDb();
  await run(db, [sms(2, 'Total Amt Due Rs 12,345.00 or Min Amt Due Rs 617.00 is payable by 05-Nov-26 for your HDFC Bank Credit Card ending 1234')], 0);
  assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM unparsed').get() as { n: number }).n, 0);
  let bills = await openBills(db, NOW);
  assert.equal(bills.length, 1);
  assert.equal(bills[0].amount_paise, 1234500);
  await markBillPaid(db, bills[0].id);
  assert.equal((await openBills(db, NOW)).length, 0);
});

test('a newer statement replaces the last one for the same card', async () => {
  const { db } = await makeDb();
  await recordBill(db, { sender: 'VM-HDFCBK-S', ts: NOW - 40 * D, text: 'Total Amt Due Rs 5,000.00 is payable by 05-Oct-26 for your HDFC Bank Credit Card ending 1234' });
  await recordBill(db, { sender: 'VM-HDFCBK-S', ts: NOW - 2 * D, text: 'Total Amt Due Rs 9,000.00 is payable by 05-Nov-26 for your HDFC Bank Credit Card ending 1234' });
  const b = await openBills(db, NOW);
  assert.equal(b.length, 1);
  assert.equal(b[0].amount_paise, 900000);
});

test('bills that were saved as unrecognised move over once', async () => {
  const { db, raw } = await makeDb();
  raw.prepare('INSERT INTO unparsed (sender, text, ts) VALUES (?, ?, ?)').run('VM-HDFCBK-S', 'Total Amt Due Rs 9,000.00 is payable by 05-Nov-26 for your HDFC Bank Credit Card ending 1234', NOW);
  assert.equal(await backfillBills(db), 1);
  assert.equal(await backfillBills(db), 0);
  assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM unparsed').get() as { n: number }).n, 0);
});

test('the forecast knows salary, rent, the SIP and a bill, and projects a sensible month', async () => {
  const { db } = await seed();
  await recordBill(db, { sender: 'VM-HDFCBK-S', ts: NOW - 1 * D, text: 'Total Amt Due Rs 9,000.00 is payable by 25-Oct-26 for your HDFC Bank Credit Card ending 5678' });
  const r = (await loadForecast(db, NOW))!;
  assert.ok(r);
  assert.equal(r.accounts, 1);
  assert.ok(r.sources.income >= 1, 'salary');
  assert.ok(r.sources.recurring >= 1 || r.sources.sip >= 1, 'rent or sip');
  assert.ok(r.sources.sip >= 1, 'sip');
  assert.equal(r.sources.bills, 1);
  assert.equal(r.forecast.points.length, 31);
  assert.ok(r.forecast.upcoming.some((u) => u.kind === 'bill' && u.paise === -900000));
  assert.ok(r.forecast.safeDaily >= 0);
});

test('without a known bank balance there is no forecast', async () => {
  const { db } = await makeDb();
  assert.equal(await loadForecast(db, NOW), null);
});
