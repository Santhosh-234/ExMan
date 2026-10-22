import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EMPTY_FILTER, filterFromParams } from './filters';

test('drill-down parameters become a filter', () => {
  const { filter, search } = filterFromParams({ category: '7', month: '2026-10', direction: 'debit', q: ' swiggy ' });
  assert.deepEqual(filter.categoryIds, [7]);
  assert.equal(filter.direction, 'debit');
  assert.equal(filter.from, new Date(2026, 9, 1).getTime());
  assert.equal(filter.to, new Date(2026, 10, 1).getTime());
  assert.equal(filter.q, 'swiggy');
  assert.equal(search, 'swiggy');
});

test('december rolls into january of the next year', () => {
  const { filter } = filterFromParams({ month: '2026-12' });
  assert.equal(filter.to, new Date(2027, 0, 1).getTime());
});

test('uncategorised and bad values', () => {
  assert.deepEqual(filterFromParams({ category: 'none' }).filter.categoryIds, [0]);
  const bad = filterFromParams({ category: 'drop table', month: '2026-13', direction: 'sideways', account: 'x', transfers: 'maybe' });
  assert.deepEqual(bad.filter, EMPTY_FILTER);
});

test('no parameters give the empty filter', () => {
  assert.deepEqual(filterFromParams({}), { filter: EMPTY_FILTER, search: '' });
});
