import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type FeedSignals, buildFeed, findUnusual } from './feed';

const NOW = Date.parse('2026-10-20T10:00:00Z');
const calm: FeedSignals = { now: NOW, gaps: { count: 0, totalPaise: 0 }, shortfallTs: null, bills: [], budgets: [], subs: [], unusual: [], duplicates: [], feesMonthPaise: 0, pace: null, saving: null, sipsOverdue: [], unvalued: [], runwayMonths: null, needBalance: [], maybeSubs: [] };

test('a calm month has an empty feed', () => assert.deepEqual(buildFeed(calm), []));

test('urgent things outrank nice-to-know ones', () => {
  const f = buildFeed({
    ...calm,
    gaps: { count: 2, totalPaise: -1500000 },
    shortfallTs: NOW + 8 * 864e5,
    bills: [{ label: 'HDFC card', paise: 900000, dueTs: NOW + 2 * 864e5 }],
    saving: { rate: 0.3, label: 'September' },
    runwayMonths: 4.2,
  });
  assert.deepEqual(f.map((x) => x.id.split('-')[0]), ['short', 'gaps', 'bill', 'save', 'runway']);
  assert.equal(f[0].kind, 'alert');
  assert.equal(f[3].kind, 'good');
  assert.match(f[1].title, /₹15,000 not accounted for/);
  assert.match(f[2].title, /due in 2 days/);
});

test('bills far in the future are not shown yet; overdue ones say so', () => {
  assert.equal(buildFeed({ ...calm, bills: [{ label: 'Card', paise: 100, dueTs: NOW + 30 * 864e5 }] }).length, 0);
  assert.match(buildFeed({ ...calm, bills: [{ label: 'Card', paise: 100, dueTs: NOW - 2 * 864e5 }] })[0].title, /2 days ago/);
});

test('spending pace speaks only when it is clearly off', () => {
  const p = (projected: number) => buildFeed({ ...calm, pace: { spent: 1, lastMonth: 100000, projected, lastLabel: 'September' } });
  assert.equal(p(105000).length, 0);
  assert.equal(p(130000)[0].kind, 'watch');
  assert.equal(p(70000)[0].kind, 'good');
});

test('dismissed items stay out', () => {
  const sig = { ...calm, gaps: { count: 1, totalPaise: -100 } };
  assert.equal(buildFeed(sig, new Set(['gaps'])).length, 0);
});

test('negative savings is a warning, low savings is silent', () => {
  assert.equal(buildFeed({ ...calm, saving: { rate: -0.1, label: 'Sep' } })[0].kind, 'watch');
  assert.equal(buildFeed({ ...calm, saving: { rate: 0.05, label: 'Sep' } }).length, 0);
});

test('unusual spend needs history and a real amount', () => {
  const hist = new Map([[1, [30000, 32000, 28000, 31000]], [2, [100, 100]]]);
  const hit = findUnusual([{ id: 9, merchant: 'Swiggy', merchant_id: 1, paise: 250000 }, { id: 10, merchant: 'Chai', merchant_id: 2, paise: 500000 }, { id: 11, merchant: 'Swiggy', merchant_id: 1, paise: 35000 }], hist);
  assert.equal(hit.length, 1);
  assert.equal(hit[0].id, 9);
  assert.ok(hit[0].ratio > 7);
});
