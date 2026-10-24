import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dailyVariable, forecast } from './forecast';

const DAY = 864e5;
const NOW = new Date(2026, 9, 10, 12).getTime(); // 10 Oct 2026, noon
const at = (day: number) => new Date(2026, 9, day, 9).getTime();

test('balance falls by everyday spending and moves with scheduled items', () => {
  const f = forecast({
    now: NOW, balance: 100000_00, dailyVariable: 1000_00, days: 30,
    scheduled: [{ ts: at(15), paise: -20000_00, label: 'Rent', kind: 'recurring' }, { ts: at(31), paise: 85000_00, label: 'Salary', kind: 'income' }],
  });
  assert.equal(f.points.length, 31);
  // day 15 (5 days ahead): 100,000 - 5*1000 - 20,000
  assert.equal(f.points[5].balance, (100000 - 5000 - 20000) * 100);
  assert.ok(f.low.balance < 100000_00);
  assert.equal(f.shortfallTs, null);
  assert.equal(f.upcoming.length, 2);
});

test('a shortfall is found on the first day the balance goes below zero', () => {
  const f = forecast({ now: NOW, balance: 5000_00, dailyVariable: 1000_00, scheduled: [] });
  assert.equal(new Date(f.shortfallTs!).getDate(), 16); // 5,000 lasts to the 15th; negative on the 16th
});

test('overdue items land tomorrow, items outside the window are ignored', () => {
  const f = forecast({ now: NOW, balance: 0, dailyVariable: 0, scheduled: [{ ts: NOW - 3 * DAY, paise: 50000_00, label: 'Salary', kind: 'income' }, { ts: NOW + 90 * DAY, paise: -1, label: 'far', kind: 'bill' }] });
  assert.equal(f.points[1].balance, 50000_00);
  assert.equal(f.upcoming.length, 1);
});

test('safe daily spend divides what is left by the days remaining in the month', () => {
  const f = forecast({ now: NOW, balance: 31000_00, dailyVariable: 0, scheduled: [{ ts: at(20), paise: -10000_00, label: 'Bill', kind: 'bill' }] });
  // 10 Oct .. 31 Oct = 22 days; (31,000 - 10,000) / 22
  assert.equal(f.safeDaily, Math.floor(21000_00 / 22));
  assert.equal(f.monthEnd.balance, 21000_00);
});

test('daily variable spend ignores repeating payments and short histories', () => {
  assert.equal(dailyVariable(60000_00, 30000_00, 60), 500_00);
  assert.equal(dailyVariable(1000_00, 0, 3), Math.round(1000_00 / 14));
  assert.equal(dailyVariable(10_00, 50_00, 30), 0);
});
