import assert from 'node:assert/strict';
import { test } from 'node:test';

import { difference, estimateNow, runningBalances } from './estimate';

const f = (id: number, ts: number, direction: 'debit' | 'credit', rs: number) => ({ id, ts, direction, amount_paise: rs * 100 });

test('the estimate is the anchor plus later transactions only', () => {
  const flows = [f(1, 10, 'debit', 500), f(2, 20, 'credit', 1000), f(3, 30, 'debit', 200), f(4, 40, 'debit', 100)];
  assert.equal(estimateNow({ paise: 5000_00, ts: 25 }, flows), (5000 - 200 - 100) * 100);
});

test('running balances line up with the anchor, before and after it', () => {
  const flows = [f(1, 10, 'debit', 500), f(2, 20, 'credit', 1000), f(3, 30, 'debit', 200)];
  const p = runningBalances({ paise: 5000_00, ts: 25 }, flows);
  // after the first debit the balance was 4,000: the +1,000 credit that followed brought it to the 5,000 anchor
  assert.equal(p[0].paise, 4000_00);
  assert.equal(p[1].paise, 5000_00);
  assert.equal(p[2].paise, 4800_00);
});

test('a transaction exactly at the anchor time is already included in it', () => {
  const flows = [f(1, 25, 'debit', 300)];
  assert.equal(estimateNow({ paise: 1000_00, ts: 25 }, flows), 1000_00);
});

test('difference says which way the books are off', () => {
  assert.equal(difference(4000_00, 4700_00), -700_00);
  assert.equal(difference(4700_00, 4700_00), 0);
});
