import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseMessage } from './parser';

const GPAY = 'com.google.android.apps.nbu.paisa.user';
const PHONEPE = 'com.phonepe.app';
const PAYTM = 'net.one97.paytm';
const p = (text: string, sender: string) => parseMessage(text, { sender, ts: 1 });

// Notification wording is not published by the apps; these cover the shapes seen in the wild. Anything that changes in an app update is
// caught on the phone by "Unrecognised messages" and Teach ExMan.
const CASES: [string, string, { merchant: string | null; paise: number; direction: 'debit' | 'credit'; source: string } | null][] = [
  [GPAY, 'Paid ₹250 to Zomato', { merchant: 'Zomato', paise: 25000, direction: 'debit', source: 'gpay' }],
  [GPAY, 'You paid ₹250.00 to Zomato', { merchant: 'Zomato', paise: 25000, direction: 'debit', source: 'gpay' }],
  [GPAY, '₹1,500 received from Rahul Sharma', { merchant: 'Rahul Sharma', paise: 150000, direction: 'credit', source: 'gpay' }],
  [GPAY, 'Rahul Sharma paid you ₹1,500', { merchant: 'Rahul Sharma', paise: 150000, direction: 'credit', source: 'gpay' }],
  [PHONEPE, 'Paid ₹250 to ZOMATO', { merchant: 'ZOMATO', paise: 25000, direction: 'debit', source: 'phonepe' }],
  [PHONEPE, 'Money sent! ₹250 sent to Rahul', { merchant: 'Rahul', paise: 25000, direction: 'debit', source: 'phonepe' }],
  [PHONEPE, '₹500 received from Priya', { merchant: 'Priya', paise: 50000, direction: 'credit', source: 'phonepe' }],
  [PAYTM, '₹250 paid to Zomato', { merchant: 'Zomato', paise: 25000, direction: 'debit', source: 'paytm' }],
  [PAYTM, 'Payment of ₹250 to Zomato successful', { merchant: 'Zomato', paise: 25000, direction: 'debit', source: 'paytm' }],
  [PAYTM, 'You have received ₹300 from Amit', { merchant: 'Amit', paise: 30000, direction: 'credit', source: 'paytm' }],
  [GPAY, 'Payment of ₹250 to Zomato failed', null],
  [GPAY, 'Request for ₹250 from Rahul', null],
  [PHONEPE, 'Pay ₹250 to Rahul? Tap to approve', null],
  [GPAY, 'Scratch card: you won ₹50 cashback', null],
];

for (const [sender, text, want] of CASES) {
  test(`${sender.split('.').pop()}: ${text}`, () => {
    const r = p(text, sender);
    if (!want) return assert.equal(r, null);
    assert.ok(r, 'expected a transaction');
    assert.equal(r.merchant, want.merchant);
    assert.equal(r.amountPaise, want.paise);
    assert.equal(r.direction, want.direction);
    assert.equal(r.source, want.source);
  });
}
