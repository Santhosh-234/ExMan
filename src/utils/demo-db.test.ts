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

test('removing the demo also removes what you added to it while testing', async () => {
  const { db, raw } = await makeDb();
  const { ledgerGaps, ignoreGap } = await import('../db/ledger');
  const { addManualTxn } = await import('../db/queries');
  const { setAnchor } = await import('../db/anchors');
  await loadDemo(db, NOW);
  const acct = (raw.prepare("SELECT id FROM accounts WHERE last4 = '9999'").get() as { id: number }).id;
  const [gap] = await ledgerGaps(db, 120, NOW);
  await addManualTxn(db, { amount_paise: 300000, direction: 'debit', merchant: 'Missing', category_id: null, account_id: acct, ts: gap.toTs - 1000, tags: '', notes: null }); // "Add it"
  await ignoreGap(db, gap.toId);
  await setAnchor(db, acct, 100000, NOW);
  await removeDemo(db);
  for (const t of ['transactions', 'bills', 'holdings', 'merchants', 'ledger_ignored']) assert.equal(n(raw, `SELECT COUNT(*) AS n FROM ${t}`), 0, t);
  assert.equal(n(raw, "SELECT COUNT(*) AS n FROM accounts WHERE kind != 'cash'"), 0);
});
