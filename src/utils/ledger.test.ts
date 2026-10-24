import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type LedgerTxn, checkableShare, findGaps } from './ledger';

const MIN = 60_000;
let id = 0;
const tx = (atMin: number, direction: 'debit' | 'credit', rs: number, balRs: number | null, extra: Partial<LedgerTxn> = {}): LedgerTxn =>
  ({ id: ++id, ts: atMin * MIN, direction, amount_paise: rs * 100, balance_paise: balRs == null ? null : balRs * 100, ...extra });

test('a chain that adds up has no gaps', () => {
  const t = [tx(0, 'credit', 1000, 5000), tx(60, 'debit', 200, 4800), tx(120, 'debit', 300, 4500), tx(180, 'credit', 100, 4600)];
  assert.deepEqual(findGaps(1, t), []);
});

test('a missing debit shows up as a negative gap with its window', () => {
  const t = [tx(0, 'credit', 1000, 5000), tx(60, 'debit', 200, 4800), /* a 700 debit with no message */ tx(180, 'debit', 300, 3800)];
  const g = findGaps(1, t);
  assert.equal(g.length, 1);
  assert.equal(g[0].amountPaise, -70000);
  assert.equal(g[0].toId, t[2].id);
  assert.equal(g[0].fromTs, 60 * MIN);
});

test('transactions without a balance in between are counted, so only the unexplained part is a gap', () => {
  const t = [tx(0, 'credit', 1000, 5000), tx(30, 'debit', 150, null), tx(60, 'debit', 200, 4650)];
  assert.deepEqual(findGaps(1, t), []);
  const missing = [tx(0, 'credit', 1000, 5000), tx(30, 'debit', 150, null), tx(60, 'debit', 200, 4400)];
  assert.equal(findGaps(1, missing)[0].amountPaise, -25000);
});

test('adding the missing transaction closes the gap', () => {
  const t = [tx(0, 'credit', 1000, 5000), tx(60, 'debit', 200, 4800), tx(180, 'debit', 300, 3800)];
  const added = tx(120, 'debit', 700, null);
  assert.deepEqual(findGaps(1, [...t, added]), []);
});

test('sub-rupee differences are rounding, not gaps', () => {
  const t = [tx(0, 'credit', 1000, 5000), { ...tx(60, 'debit', 200, 4800), balance_paise: 479950 }];
  assert.deepEqual(findGaps(1, t), []);
});

test('two messages that arrived in the wrong order cancel out', () => {
  // real order: debit 200 (bal 4800) then debit 300 (bal 4500); their timestamps are swapped
  const a = tx(0, 'credit', 1000, 5000);
  const second = tx(61, 'debit', 300, 4500);
  const first = tx(62, 'debit', 200, 4800);
  assert.deepEqual(findGaps(1, [a, second, first]), []);
});

test('foreign-currency spends tolerate the difference between the bank rate and the estimate', () => {
  const t = [tx(0, 'credit', 1000, 5000), tx(60, 'debit', 1000, 3970, { approx: true })]; // estimated 1000, bank took 1030
  assert.deepEqual(findGaps(1, t), []);
  const wrong = [tx(0, 'credit', 1000, 5000), tx(60, 'debit', 1000, 3500, { approx: true })];
  assert.equal(findGaps(1, wrong).length, 1);
});

test('too little data gives no verdict and a share of how much can be checked', () => {
  assert.deepEqual(findGaps(1, []), []);
  assert.deepEqual(findGaps(1, [tx(0, 'debit', 10, 90)]), []);
  assert.equal(checkableShare([{ balance_paise: 1 }, { balance_paise: null }]), 0.5);
  assert.equal(checkableShare([]), 0);
});
