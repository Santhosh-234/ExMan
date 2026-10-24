import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addManualHolding, holdingStats, renameHolding, setHoldingValue, syncHoldings } from '../db/holdings';
import { deleteNetItem, getNetItems, netWorth, saveNetItem } from '../db/networth';
import { updateTxn } from '../db/queries';
import { run } from '../ingest/core';
import { makeDb } from './testdb';

const NOW = Date.parse('2026-10-20T10:00:00Z');
const D = 864e5;
const sms = (daysAgo: number, text: string) => ({ kind: 'sms' as const, sender: 'VM-HDFCBK-S', ts: NOW - daysAgo * D, text });
const sip = (daysAgo: number, bal: number) => sms(daysAgo, `Rs.5000.00 debited from a/c XX1234 on 01-01-26 towards SIP for HDFC Mutual Fund folio 9988. Avl bal Rs.${bal}.00`);

async function seed() {
  const { db, raw } = await makeDb();
  await run(db, [sip(120, 100000), sip(90, 95000), sip(60, 90000), sip(30, 85000), sms(10, 'Rs.2000.00 credited to a/c XX1234 on 10-10-26 by NEFT SALARY. Avl bal Rs.87000.00')], 0);
  raw.prepare("UPDATE transactions SET status = 'confirmed'").run();
  return { db, raw };
}

test('SIP messages gather into one holding with the right totals', async () => {
  const { db } = await seed();
  const h = await holdingStats(db, NOW);
  assert.equal(h.length, 1);
  assert.equal(h[0].name, 'HDFC Mutual Fund');
  assert.equal(h[0].type, 'mutual_fund');
  assert.equal(h[0].putIn, 2000000);
  assert.equal(h[0].n, 4);
  assert.equal(h[0].value, null);
  assert.equal(h[0].gain, null);
  assert.equal(h[0].monthly, 500000); // SIPs 90, 60 and 30 days ago fall in the last 90 days: Rs 15,000 over 3 months
});

test('entering the current value gives gain, percentage and a yearly return', async () => {
  const { db } = await seed();
  const [h0] = await holdingStats(db, NOW);
  await setHoldingValue(db, h0.id, 2300000);
  const [h] = await holdingStats(db, NOW);
  assert.equal(h.gain, 300000);
  assert.ok(Math.abs(h.gainPct! - 0.15) < 1e-9);
  assert.ok(h.xirr! > 0.3); // 15% in about four months, annualised
  await setHoldingValue(db, h0.id, null);
  assert.equal((await holdingStats(db, NOW))[0].gain, null);
});

test('un-marking an investment releases it from the holding', async () => {
  const { db, raw } = await seed();
  const id = (raw.prepare("SELECT id FROM transactions WHERE kind = 'investment' ORDER BY ts LIMIT 1").get() as { id: number }).id;
  await updateTxn(db, id, { kind: 'normal' });
  await syncHoldings(db);
  assert.equal((await holdingStats(db, NOW))[0].n, 3);
  await updateTxn(db, id, { kind: 'investment' });
  await syncHoldings(db);
  assert.equal((await holdingStats(db, NOW))[0].n, 4);
  await renameHolding(db, (await holdingStats(db, NOW))[0].id, 'My SIP');
  assert.equal((await holdingStats(db, NOW))[0].name, 'My SIP');
});

test('net worth adds bank balances, investments and other items', async () => {
  const { db } = await seed();
  const [h] = await holdingStats(db, NOW);
  let nw = await netWorth(db, NOW);
  assert.equal(nw.bankTotal, 8700000);
  assert.equal(nw.investments, 2000000); // no value entered yet: at cost
  assert.equal(nw.investmentsValued, false);
  assert.equal(nw.total, 10700000);
  await setHoldingValue(db, h.id, 2300000);
  await addManualHolding(db, 'Gold at home', 'gold', 500000);
  await saveNetItem(db, { name: 'Car loan', side: 'liability', paise: 1500000 });
  await saveNetItem(db, { name: 'Deposit with landlord', side: 'asset', paise: 100000 });
  nw = await netWorth(db, NOW);
  assert.equal(nw.investments, 2800000);
  assert.equal(nw.investmentsValued, true);
  assert.equal(nw.liabilities, 1500000);
  assert.equal(nw.total, 8700000 + 2800000 + 100000 - 1500000);
  assert.equal(nw.series.length, 12);
  assert.equal(nw.series[11].total, nw.total);
  const items = await getNetItems(db);
  await deleteNetItem(db, items[0].id);
  assert.equal((await getNetItems(db)).length, 1);
});

test('the history follows the balances quoted in messages', async () => {
  const { db } = await seed();
  const nw = await netWorth(db, NOW, 6);
  // five months ago nothing was known; the SIP chain starts 4 months back, so earlier points are zero or small
  assert.ok(nw.series[0].total <= nw.series[5].total + 2000000);
  assert.equal(nw.series.length, 6);
});
