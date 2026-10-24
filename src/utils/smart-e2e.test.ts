import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dumpAll, restoreAll } from '../backup/dump';
import { backfillBills, openBills } from '../db/bills';
import { deleteAllData } from '../db/data';
import { loadFeed } from '../db/feed';
import { loadForecast } from '../db/forecast';
import { holdingStats, setHoldingValue } from '../db/holdings';
import { ledgerGaps } from '../db/ledger';
import { netWorth } from '../db/networth';
import { monthlyTotals, totalFor } from '../db/queries';
import { run } from '../ingest/core';
import { makeDb } from './testdb';

const NOW = Date.parse('2026-10-20T10:00:00Z');
const D = 864e5;
const sms = (ts: number, text: string) => ({ kind: 'sms' as const, sender: 'VM-HDFCBK-S', ts, text });

/** Three months of a salaried life: salary, rent, SIP, EMI, groceries, one bill, one lost message. */
async function life() {
  const { db, raw } = await makeDb();
  const msgs = [];
  let bal = 150000, n = 0;
  const ref = () => 800000000000 + ++n;
  for (let m = 3; m >= 1; m--) {
    const base = NOW - m * 30 * D;
    msgs.push(sms(base + 1 * D, `Rs.85000.00 credited to a/c XX1234 by NEFT SALARY ACME CORP. Avl bal Rs.${(bal += 85000)}.00`));
    msgs.push(sms(base + 4 * D, `Rs.20000.00 debited from a/c XX1234 to VPA landlord@okaxis (UPI Ref No ${ref()}). Avl bal Rs.${(bal -= 20000)}.00`));
    msgs.push(sms(base + 6 * D, `Rs.5000.00 debited from a/c XX1234 towards SIP for HDFC Mutual Fund folio 9988. Avl bal Rs.${(bal -= 5000)}.00`));
    msgs.push(sms(base + 8 * D, `Rs.12450.00 debited from a/c XX1234 for EMI of loan a/c 77 Bajaj Finance. Avl bal Rs.${(bal -= 12450)}.00`));
    for (let g = 0; g < 6; g++) msgs.push(sms(base + (10 + g * 3) * D, `Rs.${700 + g * 10}.00 debited from a/c XX1234 to VPA bigbasket@upi (UPI Ref No ${ref()}). Avl bal Rs.${(bal -= 700 + g * 10)}.00`));
  }
  // a Rs 3,000 debit whose message never arrived: the next balance includes it
  bal -= 3000;
  msgs.push(sms(NOW - 2 * D, `Rs.640.00 debited from a/c XX1234 to VPA bigbasket@upi (UPI Ref No ${ref()}). Avl bal Rs.${(bal -= 640)}.00`));
  msgs.push(sms(NOW - 1 * D, 'Total Amt Due Rs 9,000.00 is payable by 24-Oct-26 for your HDFC Bank Credit Card ending 5678'));
  await run(db, msgs, 0);
  raw.prepare("UPDATE transactions SET status = 'confirmed'").run();
  return { db, raw };
}

test('a whole life: totals exclude investments and EMIs, and every smart surface has something true to say', async () => {
  const { db, raw } = await life();
  const from = NOW - 100 * D, to = NOW + D;
  // spending is groceries + rent only: no SIP, no EMI
  const spend = await totalFor(db, 'debit', from, to);
  const groceries = (raw.prepare("SELECT SUM(amount_paise) AS s FROM transactions WHERE merchant LIKE '%igbasket%'").get() as { s: number }).s;
  assert.equal(spend, groceries + 3 * 2000000);
  assert.equal(await totalFor(db, 'credit', from, to), 3 * 8500000);
  assert.ok((await monthlyTotals(db, from, to)).length > 0);

  const gaps = await ledgerGaps(db, 120, NOW);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].amountPaise, -300000);

  const h = await holdingStats(db, NOW);
  assert.equal(h.length, 1);
  assert.equal(h[0].putIn, 1500000);
  await setHoldingValue(db, h[0].id, 1650000);
  const nw = await netWorth(db, NOW);
  assert.ok(nw.bankTotal > 0 && nw.investments === 1650000);

  const f = (await loadForecast(db, NOW))!;
  assert.ok(f.sources.income >= 1 && f.sources.sip >= 1 && f.sources.loan >= 1 && f.sources.bills === 1);

  const feed = await loadFeed(db, NOW);
  const ids = feed.map((x) => x.id.split('-')[0]);
  assert.ok(ids.includes('gaps'), JSON.stringify(ids));
  assert.ok(ids.includes('bill'), JSON.stringify(ids));
});

test('backup and restore keep every smart table; delete-all wipes them', async () => {
  const { db } = await life();
  const [h] = await holdingStats(db, NOW);
  await setHoldingValue(db, h.id, 1650000);
  const dump = await dumpAll(db);
  const { db: db2, raw: raw2 } = await makeDb();
  await restoreAll(db2, dump);
  const count = (t: string) => (raw2.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  assert.equal(count('holdings'), 1);
  assert.equal(count('bills'), 1);
  assert.ok(count("transactions WHERE kind = 'investment'") === 3 && count("transactions WHERE kind = 'loan'") === 3);
  assert.equal((await netWorth(db2, NOW)).investments, 1650000);

  await deleteAllData(db2);
  for (const t of ['holdings', 'bills', 'net_items', 'ledger_ignored', 'kind_rules', 'transactions']) assert.equal(count(t), 0, t);
  assert.equal((await loadFeed(db2, NOW)).length, 0);
  assert.equal(await backfillBills(db2), 0);
  assert.equal((await openBills(db2, NOW)).length, 0);
});
