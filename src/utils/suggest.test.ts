import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type Example, evaluate, isStrong, isUsable, trainModel } from './suggest';

const FOOD = 1, GROC = 2, TRAVEL = 3;
const ex = (merchant: string, category: number, amountRs = 300, mode = 'UPI'): Example => ({ merchant, direction: 'debit', mode, amountPaise: amountRs * 100, category });

const history: Example[] = [
  ...Array.from({ length: 6 }, () => ex('Swiggy', FOOD, 350)),
  ...Array.from({ length: 4 }, () => ex('Blinkit', GROC, 600)),
  ...Array.from({ length: 4 }, () => ex('Uber', TRAVEL, 250)),
  ex('Zomato', FOOD, 400),
];

test('a merchant seen often is predicted strongly', () => {
  const s = trainModel(history).predict(ex('Swiggy', 0, 380));
  assert.equal(s?.category, FOOD);
  assert.ok(isStrong(s));
  assert.equal(s?.exact, true);
});

test('a new merchant sharing a word with a known one follows it', () => {
  const s = trainModel(history).predict(ex('Swiggy Limited', 0));
  assert.equal(s?.category, FOOD);
  assert.ok(isUsable(s));
});

test('an unknown merchant is not forced into a category', () => {
  const s = trainModel(history).predict(ex('Qwxyz Traders', 0));
  assert.ok(!isStrong(s));
});

test('too little history, or no merchant, gives no answer', () => {
  assert.equal(trainModel(history.slice(0, 3)).predict(ex('Swiggy', 0)), null);
  assert.equal(trainModel(history).predict({ merchant: null, direction: 'debit', mode: 'UPI', amountPaise: 100, category: undefined } as never), null);
});

test('the user correcting a merchant outvotes the old habit', () => {
  const m = trainModel([...history, ...Array.from({ length: 12 }, () => ex('Swiggy', GROC, 350))]);
  assert.equal(m.predict(ex('Swiggy', 0))?.category, GROC);
});

test('evaluation uses newer transactions as the test set and reports the baseline', () => {
  const h = history.map((e, i) => ({ ...e, ts: i }));
  const r = evaluate(h, (e) => (/uber/i.test(e.merchant ?? '') ? TRAVEL : null));
  assert.equal(r.tested, h.length - Math.floor(h.length * 0.8));
  assert.ok(r.answered >= r.correct);
  assert.ok(r.baselineAnswered >= r.baselineCorrect);
});
