import assert from 'node:assert/strict';
import { test } from 'node:test';

import { coverageOfTop, groupByTemplate, maskedReport } from './lab';

const rows = [
  { id: 1, sender: 'VM-ABCBNK-S', ts: 1, text: 'Rs 450.00 debited from a/c 1234 to Rahul Sharma on 12-10-26. Ref 998877' },
  { id: 2, sender: 'VM-ABCBNK-S', ts: 2, text: 'Rs 99.00 debited from a/c 1234 to Priya Nair on 13-10-26. Ref 112233' },
  { id: 3, sender: 'AX-OFFERS-S', ts: 3, text: 'Congratulations! Pre-approved loan of Rs 500000 for you. Apply now' },
];

test('messages that differ only in numbers and names share a template', () => {
  const g = groupByTemplate(rows);
  assert.equal(g.length, 2);
  assert.equal(g[0].count, 2);
  assert.equal(g[0].likelyTransaction, true);
  assert.equal(g[1].likelyTransaction, false);
});

test('coverage and the shareable report reveal no digits or names', () => {
  const g = groupByTemplate(rows);
  assert.equal(coverageOfTop(g, 1), 2 / 3);
  assert.equal(coverageOfTop([], 5), 0);
  const report = maskedReport({ parsed: 10, unrecognised: 3, groups: g });
  assert.ok(!/Rahul|Priya|450|1234|998877/.test(report), report);
});
