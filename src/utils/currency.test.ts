import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractForeign, formatForeign, isForeign, toPaise } from './currency';
import { parseMessage } from './parser';

test('foreign amounts are found, balances and limits are not', () => {
  assert.deepEqual(extractForeign('Spent USD 12.99 on your Axis Bank Credit Card XX1234 at OPENAI'), { code: 'USD', minor: 1299 });
  assert.deepEqual(extractForeign('Txn of EUR 1,250.50 done'), { code: 'EUR', minor: 125050 });
  assert.deepEqual(extractForeign('JPY 3000 spent'), { code: 'JPY', minor: 3000 }); // yen has no minor unit
  assert.equal(extractForeign('Avl Lmt USD 5,000.00'), null);
  assert.equal(extractForeign('Rs 500 debited'), null);
});

test('conversion to paise uses the rate and rounds', () => {
  assert.equal(toPaise(1299, 'USD', 88), 114312); // 12.99 * 88 = 1143.12 rupees
  assert.equal(toPaise(3000, 'JPY', 0.58), 174000);
  assert.ok(toPaise(1, 'USD', 0.0001) >= 1); // never zero
  assert.equal(formatForeign(1299, 'USD'), 'USD 12.99');
  assert.equal(formatForeign(3000, 'JPY'), 'JPY 3,000');
  assert.equal(isForeign('INR'), false);
  assert.equal(isForeign('USD'), true);
});

test('the parser reads USD card spends, but a rupee amount always wins', () => {
  const p = parseMessage('Spent USD 12.99 on your Axis Bank Credit Card XX1234 at OPENAI on 20-10-26', { sender: 'VM-AXISBK', ts: 1 });
  assert.ok(p);
  assert.deepEqual([p!.currency, p!.foreignMinor, p!.amountPaise, p!.direction, p!.account, p!.merchant, p!.mode], ['USD', 1299, 0, 'debit', '1234', 'OPENAI', 'Card']);
  const both = parseMessage('Spent Rs 1,090.20 (USD 12.99) on your Axis Bank Credit Card XX1234 at OPENAI', { sender: 'VM-AXISBK', ts: 1 });
  assert.deepEqual([both!.amountPaise, both!.currency], [109020, undefined]);
  assert.equal(parseMessage('Get USD 100 cashback on travel! Offer ends soon', { sender: 'VM-AXISBK' }), null);
});

test('amount-then-code formats: "Spent . 32 USD", "32.50USD", symbols', () => {
  assert.deepEqual(extractForeign('Spent . 32 USD at OPENAI'), { code: 'USD', minor: 3200 });
  assert.deepEqual(extractForeign('Spent 32.50USD on card'), { code: 'USD', minor: 3250 });
  assert.deepEqual(extractForeign('Spent 1,200 JPY on card'), { code: 'JPY', minor: 1200 });
  assert.deepEqual(extractForeign('Paid $12.99 to NETFLIX'), { code: 'USD', minor: 1299 });
  assert.deepEqual(extractForeign('Paid US$ 5 at X'), { code: 'USD', minor: 500 });
  assert.deepEqual(extractForeign('Spent €10 at Y'), { code: 'EUR', minor: 1000 });
  // balances, limits and plain words are not amounts
  assert.equal(extractForeign('Avl Lmt 5000 USD'), null);
  assert.equal(extractForeign('Spent 32 USDA gift'), null);
  assert.equal(extractForeign('Rs 500 at STUSD shop'), null);
});

test('the parser reads "Spent . 32 USD" as a USD spend; rupees stay rupees', () => {
  const p = parseMessage('Spent . 32 USD on your Axis Bank Credit Card XX1234 at OPENAI on 20-10-26', { sender: 'VM-AXISBK', ts: 1 });
  assert.deepEqual([p?.currency, p?.foreignMinor, p?.direction], ['USD', 3200, 'debit']);
  const inr = parseMessage('Spent Rs. 32 on your Axis Bank Credit Card XX1234 at OPENAI', { sender: 'VM-AXISBK', ts: 1 });
  assert.deepEqual([inr?.currency, inr?.amountPaise], [undefined, 3200]);
});
