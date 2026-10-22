import assert from 'node:assert/strict';
import { test } from 'node:test';

import { suggestSelection, tokenize } from './teach';

const pick = (text: string) => {
  const r = suggestSelection(text);
  return { text: r.amount === null ? null : tokenize(text)[r.amount].text, direction: r.direction, currency: r.currency };
};

test('rupee amounts, either side of the marker', () => {
  assert.deepEqual(pick('ALERT: 450.50 INR gone from acct 1234 for SWIGGY'), { text: '450.50', direction: null, currency: 'INR' });
  assert.deepEqual(pick('Rs. 250 debited from a/c 1234'), { text: '250', direction: 'debit', currency: 'INR' });
  assert.deepEqual(pick('You received ₹1,500 from RAHUL'), { text: '1,500', direction: 'credit', currency: 'INR' });
});

test('foreign amounts with symbols and codes', () => {
  assert.deepEqual(pick('Txn of $45.50 spent at UBER'), { text: '45.50', direction: 'debit', currency: 'USD' });
  assert.deepEqual(pick('Card 1234 charged 32.00 USD at NETFLIX'), { text: '32.00', direction: 'debit', currency: 'USD' });
  assert.deepEqual(pick('Hit on card: EUR 12.00 SPOTIFY'), { text: '12.00', direction: null, currency: 'EUR' });
});

test('balance and limit figures are skipped, and the card number is never the amount', () => {
  assert.equal(pick('Avl Lmt INR 90,000.00. Spent INR 2,000.00 on card 1234').text, '2,000.00');
  assert.equal(pick('Bal Rs 5,000 after you paid Rs 250').text, '250');
  assert.equal(pick('card 1234 used. Order 99887766').text, null);
});

test('credit wins only when its word comes first', () => {
  assert.equal(pick('Rs 500 credited to your account after refund').direction, 'credit');
  assert.equal(pick('Rs 500 debited; refund credited later').direction, 'debit');
});

test('nothing to suggest when there is no money marker', () => {
  assert.deepEqual(pick('hello 123 world'), { text: null, direction: null, currency: null });
});
