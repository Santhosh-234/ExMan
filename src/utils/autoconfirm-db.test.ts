import assert from 'node:assert/strict';
import { test } from 'node:test';

import { run } from '../ingest/core';
import { makeDb } from './testdb';

const T0 = Date.parse('2026-09-01T10:00:00Z');
const upi = (i: number, rs: number, payee = 'zenithnutrition') => ({ kind: 'sms' as const, sender: 'VM-HDFCBK-S', ts: T0 + i * 3_600_000, text: `Rs.${rs}.00 debited from a/c XX1234 on 01-09-26 to VPA ${payee}@upi (UPI Ref No ${400000000000 + i}).` });

async function seed(setting: boolean) {
  const { db, raw } = await makeDb();
  const health = (raw.prepare("SELECT id FROM categories WHERE name = 'Health'").get() as { id: number }).id;
  await run(db, [1, 2, 3, 4, 5, 6].map((i) => upi(i, 300 + i)), 0);
  raw.prepare("UPDATE transactions SET status = 'confirmed', category_id = ?").run(health);
  if (setting) raw.prepare("INSERT INTO settings (key, value) VALUES ('auto_confirm', '1')").run();
  return { db, raw };
}
const status = (raw: import('node:sqlite').DatabaseSync, paise: number) => (raw.prepare('SELECT status FROM transactions WHERE amount_paise = ?').get(paise) as { status: string }).status;

test('with the setting on, a familiar payment is confirmed on arrival', async () => {
  const { db, raw } = await seed(true);
  await run(db, [upi(20, 310)], 0);
  assert.equal(status(raw, 31000), 'confirmed');
});

test('an unusual amount, a new payee or the setting being off all wait for review', async () => {
  const { db, raw } = await seed(true);
  await run(db, [upi(21, 5000), upi(22, 310, 'newplace')], 0);
  assert.equal(status(raw, 500000), 'pending');
  assert.equal(status(raw, 31000), 'pending');
  const off = await seed(false);
  await run(off.db, [upi(20, 310)], 0);
  assert.equal(status(off.raw, 31000), 'pending');
});
