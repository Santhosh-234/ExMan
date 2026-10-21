import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { budgetOverview, getBudget, getBudgetRow, setBudgetRow } from '../db/queries';
import { migrate } from '../db/schema';
import { budgetStatus, carryOver, monthProgress } from './budgets';

const R = 100; // paise per rupee

test('month progress for past, current and future months', () => {
  const now = new Date(2026, 9, 10, 12); // 10 Oct 2026
  assert.deepEqual(monthProgress('2026-09', now), { elapsed: 1, daysLeft: 0, daysInMonth: 30 });
  assert.deepEqual(monthProgress('2026-11', now), { elapsed: 0, daysLeft: 30, daysInMonth: 30 });
  const cur = monthProgress('2026-10', now);
  assert.equal(cur.daysInMonth, 31);
  assert.equal(cur.daysLeft, 22);
  assert.ok(Math.abs(cur.elapsed - 10 / 31) < 1e-9);
});

test('status: ok, near (80%), over, and pace warnings', () => {
  const now = new Date(2026, 9, 10, 12);
  const s = (spent: number, extra = {}) => budgetStatus({ limit: 10_000 * R, spent: spent * R, month: '2026-10', now, ...extra });
  assert.equal(s(2000).state, 'ok');
  assert.equal(s(2000).aheadOfPace, false); // 2000 by day 10 projects to 6200
  assert.equal(s(5000).state, 'ok');
  assert.equal(s(5000).aheadOfPace, true); // 5000 by day 10 projects to 15500, still under the limit today
  assert.equal(s(8000).state, 'near');
  assert.equal(s(10_001).state, 'over');
  assert.equal(s(10_001).remaining, -1 * R);
  assert.equal(s(2000).dailySafe, Math.floor((8000 * R) / 22));
  assert.equal(s(2000, { carry: 2000 * R }).available, 12_000 * R); // rollover adds to what is available
  assert.equal(s(2000, { carry: -5 }).available, 10_000 * R); // never subtracts
  // finished months have no pace or daily figure; the first days of a month are too noisy to project
  const past = budgetStatus({ limit: 1000 * R, spent: 900 * R, month: '2026-09', now });
  assert.deepEqual([past.projected, past.dailySafe, past.state], [null, null, 'near']);
  assert.equal(budgetStatus({ limit: 1000 * R, spent: 600 * R, month: '2026-10', now: new Date(2026, 9, 2) }).projected, null);
});

test('carry-over is the unspent part only', () => {
  assert.equal(carryOver(5000, 3000), 2000);
  assert.equal(carryOver(5000, 7000), 0);
});

async function db() {
  const raw = new DatabaseSync(':memory:');
  const d: any = {
    execAsync: async (s: string) => raw.exec(s),
    getFirstAsync: async (s: string, ...p: any[]) => (s.includes('user_version') ? { user_version: 0 } : raw.prepare(s).get(...p)),
    getAllAsync: async (s: string, ...p: any[]) => raw.prepare(s).all(...p),
    runAsync: async (s: string, ...p: any[]) => { const r = raw.prepare(s).run(...p); return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes }; },
    withExclusiveTransactionAsync: async (fn: any) => fn(d),
  };
  await migrate(d);
  return { raw, d };
}

test('a budget carries forward until replaced or cleared', async () => {
  const { d } = await db();
  assert.equal(await getBudget(d, '2026-10'), null);
  await setBudgetRow(d, null, '2026-08', 40_000 * R);
  assert.equal(await getBudget(d, '2026-08'), 40_000 * R);
  assert.equal(await getBudget(d, '2026-12'), 40_000 * R); // inherited by later months
  assert.equal(await getBudget(d, '2026-07'), null); // but not earlier ones
  await setBudgetRow(d, null, '2026-10', 50_000 * R);
  assert.equal(await getBudget(d, '2026-09'), 40_000 * R);
  assert.equal(await getBudget(d, '2026-11'), 50_000 * R);
  await setBudgetRow(d, null, '2026-11', null); // clear from November on
  assert.equal(await getBudget(d, '2026-11'), null);
  assert.equal(await getBudget(d, '2026-10'), 50_000 * R);
  await setBudgetRow(d, null, '2026-11', 45_000 * R); // setting again replaces the clearing row
  assert.equal(await getBudget(d, '2027-02'), 45_000 * R);
  // clearing with nothing earlier stores nothing
  await setBudgetRow(d, 3, '2026-10', null);
  assert.equal((await d.getFirstAsync('select count(*) c from budgets where category_id = 3')).c, 0);
});

test('overview: category and overall lines, spending net of refunds, rollover from last month', async () => {
  const { raw, d } = await db();
  const ins = raw.prepare("insert into transactions (amount_paise,direction,source,ts,status,category_id,refund_of) values (?,?,'sms',?,'confirmed',?,?)");
  const oct = (day: number) => new Date(2026, 9, day, 12).getTime();
  const sep = (day: number) => new Date(2026, 8, day, 12).getTime();
  ins.run(3000 * R, 'debit', sep(5), 1, null); // Sep food 3000
  ins.run(2000 * R, 'debit', oct(3), 1, null); // Oct food 2000
  const buy = Number(ins.run(1000 * R, 'debit', oct(4), 1, null).lastInsertRowid); // Oct food 1000
  ins.run(400 * R, 'credit', oct(6), 1, buy); // refund of 400 linked to that purchase
  ins.run(900 * R, 'debit', oct(5), 2, null);
  await setBudgetRow(d, null, '2026-09', 20_000 * R);
  await setBudgetRow(d, 1, '2026-09', 5000 * R, true); // food 5000, rollover on
  await setBudgetRow(d, 2, '2026-10', 1000 * R, false);

  const o = await budgetOverview(d, '2026-10');
  const by = Object.fromEntries(o.map((l) => [String(l.category_id), l]));
  assert.equal(Object.keys(by).length, 3);
  assert.equal(by['1'].spent, 2600 * R); // 2000 + 1000 - 400 refund
  assert.equal(by['1'].carry, 2000 * R); // Sep: 5000 limit - 3000 spent
  assert.equal(by['2'].spent, 900 * R);
  assert.equal(by['null'].spent, 3500 * R); // overall: 2600 + 900
  assert.equal(by['null'].carry, 0); // overall has no rollover
  // September has no October-only category budget yet
  assert.deepEqual((await budgetOverview(d, '2026-09')).map((l) => l.category_id).sort(), [1, null]);
});
