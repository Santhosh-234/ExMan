import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clearAnchor, effectiveBalance, setAnchor } from '../db/anchors';
import { loadFeed } from '../db/feed';
import { netWorth } from '../db/networth';
import { run } from '../ingest/core';
import { makeDb } from './testdb';

const NOW = Date.parse('2026-10-20T10:00:00Z');
const D = 864e5;
const axis = (ts: number, text: string) => ({ kind: 'sms' as const, sender: 'AX-AXISBK-S', ts, text });

// Axis style: no balance anywhere
async function seed() {
  const { db, raw } = await makeDb();
  await run(db, [
    axis(NOW - 40 * D, 'INR 85000.00 credited to A/c no. XX4321 on 01-09-26 by SALARY ACME CORP'),
    axis(NOW - 30 * D, 'INR 2500.00 debited from A/c no. XX4321 on 10-09-26 UPI/P2M/600000000001/BIGBASKET'),
    axis(NOW - 5 * D, 'INR 1200.00 debited from A/c no. XX4321 on 15-10-26 UPI/P2M/600000000002/SWIGGY'),
  ], 0);
  raw.prepare("UPDATE transactions SET status = 'confirmed'").run();
  const id = (raw.prepare('SELECT id FROM accounts WHERE last4 = ?').get('4321') as { id: number }).id;
  return { db, raw, id };
}

test('an account with no balance in its messages is listed as needing one, and the feed says so', async () => {
  const { db } = await seed();
  const nw = await netWorth(db, NOW);
  assert.equal(nw.banks.length, 0);
  assert.equal(nw.unknownBanks.length, 1);
  assert.ok((await loadFeed(db, NOW)).some((f) => f.id.startsWith('needbal-')));
});

test('entering the balance once makes it an estimate that moves with later transactions', async () => {
  const { db, id } = await seed();
  const first = await setAnchor(db, id, 50000_00, NOW - 10 * D);
  assert.equal(first.difference, null);
  const e = (await effectiveBalance(db, id))!;
  assert.equal(e.source, 'entered');
  assert.equal(e.paise, 50000_00 - 1200_00); // the Rs 1,200 on day -5 came after the anchor
  const nw = await netWorth(db, NOW);
  assert.equal(nw.unknownBanks.length, 0);
  assert.equal(nw.banks[0].estimated, true);
  assert.equal(nw.bankTotal, 48800_00);
  assert.ok(!(await loadFeed(db, NOW)).some((f) => f.id.startsWith('needbal-')));
});

test('entering it again reports what is missing', async () => {
  const { db, id } = await seed();
  await setAnchor(db, id, 50000_00, NOW - 10 * D);
  const r = await setAnchor(db, id, 46800_00, NOW); // bank app shows Rs 2,000 less than the estimate
  assert.equal(r.expected, 48800_00);
  assert.equal(r.difference, -2000_00);
  assert.equal((await effectiveBalance(db, id))!.paise, 46800_00);
  const same = await setAnchor(db, id, 46800_00, NOW + D);
  assert.equal(same.difference, 0);
});

test('the history before the anchor follows the transactions backwards, and forgetting the balance restores the prompt', async () => {
  const { db, id } = await seed();
  await setAnchor(db, id, 50000_00, NOW);
  const nw = await netWorth(db, NOW, 3);
  assert.equal(nw.series.length, 3);
  assert.equal(nw.series[2].bank, 50000_00);
  await clearAnchor(db, id);
  assert.equal((await netWorth(db, NOW)).unknownBanks.length, 1);
});
