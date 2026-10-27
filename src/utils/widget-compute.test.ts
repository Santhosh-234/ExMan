import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadDemo } from '../db/demo';
import { computeWidget } from '../widget/compute';
import { makeDb } from './testdb';

const NOW = Date.parse('2026-10-24T10:00:00Z');

test('an empty database still gives the widget something sensible to show', async () => {
  const { db } = await makeDb();
  const t = await computeWidget(db, NOW);
  assert.deepEqual([t.title, t.amount, t.private], ['Spent this month', '₹0', false]);
});

test('with data the widget shows the safe daily amount and the next payment', async () => {
  const { db } = await makeDb();
  await loadDemo(db, NOW);
  const t = await computeWidget(db, NOW);
  assert.equal(t.title, 'Safe to spend today');
  assert.match(t.amount, /^₹[\d,]+$/);
  assert.match(t.sub, /^Next: .+ ₹[\d,]+ · \d+ \w+$/);
});

test('hide amounts or the app lock reduce the widget to a prompt, as soon as the setting changes', async () => {
  const { db, raw } = await makeDb();
  await loadDemo(db, NOW);
  raw.prepare("INSERT INTO settings (key, value) VALUES ('hide_amounts', '1')").run();
  let t = await computeWidget(db, NOW);
  assert.deepEqual([t.title, t.amount, t.private], ['ExMan', 'Tap to open', true]);
  assert.ok(!/\d/.test(t.sub));
  raw.prepare("UPDATE settings SET value = '0' WHERE key = 'hide_amounts'").run();
  raw.prepare("INSERT INTO settings (key, value) VALUES ('app_lock', '1')").run();
  t = await computeWidget(db, NOW);
  assert.equal(t.private, true);
});
