import assert from 'node:assert/strict';
import { test } from 'node:test';

import { balanceAt, monthEnds, netWorthSeries } from './networth';

const NOW = new Date(2026, 9, 20, 12).getTime(); // 20 Oct 2026

test('month ends run oldest to newest and the last one is now', () => {
  const m = monthEnds(NOW, 4);
  assert.deepEqual(m.map((x) => x.label), ['Jul', 'Aug', 'Sep', 'Oct']);
  assert.equal(m[3].end, NOW);
  assert.equal(m[3].partial, true);
  assert.equal(m[2].end, new Date(2026, 9, 1).getTime());
});

test('balance at a time is the last one before it', () => {
  const p = [{ ts: 10, paise: 100 }, { ts: 20, paise: 200 }, { ts: 30, paise: 300 }];
  assert.equal(balanceAt(p, 5), null);
  assert.equal(balanceAt(p, 10), 100);
  assert.equal(balanceAt(p, 25), 200);
  assert.equal(balanceAt(p, 99), 300);
  assert.equal(balanceAt([], 99), null);
});

test('series adds banks, investments at cost, then at value today, and constant other items', () => {
  const months = monthEnds(NOW, 3);
  const s = netWorthSeries({
    months,
    accounts: [[{ ts: new Date(2026, 7, 15).getTime(), paise: 100000 }, { ts: new Date(2026, 8, 15).getTime(), paise: 150000 }], [{ ts: new Date(2026, 8, 2).getTime(), paise: 50000 }]],
    invested: [{ ts: new Date(2026, 7, 20).getTime(), paise: 20000 }, { ts: new Date(2026, 8, 20).getTime(), paise: 20000 }],
    other: -10000,
    nowInvestments: 55000,
  });
  assert.deepEqual(s.map((x) => x.total), [100000 + 20000 - 10000, 150000 + 50000 + 40000 - 10000, 150000 + 50000 + 55000 - 10000]);
});
