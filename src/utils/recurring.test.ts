import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type Charge, detectRecurring } from './recurring';

const DAY = 864e5;
const NOW = new Date(2026, 9, 20, 12).getTime();
const at = (daysAgo: number) => NOW - daysAgo * DAY;
const mk = (id: number, name: string, rupees: number[], daysAgo: number[]): Charge[] => rupees.map((r, i) => ({ merchant_id: id, merchant: name, amount_paise: r * 100, ts: at(daysAgo[i]) }));

test('a fixed monthly subscription is found, with next due date and cost', () => {
  const r = detectRecurring(mk(1, 'Netflix', [649, 649, 649, 649, 649, 649], [152, 122, 91, 61, 30, 1]), NOW);
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].cadence, r[0].count, r[0].varies, r[0].status, r[0].priceChange], ['monthly', 6, false, 'active', null]);
  assert.equal(r[0].monthlyCost, 64900);
  assert.ok(Math.abs((r[0].nextTs - at(-29)) / DAY) <= 2); // due in about 29 days
});

test('price rise is flagged only when the earlier charges were steady', () => {
  const up = detectRecurring(mk(1, 'Spotify', [119, 119, 119, 139], [91, 61, 30, 1]), NOW)[0];
  assert.deepEqual(up.priceChange, { from: 11900, to: 13900 });
  assert.equal(up.varies, true); // 119 vs 139 is more than 3% apart
  const bill = detectRecurring(mk(2, 'Electricity', [900, 1200, 1500, 1100], [91, 61, 30, 1]), NOW)[0];
  assert.equal(bill.priceChange, null); // a variable bill is not a price change
  assert.equal(bill.varies, true);
});

test('weekly and yearly patterns; yearly needs only two charges', () => {
  const w = detectRecurring(mk(3, 'Milk delivery', [200, 200, 200, 200, 200], [28, 21, 14, 7, 0]), NOW);
  assert.equal(w[0].cadence, 'weekly');
  const y = detectRecurring(mk(4, 'Domain renewal', [1200, 1200], [366, 1]), NOW);
  assert.equal(y[0].cadence, 'yearly');
  assert.equal(y[0].monthlyCost, 10000);
  assert.equal(y[0].status, 'active');
});

test('irregular, too-few and daily habits are not subscriptions', () => {
  assert.equal(detectRecurring(mk(5, 'Zomato', [300, 450, 280, 520, 390], [90, 70, 41, 20, 3]), NOW).length, 0); // gaps all over the place
  assert.equal(detectRecurring(mk(6, 'Gym', [1500, 1500], [30, 1]), NOW).length, 0); // two monthly charges is not yet a pattern
  assert.equal(detectRecurring(mk(7, 'Chai Point', [60, 60, 60, 60, 60, 60], [6, 5, 4, 3, 2, 1]), NOW).length, 0); // daily
  assert.equal(detectRecurring(mk(8, 'Mixed', [100, 5000, 120, 90], [91, 61, 30, 1]), NOW).length, 0); // amounts nowhere near each other
});

test('a stopped subscription is marked overdue, then ended', () => {
  // charges every 30 days, then silence: 40 days since the last one is late; 130 days is gone
  const overdue = detectRecurring(mk(1, 'Hotstar', [299, 299, 299, 299], [130, 100, 70, 40]), NOW)[0];
  assert.equal(overdue.status, 'overdue');
  const ended = detectRecurring(mk(1, 'Hotstar', [299, 299, 299, 299], [220, 190, 160, 130]), NOW)[0];
  assert.equal(ended.status, 'ended');
});

test('duplicate alerts and one odd gap do not break detection', () => {
  const dup = mk(1, 'Netflix', [649, 649, 649, 649, 649], [91, 61, 61, 30, 1]); // two alerts on the same day
  assert.equal(detectRecurring(dup, NOW)[0].count, 4);
  const odd = detectRecurring(mk(1, 'Rent', [20000, 20000, 20000, 20000, 20000, 20000], [185, 154, 124, 93, 45, 14]), NOW);
  assert.equal(odd[0]?.cadence, 'monthly'); // one skipped-then-doubled month is forgiven with 6 charges
});

test('results are ordered by next due date and merchants are kept apart', () => {
  const a = mk(1, 'A', [100, 100, 100], [60, 30, 1]); // next in ~29 days
  const b = mk(2, 'B', [200, 200, 200], [75, 45, 15]); // next in ~15 days
  assert.deepEqual(detectRecurring([...a, ...b], NOW).map((r) => r.merchant), ['B', 'A']);
});

import { DatabaseSync } from 'node:sqlite';

import { dismissRecurring, getRecurring, monthlyTotal, restoreRecurring } from '../db/recurring';
import { migrate } from '../db/schema';

test('database: transfers and dismissed merchants are excluded; dismissal can be undone', async () => {
  const raw = new DatabaseSync(':memory:');
  const db: any = {
    execAsync: async (s: string) => raw.exec(s),
    getFirstAsync: async (s: string, ...p: any[]) => (s.includes('user_version') ? { user_version: 0 } : raw.prepare(s).get(...p)),
    getAllAsync: async (s: string, ...p: any[]) => raw.prepare(s).all(...p),
    runAsync: async (s: string, ...p: any[]) => { const r = raw.prepare(s).run(...p); return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes }; },
    withExclusiveTransactionAsync: async (fn: any) => fn(db),
  };
  await migrate(db);
  raw.exec("insert into merchants (id,key,name) values (1,'netflix','Netflix'),(2,'rent transfer','Rent Transfer'),(3,'hotstar','Hotstar')");
  const ins = raw.prepare("insert into transactions (amount_paise,direction,source,ts,status,merchant,merchant_id,is_transfer) values (?,'debit','sms',?,'confirmed',?,?,?)");
  for (const d of [91, 61, 30, 1]) { ins.run(64900, NOW - d * DAY, 'Netflix', 1, 0); ins.run(2000000, NOW - d * DAY, 'Rent Transfer', 2, 1); ins.run(29900, NOW - d * DAY, 'Hotstar', 3, 0); }

  let r = await getRecurring(db, NOW);
  assert.deepEqual(r.map((x) => x.merchant).sort(), ['Hotstar', 'Netflix']); // the transfer is not a subscription
  assert.equal(monthlyTotal(r), 64900 + 29900);
  await dismissRecurring(db, 3);
  r = await getRecurring(db, NOW);
  assert.deepEqual(r.map((x) => x.merchant), ['Netflix']);
  await restoreRecurring(db, 3);
  assert.equal((await getRecurring(db, NOW)).length, 2);
});
