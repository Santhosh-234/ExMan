import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseMessage } from './parser';
import { applyPattern, buildPattern, senderKey, tokenize, toParsed } from './teach';

const idx = (text: string, word: string, nth = 0) => {
  const toks = tokenize(text);
  let seen = 0;
  for (let i = 0; i < toks.length; i++) if (toks[i].text === word && seen++ === nth) return i;
  throw new Error(`token ${word} not found`);
};

const EXAMPLE = 'ALERT: 450.50 INR gone from acct 1234 for SWIGGY ORDER on 20Oct';

test('the example is unrecognised by the built-in parser (so teaching is needed)', () => {
  assert.equal(parseMessage(EXAMPLE, { sender: 'VM-NEWBNK-S' }), null);
});

test('sender keys drop operator prefix and DLT suffix', () => {
  assert.equal(senderKey('VM-INDBNK-S'), 'indbnk');
  assert.equal(senderKey('AX-AXISBK'), 'axisbk');
  assert.equal(senderKey('+919999999999'), '+919999999999');
});

test('builds a pattern from taps and applies it to a different message in the same format', () => {
  const sel = {
    amount: [idx(EXAMPLE, '450.50'), idx(EXAMPLE, '450.50')] as [number, number],
    merchant: [idx(EXAMPLE, 'SWIGGY'), idx(EXAMPLE, 'ORDER')] as [number, number],
    account: [idx(EXAMPLE, '1234'), idx(EXAMPLE, '1234')] as [number, number],
  };
  const r = buildPattern(EXAMPLE, sel, 'debit');
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (!r.ok) return;
  assert.deepEqual(r.preview, { amountPaise: 45050, direction: 'debit', merchant: 'SWIGGY ORDER', account: '1234' });

  const other = applyPattern('ALERT: 1,200 INR gone from acct 9876 for ZOMATO GOLD on 21Oct', r.pattern);
  assert.deepEqual(other, { amountPaise: 120000, direction: 'debit', merchant: 'ZOMATO GOLD', account: '9876' });

  // unrelated messages from the same sender don't match
  assert.equal(applyPattern('Your OTP is 556677. Do not share.', r.pattern), null);
  assert.equal(applyPattern('Statement of 300 available', r.pattern), null);
});

test('merchant at the end of the message and optional fields', () => {
  const t = 'Spent INR 99 at CHAI POINT';
  const r = buildPattern(t, { amount: [idx(t, '99'), idx(t, '99')], merchant: [idx(t, 'CHAI'), idx(t, 'POINT')] }, 'debit');
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (!r.ok) return;
  assert.equal(applyPattern('Spent INR 250 at BOOK SHOP', r.pattern)?.merchant, 'BOOK SHOP');
  assert.equal(r.pattern.account_re, null);
});

test('rejects selections that are too generic or wrong', () => {
  const bare = '450.50 gone';
  assert.ok(buildPattern(bare, { amount: [0, 0] }, 'debit').ok); // "gone" after the amount is context
  const alone = '450.50';
  assert.equal(buildPattern(alone, { amount: [0, 0] }, 'debit').ok, false); // no words around it
  const t = 'Paid Rs 10 to X';
  assert.equal(buildPattern(t, { amount: [idx(t, 'Paid'), idx(t, 'Paid')] }, 'debit').ok, false); // not a number
  assert.equal(buildPattern(t, { amount: [idx(t, '10'), idx(t, '10')], account: [idx(t, 'X'), idx(t, 'X')] }, 'debit').ok, false);
});

test('taught transactions look like parsed ones (bank, mode, balance)', () => {
  const text = 'HDFC alert: INR 750 gone via UPI. Bal Rs 4,000';
  const p = toParsed(text, 'VM-HDFCBK', 5, { amountPaise: 75000, direction: 'debit', merchant: null, account: null });
  assert.equal(p.bank, 'HDFC');
  assert.equal(p.mode, 'UPI');
  assert.deepEqual(p.balance, { paise: 400000, kind: 'balance' });
  assert.equal(p.source, 'sms');
});
