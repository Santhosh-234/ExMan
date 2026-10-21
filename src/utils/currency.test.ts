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
