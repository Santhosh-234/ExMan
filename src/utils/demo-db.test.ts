import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadDemo, removeDemo } from '../db/demo';
import { loadFeed } from '../db/feed';
import { loadForecast } from '../db/forecast';
import { holdingStats } from '../db/holdings';
import { ledgerGaps } from '../db/ledger';
import { netWorth } from '../db/networth';
import { makeDb } from './testdb';

const NOW = Date.parse('2026-10-24T10:00:00Z');
const n = (raw: import('node:sqlite').DatabaseSync, sql: string) => (raw.prepare(sql).get() as { n: number }).n;

test('demo data lights up every smart feature', async () => {
  const { db, raw } = await makeDb();
  const added = await loadDemo(db, NOW);
  assert.ok(added >= 36, `added ${added}`);
  assert.equal(n(raw, "SELECT COUNT(*) AS n FROM transactions WHERE kind = 'investment'"), 3);
  assert.equal(n(raw, "SELECT COUNT(*) AS n FROM transactions WHERE kind = 'loan'"), 3);
  assert.ok(n(raw, "SELECT COUNT(*) AS n FROM transactions WHERE kind = 'cash'") >= 3);
  assert.ok(n(raw, "SELECT COUNT(*) AS n FROM transactions WHERE kind = 'fee'") >= 1);
  assert.ok(n(raw, "SELECT COUNT(*) AS n FROM transactions WHERE status = 'pending'") >= 3);
  assert.equal(n(raw, 'SELECT COUNT(*) AS n FROM bills'), 1);
  assert.equal((await holdingStats(db, NOW)).length, 1);
  assert.equal((await ledgerGaps(db, 120, NOW)).length, 1);
  assert.ok((await netWorth(db, NOW)).bankTotal > 0);
  assert.ok(await loadForecast(db, NOW));
  const ids = (await loadFeed(db, NOW)).map((f) => f.id.split('-')[0]);
  for (const want of ['gaps', 'bill', 'dupe', 'unusual']) assert.ok(ids.includes(want), `${want} in ${JSON.stringify(ids)}`);
});

test('removing the demo leaves nothing behind', async () => {
  const { db, raw } = await makeDb();
  await loadDemo(db, NOW);
  await removeDemo(db);
  for (const t of ['transactions', 'bills', 'holdings', 'merchants', 'unparsed']) assert.equal(n(raw, `SELECT COUNT(*) AS n FROM ${t}`), 0, t);
  assert.equal(n(raw, "SELECT COUNT(*) AS n FROM accounts WHERE kind != 'cash'"), 0);
});

test('real data survives removing the demo', async () => {
  const { db, raw } = await makeDb();
  const { run } = await import('../ingest/core');
  await run(db, [{ kind: 'sms', sender: 'VM-HDFCBK-S', ts: NOW - 3 * 864e5, text: 'Rs.250.00 debited from a/c XX1234 to VPA chaipoint@upi (UPI Ref No 123456789012). Avl bal Rs.5000.00' }], 0);
  await loadDemo(db, NOW);
  await removeDemo(db);
  assert.equal(n(raw, 'SELECT COUNT(*) AS n FROM transactions'), 1);
  assert.equal(n(raw, "SELECT COUNT(*) AS n FROM accounts WHERE last4 = '1234'"), 1);
  assert.equal(n(raw, "SELECT COUNT(*) AS n FROM merchants"), 1);
});
