import assert from 'node:assert/strict';
import { test } from 'node:test';

import { widgetLines } from '../widget/lines';

const NEXT = { label: 'HDFC card', paise: 900000, ts: new Date(2026, 9, 28).getTime() };

test('with a forecast the widget shows what is safe to spend and the next payment', () => {
  const l = widgetLines({ private: false, safeDaily: 124000, spentThisMonth: 5000000, next: NEXT });
  assert.equal(l.title, 'Safe to spend today');
  assert.equal(l.amount, '₹1,240');
  assert.equal(l.sub, 'Next: HDFC card ₹9,000 · 28 Oct');
});

test('without a forecast it falls back to the month so far', () => {
  const l = widgetLines({ private: false, safeDaily: null, spentThisMonth: 4250000, next: null });
  assert.deepEqual([l.title, l.amount, l.sub], ['Spent this month', '₹42,500', '']);
});

test('when the app is locked or amounts are hidden the widget shows no figures at all', () => {
  const l = widgetLines({ private: true, safeDaily: 124000, spentThisMonth: 5000000, next: NEXT });
  assert.ok(!/\d|HDFC/.test(`${l.title} ${l.amount} ${l.sub}`));
});
