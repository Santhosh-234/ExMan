import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isDuplicate, parseMessage } from './parser';

const T = 1_760_000_000_000;
const p = (text: string, sender?: string, ts = T) => parseMessage(text, { sender, ts });

test('HDFC UPI debit', () => {
  const r = p('Rs. 500.00 debited from a/c **1234 on 20-10-26 to VPA swiggy@icici(UPI Ref No 123456789012)', 'AD-HDFCBK-S');
  assert.deepEqual(r, { amountPaise: 50000, direction: 'debit', merchant: 'swiggy@icici', account: '1234', bank: 'HDFC', balance: null, mode: 'UPI', source: 'sms', ts: T });
});

test('HDFC card spend', () => {
  const r = p('Spent Rs.1,299.50 On HDFC Bank Card x1234 At AMAZON PAY On 2026-10-20:14:05:11.Not You? Call 18002586161', 'VM-HDFCBK');
  assert.equal(r?.amountPaise, 129950);
  assert.equal(r?.merchant, 'AMAZON PAY');
  assert.equal(r?.account, '1234');
  assert.equal(r?.mode, 'Card');
});

test('HDFC salary credit', () => {
  const r = p('Update! INR 50,000.00 deposited in HDFC Bank A/c XX1234 on 20-OCT-26 for NEFT Cr-ACME-SALARY. Avl bal INR 61,000.00', 'AD-HDFCBK-S');
  assert.equal(r?.direction, 'credit');
  assert.equal(r?.amountPaise, 5_000_000);
  assert.equal(r?.account, '1234');
});

test('ICICI debit names payee after semicolon', () => {
  const r = p('ICICI Bank Acct XX123 debited for Rs 250.00 on 20-Oct-26; ZOMATO credited. UPI:123456789012.', 'VM-ICICIB');
  assert.equal(r?.direction, 'debit');
  assert.equal(r?.merchant, 'ZOMATO');
  assert.equal(r?.account, '123');
  assert.equal(r?.bank, 'ICICI');
});

test('ICICI credit', () => {
  const r = p('ICICI Bank Account XX123 credited:Rs. 5,000.00 on 20-Oct-26. Info UPI/123456/RAHUL. Available Bal Rs 9,000.', 'VM-ICICIB');
  assert.equal(r?.direction, 'credit');
  assert.equal(r?.amountPaise, 500_000);
});

test('SBI UPI debit (amount without Rs)', () => {
  const r = p('Dear UPI user A/C X1234 debited by 500.0 on date 20Oct26 trf to SWIGGY Refno 123456789012', 'AX-SBIUPI');
  assert.equal(r?.amountPaise, 50000);
  assert.equal(r?.merchant, 'SWIGGY');
  assert.equal(r?.account, '1234');
  assert.equal(r?.bank, 'SBI');
});

test('SBI credit', () => {
  const r = p('Your A/C XXXXX61234 has a credit of Rs 25,000.00 on 20/10/26 from RAHUL SHARMA. -SBI', 'AX-SBIINB');
  assert.equal(r?.direction, 'credit');
  assert.equal(r?.merchant, 'RAHUL SHARMA');
});

test('GPay notification', () => {
  const r = p('Paid ₹120 to Chai Point', 'com.google.android.apps.nbu.paisa.user');
  assert.equal(r?.source, 'gpay');
  assert.equal(r?.merchant, 'Chai Point');
  assert.equal(r?.amountPaise, 12000);
  assert.equal(r?.account, null);
});

test('PhonePe notifications', () => {
  const out = p('Paid ₹2,450 to BigBasket', 'com.phonepe.app');
  assert.equal(out?.source, 'phonepe');
  assert.equal(out?.merchant, 'BigBasket');
  const inn = p('Received ₹800 from Anita', 'com.phonepe.app');
  assert.equal(inn?.direction, 'credit');
  assert.equal(inn?.merchant, 'Anita');
});

test('Paytm notification', () => {
  const r = p('Paid ₹60 to Metro Recharge', 'net.one97.paytm');
  assert.equal(r?.source, 'paytm');
  assert.equal(r?.amountPaise, 6000);
});

test('non-transactions return null', () => {
  assert.equal(p('123456 is your OTP for txn of Rs 500. Do not share.', 'VM-HDFCBK'), null);
  assert.equal(p('Get flat Rs 100 cashback on your next recharge!'), null);
  assert.equal(p('Your payment of Rs 500 to Swiggy failed.'), null);
});

test('SMS + notification for same payment are duplicates', () => {
  const sms = p('Rs. 500.00 debited from a/c **1234 on 20-10-26 to VPA swiggy@icici', 'AD-HDFCBK-S', T)!;
  const notif = p('Paid ₹500 to Swiggy', 'com.google.android.apps.nbu.paisa.user', T + 59_000)!;
  assert.ok(isDuplicate(sms, notif));
  assert.ok(!isDuplicate(sms, { ...notif, ts: T + 61_000 }));
  assert.ok(!isDuplicate(sms, { ...notif, account: '9999' }));
  assert.ok(!isDuplicate(sms, { ...notif, direction: 'credit' }));
});

test('Indian Bank sender VM-INDBNK-S is recognised', () => {
  const r = p('Rs. 250.00 debited from a/c XX1234 on 20-10-26 to VPA zomato@icici', 'VM-INDBNK-S');
  assert.equal(r?.bank, 'INDIAN');
});
