import assert from 'node:assert/strict';
import { test } from 'node:test';

import { categoryReport } from '../db/suggest';
import { run } from '../ingest/core';
import { makeDb } from './testdb';

const T0 = Date.parse('2026-09-01T10:00:00Z');
const msg = (i: number, shop: string, rs: number) => ({ kind: 'sms' as const, sender: 'VM-HDFCBK-S', ts: T0 + i * 3_600_000, text: `Rs.${rs}.00 debited from a/c XX1234 on 01-09-26 to VPA ${shop.toLowerCase()}@upi (UPI Ref No ${400000000000 + i}).` });

test('after the user files a merchant a few times, new transactions from it are categorised the same way', async () => {
  const { db, raw } = await makeDb();
  const cat = (raw.prepare("SELECT id FROM categories WHERE name = 'Health'").get() as { id: number }).id;
  await run(db, [1, 2, 3, 4, 5, 6].map((i) => msg(i, 'Zenith Nutrition', 300 + i)), 0);
  // the user confirms them under Health
  raw.prepare("UPDATE transactions SET status = 'confirmed', category_id = ?").run(cat);
  await run(db, [msg(20, 'Zenith Nutrition', 777)], 0);
  const row = raw.prepare('SELECT category_id FROM transactions WHERE amount_paise = 77700').get() as { category_id: number | null };
  assert.equal(row.category_id, cat);
});

test('pending (unconfirmed) guesses are not learned from', async () => {
  const { db, raw } = await makeDb();
  await run(db, [1, 2, 3, 4, 5, 6].map((i) => msg(i, 'Zenith Nutrition', 300 + i)), 0);
  raw.prepare("UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name = 'Health')").run();
  await run(db, [msg(20, 'Zenith Nutrition', 777)], 0);
  const row = raw.prepare('SELECT category_id FROM transactions WHERE amount_paise = 77700').get() as { category_id: number | null };
  assert.equal(row.category_id, null);
});

test('the category report compares learning against the keyword guess', async () => {
  const { db, raw } = await makeDb();
  const cat = (raw.prepare("SELECT id FROM categories WHERE name = 'Health'").get() as { id: number }).id;
  await run(db, Array.from({ length: 20 }, (_, i) => msg(i + 1, 'Zenith Nutrition', 300 + i)), 0);
  raw.prepare("UPDATE transactions SET status = 'confirmed', category_id = ?").run(cat);
  const r = await categoryReport(db);
  assert.equal(r.history, 20);
  assert.equal(r.tested, 4);
  assert.equal(r.correct, r.answered);
  assert.ok(r.answered >= 3);
});
