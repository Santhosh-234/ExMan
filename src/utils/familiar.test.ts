import assert from 'node:assert/strict';
import { test } from 'node:test';

import { familiarStats, isFamiliar } from './familiar';

const rows = (n: number, cat: number | null, amt: number, id = 1) => Array.from({ length: n }, () => ({ merchant_id: id, category_id: cat, amount_paise: amt }));
const P = { category: 3, amountPaise: 30000, direction: 'debit' as const, kind: 'normal', foreign: false, transfer: false };

test('a payee confirmed often under one category at the usual amount is familiar', () => {
  const s = familiarStats(rows(6, 3, 30000)).get(1);
  assert.equal(isFamiliar(s, P), true);
});

test('too little history, mixed categories, or no category are not familiar', () => {
  assert.equal(isFamiliar(familiarStats(rows(4, 3, 30000)).get(1), P), false);
  assert.equal(isFamiliar(familiarStats([...rows(4, 3, 30000), ...rows(3, 5, 30000)]).get(1), P), false);
  assert.equal(isFamiliar(familiarStats(rows(8, null, 30000)).get(1), { ...P, category: null }), false);
  assert.equal(isFamiliar(undefined, P), false);
});

test('an unusual amount, another category, a credit, a transfer or foreign spend always waits for review', () => {
  const s = familiarStats(rows(8, 3, 30000)).get(1);
  assert.equal(isFamiliar(s, { ...P, amountPaise: 150000 }), false);
  assert.equal(isFamiliar(s, { ...P, amountPaise: 5000 }), false);
  assert.equal(isFamiliar(s, { ...P, category: 4 }), false);
  assert.equal(isFamiliar(s, { ...P, direction: 'credit' }), false);
  assert.equal(isFamiliar(s, { ...P, transfer: true }), false);
  assert.equal(isFamiliar(s, { ...P, foreign: true }), false);
  assert.equal(isFamiliar(s, { ...P, kind: 'investment' }), false);
});
