import assert from 'node:assert/strict';
import { test } from 'node:test';

import { looksLikeTransaction as yes } from './transactional';

test('real transaction wording is counted', () => {
  assert.ok(yes('Rs.450.50 debited from A/c XX1234 on 20-Oct to SWIGGY via UPI'));
  assert.ok(yes('INR 2,000 credited to your account XX9876 by NEFT'));
  assert.ok(yes('Spent Rs 320 on your card ending 4321 at AMAZON'));
  assert.ok(yes('You have paid Rs 99 to NETFLIX using UPI'));
  assert.ok(yes('Sent Rs.500 To RAHUL on 20/10'));
});

test('offers, reminders and OTPs are not', () => {
  assert.ok(!yes('Get Rs 500 cashback on your first order. Offer valid till 31 Oct'));
  assert.ok(!yes('Pre-approved personal loan of Rs 5,00,000. Apply now'));
  assert.ok(!yes('Your OTP for transaction of Rs 1,200 is 483921. Do not share'));
  assert.ok(!yes('Reminder: your bill of Rs 1,450 is due on 25 Oct'));
  assert.ok(!yes('Hello, your order has shipped'));
});

test('a debit alert that also mentions an offer still counts', () => {
  assert.ok(yes('Rs 800 debited from A/c XX1234. Offer: get 5% cashback on your next UPI payment'));
});

import { isOtpMessage, mentionsAmount } from './transactional';

test('OTP messages are recognised, real alerts that mention OTP are not', () => {
  assert.ok(isOtpMessage('123456 is the OTP for txn of Rs 500 at AMAZON on card ending 1234. Do not share.'));
  assert.ok(isOtpMessage('Your one time password is 4421 for INR 2,000 payment'));
  assert.ok(!isOtpMessage('Rs 500 debited from a/c XX1234. Never share your OTP with anyone.'));
});

test('amounts are found in rupees and foreign currencies, in either order', () => {
  for (const t of ['Rs.450 spent', 'INR 450', '₹450', '450 INR gone', '32 USD', 'USD 32', '$45.50', 'EUR 12.00', 'INR .32', 'Rs 500']) assert.ok(mentionsAmount(t), t);
  for (const t of ['hello there', 'call 1800 425 00000', 'order 12345 shipped', 'OTP 123456']) assert.ok(!mentionsAmount(t), t);
});
