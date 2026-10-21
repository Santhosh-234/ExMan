import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildCallouts } from './insights';

const c = (id: number, name: string, rupees: number) => ({ category_id: id, name, total: rupees * 100 });

test('callouts: biggest category, swings vs average, savings, month-on-month', () => {
  const lines = buildCallouts({
    spend: [c(1, 'Food & Dining', 12000), c(2, 'Shopping', 8000), c(3, 'Transport', 1000)],
    history: [[c(1, 'Food & Dining', 8000), c(2, 'Shopping', 4000), c(3, 'Transport', 2000)], [c(1, 'Food & Dining', 9000), c(2, 'Shopping', 6000), c(3, 'Transport', 2000)], [c(1, 'Food & Dining', 7000), c(2, 'Shopping', 5000), c(3, 'Transport', 2000)]],
    spent: 21000 * 100, prevSpent: 18000 * 100, income: 50000 * 100,
  });
  assert.equal(lines.length, 4);
  assert.match(lines[0], /Food & Dining is your biggest spend: ₹12,000 \(57%/);
  assert.match(lines[1], /Food & Dining is 50% above your 3-month average/);
  assert.match(lines[2], /Transport is 50% below/);
  assert.match(lines[3], /saved 58%/);
});

test('callouts: overspend, small swings ignored, empty month', () => {
  const small = buildCallouts({ spend: [c(1, 'Food', 1000)], history: [[c(1, 'Food', 950)]], spent: 1000 * 100, prevSpent: 0, income: 0 });
  assert.equal(small.length, 1); // 5% / ₹50 is not a swing
  const over = buildCallouts({ spend: [c(1, 'Rent', 30000)], history: [], spent: 30000 * 100, prevSpent: 0, income: 20000 * 100 });
  assert.match(over[1], /₹10,000 more than you earned/);
  assert.deepEqual(buildCallouts({ spend: [], history: [], spent: 0, prevSpent: 0, income: 100 }), []);
});
