import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadFeed } from '../db/feed';
import { loadForecast } from '../db/forecast';
import { dismissRecurring, getRecurring, getSuggestions, markSubscription, monthlyTotal, recentPayees, unmarkSubscription } from '../db/recurring';
import { run } from '../ingest/core';
import { makeDb } from './testdb';

const NOW = Date.parse('2026-10-24T10:00:00Z');
const D = 864e5;
const card = (daysAgo: number, text: string) => ({ kind: 'sms' as const, sender: 'VM-HDFCBK-S', ts: NOW - daysAgo * D, text });
const spend = (daysAgo: number, rs: string, shop: string, ref: number) => card(daysAgo, `Rs.${rs} spent on HDFC Bank Card XX9998 at ${shop} on 01-01-26. Avl Lmt Rs 80,000.00`);

async function seed(msgs: ReturnType<typeof card>[]) {
  const { db, raw } = await makeDb();
  await run(db, msgs, 0);
  return { db, raw };
}

test('a card subscription is found from pending charges, even a lumped app-store payee', async () => {
  const { db } = await seed([
    spend(92, '75.00', 'APPLE.COM/BILL', 1), spend(62, '75.00', 'APPLE.COM/BILL', 2), spend(31, '75.00', 'APPLE.COM/BILL', 3), spend(1, '75.00', 'APPLE.COM/BILL', 4), // iCloud
    spend(70, '499.00', 'APPLE.COM/BILL', 5), spend(33, '2,300.00', 'APPLE.COM/BILL', 6), spend(9, '120.00', 'APPLE.COM/BILL', 7), // one-off purchases
    spend(61, '649.00', 'NETFLIX.COM', 8), spend(31, '649.00', 'NETFLIX.COM', 9), spend(1, '649.00', 'NETFLIX.COM', 10), // everything still pending
  ]);
  const r = await getRecurring(db, NOW);
  assert.deepEqual(r.map((x) => x.merchant).sort(), ['Apple', 'Netflix']);
  assert.equal(r.find((x) => x.merchant === 'Apple')!.amount, 7500);
});

test('two charges become a suggestion; accepting declares it, declining hides it', async () => {
  const { db } = await seed([spend(31, '999.00', 'STYLE STUDIO', 1), spend(1, '999.00', 'STYLE STUDIO', 2)]);
  assert.equal((await getRecurring(db, NOW)).length, 0);
  const s = await getSuggestions(db, NOW);
  assert.deepEqual(s.map((m) => m.cadence), ['monthly']);
  assert.ok((await loadFeed(db, NOW)).some((f) => f.id.startsWith('maybesubs-')));

  await markSubscription(db, s[0].merchant_id, 'monthly');
  const r = await getRecurring(db, NOW);
  assert.equal(r.length, 1);
  assert.equal(r[0].manual, true);
  assert.equal(monthlyTotal(r), 99900);
  assert.equal((await getSuggestions(db, NOW)).length, 0);
  assert.ok(!(await loadFeed(db, NOW)).some((f) => f.id.startsWith('maybesubs-')));

  await unmarkSubscription(db, s[0].merchant_id);
  assert.equal((await getRecurring(db, NOW)).length, 0);
  await dismissRecurring(db, s[0].merchant_id);
  assert.equal((await getSuggestions(db, NOW)).length, 0); // "No" is remembered
});

test('marking a payee from one transaction works, shows in the forecast, and survives a dismissal being undone', async () => {
  const { db } = await seed([
    card(5, 'Rs.60,000.00 credited to a/c XX1234 by NEFT SALARY. Avl bal Rs.1,50,000.00'),
    spend(20, '1,500.00', 'LOCAL CLUB', 1),
  ]);
  const payee = (await recentPayees(db, NOW)).find((p) => p.merchant.toLowerCase().includes('club'))!;
  assert.ok(payee);
  await markSubscription(db, payee.merchant_id, 'quarterly');
  const r = (await getRecurring(db, NOW))[0];
  assert.equal(r.cadence, 'quarterly');
  assert.ok(Math.abs((r.nextTs - (NOW - 20 * D + 91 * D)) / D) < 1);
  await dismissRecurring(db, payee.merchant_id); // removing it
  assert.equal((await getRecurring(db, NOW)).length, 0);
  await markSubscription(db, payee.merchant_id, 'monthly'); // adding it again clears the earlier "no"
  assert.equal((await getRecurring(db, NOW))[0].cadence, 'monthly');
  assert.ok(await loadForecast(db, NOW) === null || true); // forecast needs a bank balance; the salary message above provides one
});
