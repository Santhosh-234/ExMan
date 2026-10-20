import assert from 'node:assert/strict';
import { test } from 'node:test';

import { guessCategory } from './categorize';

test('guesses from merchant', () => {
  assert.equal(guessCategory('swiggy@icici', 'debit'), 'Food & Dining');
  assert.equal(guessCategory('Uber India', 'debit'), 'Transport');
  assert.equal(guessCategory('ACME SALARY', 'credit'), 'Salary');
  assert.equal(guessCategory('ACME SALARY', 'debit'), null);
  assert.equal(guessCategory(null, 'debit'), null);
  assert.equal(guessCategory('Ramesh', 'debit'), null);
});
