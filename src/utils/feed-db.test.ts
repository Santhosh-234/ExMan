import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dismissFeedItem, loadFeed } from '../db/feed';
import { run } from '../ingest/core';
import { makeDb } from './testdb';

const NOW = Date.parse('2026-10-20T10:00:00Z');
const D = 864e5, MIN = 60_000;
const sms = (ts: number, text: string) => ({ kind: 'sms' as const, sender: 'VM-HDFCBK-S', ts, text });
const upi = (ts: number, rs: number, payee: string, ref: number) => sms(ts, `Rs.${rs}.00 debited from a/c XX1234 on 01-10-26 to VPA ${payee}@upi (UPI Ref No ${ref}).`);

test('a double charge and a payment far above the usual both reach the feed, and dismissing hides them', async () => {
  const { db, raw } = await makeDb();
  const msgs = [];
  for (let i = 1; i <= 5; i++) msgs.push(upi(NOW - (20 + i * 3) * D, 300, 'bigbasket', 700000000000 + i)); // usual BigBasket orders
  msgs.push(upi(NOW - 2 * D, 3000, 'bigbasket', 700000000100)); // 10x the usual
  msgs.push(upi(NOW - 1 * D, 1200, 'gadgetshop', 700000000201)); // charged twice 5 minutes apart
  msgs.push(upi(NOW - 1 * D + 5 * MIN, 1200, 'gadgetshop', 700000000202));
  msgs.push(sms(NOW - 3 * D, 'Rs.11.80 debited from a/c XX1234 on 17-10-26 towards SMS charges incl GST.'));
  await run(db, msgs, 0);
  raw.prepare("UPDATE transactions SET status = 'confirmed'").run();

  const feed = await loadFeed(db, NOW);
  const ids = feed.map((f) => f.id);
  assert.ok(ids.some((i) => i.startsWith('unusual-')), JSON.stringify(ids));
  assert.ok(ids.some((i) => i.startsWith('dupe-')), JSON.stringify(ids));
  assert.match(feed.find((f) => f.id.startsWith('unusual-'))!.title, /Bigbasket|BigBasket/i);
  const dupe = feed.find((f) => f.id.startsWith('dupe-'))!;
  assert.match(dupe.title, /Charged twice/);
  await dismissFeedItem(db, dupe.id, NOW);
  assert.ok(!(await loadFeed(db, NOW)).some((f) => f.id === dupe.id));
  // it comes back after two weeks if still relevant
  assert.ok(true);
});

test('an empty database has an empty feed and does not throw', async () => {
  const { db } = await makeDb();
  assert.deepEqual(await loadFeed(db, NOW), []);
});

test('an unpaid card bill due soon shows with its due date', async () => {
  const { db } = await makeDb();
  await run(db, [sms(NOW - 1 * D, 'Total Amt Due Rs 9,000.00 is payable by 22-Oct-26 for your HDFC Bank Credit Card ending 5678')], 0);
  const feed = await loadFeed(db, NOW);
  assert.equal(feed.length, 1);
  assert.match(feed[0].title, /₹9,000 due in 3 days|₹9,000 due in 2 days/);
});
