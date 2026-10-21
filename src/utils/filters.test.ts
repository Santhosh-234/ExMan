import assert from 'node:assert/strict';
import { test } from 'node:test';

import { activeFilterCount, buildTxnQuery } from './filters';

test('empty filter only constrains status', () => {
  const r = buildTxnQuery({});
  assert.equal(r.where, 't.status = ?');
  assert.deepEqual(r.params, ['confirmed']);
});

test('search matches text and numeric amount, escapes wildcards', () => {
  const r = buildTxnQuery({ q: '50%' });
  assert.deepEqual(r.params.slice(1, 4), ['%50\\%%', '%50\\%%', '%50\\%%']);
  const n = buildTxnQuery({ q: '1,250.5' });
  assert.ok(n.where.includes('t.amount_paise = ?'));
  assert.equal(n.params.at(-1), 125050);
  assert.ok(!buildTxnQuery({ q: 'swiggy' }).where.includes('amount_paise'));
});

test('category filter supports uncategorised (0)', () => {
  const r = buildTxnQuery({ categoryIds: [3, 0] });
  assert.ok(r.where.includes('t.category_id IN (?) OR t.category_id IS NULL'));
  assert.deepEqual(r.params, ['confirmed', 3]);
  assert.ok(buildTxnQuery({ categoryIds: [0] }).where.includes('t.category_id IS NULL'));
});

test('range, direction, accounts, transfers and tag', () => {
  const r = buildTxnQuery({ direction: 'debit', accountIds: [1, 2], from: 10, to: 20, minPaise: 100, maxPaise: 900, tag: 'trip', transfers: 'hide' });
  assert.deepEqual(r.params, ['confirmed', 'debit', 1, 2, 10, 20, 100, 900, '%,trip,%']);
  assert.ok(r.where.endsWith('t.is_transfer = 0'));
  assert.ok(buildTxnQuery({ transfers: 'only' }).where.endsWith('t.is_transfer = 1'));
});

test('activeFilterCount ignores search text and default transfers', () => {
  assert.equal(activeFilterCount({ q: 'x', transfers: 'show' }), 0);
  assert.equal(activeFilterCount({ direction: 'debit', transfers: 'hide', from: 1 }), 3);
});
