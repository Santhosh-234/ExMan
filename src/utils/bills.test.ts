import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseBill } from './bills';

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 23, 59).getTime();

test('credit card statements: total due, not the minimum', () => {
  const b = parseBill('Total Amt Due Rs 12,345.00 or Min Amt Due Rs 617.00 is payable by 05-Nov-26 for your HDFC Bank Credit Card ending 1234', 'HDFC')!;
  assert.equal(b.amountPaise, 1234500);
  assert.equal(b.dueTs, day(2026, 11, 5));
  assert.equal(b.last4, '1234');
});

test('other statement wordings and date shapes', () => {
  const a = parseBill('Your SBI Card statement is generated. Total Amount Due: Rs.8,250.50, Minimum Amount Due: Rs.500. Payment due date: 18 Nov 2026')!;
  assert.equal(a.amountPaise, 825050);
  assert.equal(a.dueTs, day(2026, 11, 18));
  const u = parseBill('Dear customer, your electricity bill of Rs 1,420 is due on 25/10/2026. Pay now to avoid late fee.')!;
  assert.equal(u.amountPaise, 142000);
  assert.equal(u.dueTs, day(2026, 10, 25));
});

test('payment confirmations, offers and ordinary messages are not bills', () => {
  assert.equal(parseBill('Payment of Rs 12,345 received towards your credit card ending 1234. Thank you for your payment'), null);
  assert.equal(parseBill('Pre-approved loan offer! Apply now, EMI due from Rs 999'), null);
  assert.equal(parseBill('Rs 450 debited from a/c XX1234 to Swiggy'), null);
  assert.equal(parseBill('Your bill is due soon'), null); // no amount or date
});
