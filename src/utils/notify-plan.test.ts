import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_PREFS, planReminders } from '../notify/plan';

const DAY = 864e5;
const NOW = new Date(2026, 9, 24, 12).getTime(); // 24 Oct, noon
const day = (n: number) => new Date(2026, 9, 24 + n, 15).getTime();
const base = { now: NOW, prefs: DEFAULT_PREFS, private: false, bills: [], subs: [], shortfallTs: null };

test('a bill reminds two days ahead and on the day, at 9 in the morning', () => {
  const p = planReminders({ ...base, bills: [{ label: 'HDFC card', paise: 900000, dueTs: day(5) }] });
  assert.equal(p.length, 2);
  assert.equal(new Date(p[0].at).getDate(), 27);
  assert.equal(new Date(p[0].at).getHours(), 9);
  assert.match(p[0].title, /HDFC card is due in 2 days/);
  assert.match(p[0].body, /₹9,000/);
  assert.equal(new Date(p[1].at).getDate(), 29);
});

test('reminders in the past, too far away, or for ended subscriptions are dropped', () => {
  const p = planReminders({
    ...base,
    bills: [{ label: 'Old', paise: 1, dueTs: day(-3) }, { label: 'Far', paise: 1, dueTs: NOW + 90 * DAY }],
    subs: [{ merchant: 'Gone', paise: 100, nextTs: day(5), status: 'ended' }, { merchant: 'Netflix', paise: 64900, nextTs: day(3), status: 'active' }],
  });
  assert.deepEqual(p.map((x) => x.title), ['Netflix renews tomorrow']);
});

test('switching a kind off removes its reminders', () => {
  const input = { ...base, bills: [{ label: 'Card', paise: 100, dueTs: day(5) }], subs: [{ merchant: 'Netflix', paise: 100, nextTs: day(3), status: 'active' as const }], shortfallTs: day(8) };
  assert.equal(planReminders(input).length, 4);
  assert.equal(planReminders({ ...input, prefs: { ...DEFAULT_PREFS, bills: false } }).length, 2);
  assert.equal(planReminders({ ...input, prefs: { bills: false, subscriptions: false, shortfall: false } }).length, 0);
});

test('private mode never puts a name or an amount on the lock screen', () => {
  const p = planReminders({ ...base, private: true, bills: [{ label: 'HDFC card', paise: 900000, dueTs: day(5) }], subs: [{ merchant: 'Netflix', paise: 64900, nextTs: day(3), status: 'active' }] });
  for (const x of p) assert.ok(!/HDFC|Netflix|₹|\d{3}/.test(`${x.title} ${x.body}`), `${x.title} / ${x.body}`);
});

test('the list is ordered by time and capped', () => {
  const bills = Array.from({ length: 30 }, (_, k) => ({ label: `B${k}`, paise: 100, dueTs: day(3 + (k % 30)) }));
  const p = planReminders({ ...base, bills });
  assert.ok(p.length <= 40);
  assert.deepEqual([...p].sort((a, b) => a.at - b.at).map((x) => x.id), p.map((x) => x.id));
});
