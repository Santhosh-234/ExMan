import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyKind } from './kinds';

const k = (text: string, direction: 'debit' | 'credit' = 'debit', merchant: string | null = null, mode: string | null = null) => classifyKind({ text, merchant, direction, mode })?.kind ?? null;

test('mutual fund SIPs and broker transfers are investments', () => {
  assert.equal(k('Rs 5000.00 debited from a/c XX1234 towards SIP for HDFC Mutual Fund folio 1234567'), 'investment');
  assert.equal(k('INR 10,000 sent to ZERODHA BROKING via UPI Ref 123', 'debit', 'Zerodha Broking', 'UPI'), 'investment');
  assert.equal(k('Rs 2000 debited ACH D- ICCL-SIP'), 'investment');
  assert.equal(k('Your PPF contribution of Rs 1,50,000 debited'), 'investment');
  assert.equal(k('Redemption of units: Rs 25,000 credited to a/c XX1234 folio 998', 'credit'), 'investment');
  assert.equal(k('FD 123 booked for Rs 50,000. Debited from a/c XX9'), 'investment');
});

test('EMIs and loan repayments are loans', () => {
  assert.equal(k('Rs 12,450 debited towards EMI of loan a/c 1234 Bajaj Finance'), 'loan');
  assert.equal(k('ECS debit Rs 8,000 home loan instalment'), 'loan');
  assert.equal(k('Loan disbursal of Rs 2,00,000 credited to your a/c', 'credit'), 'loan');
});

test('fees and cash withdrawals are labelled but still count', () => {
  assert.equal(k('Rs 11.80 debited towards SMS charges incl GST'), 'fee');
  assert.equal(k('Rs 5,000 withdrawn at ATM Koramangala on card 1234', 'debit', null, 'ATM'), 'cash');
});

test('ordinary spending and offers stay regular', () => {
  assert.equal(k('Rs 349 debited to VPA swiggy@icici', 'debit', 'Swiggy', 'UPI'), null);
  assert.equal(k('Rs 120 paid to Chai Point via UPI', 'debit', 'Chai Point', 'UPI'), null);
  assert.equal(k('Pre-approved personal loan offer of Rs 5 lakh. Apply now. EMI from Rs 999'), null);
  assert.equal(k('Salary Rs 85,000 credited', 'credit'), null);
  assert.equal(k('Swiggy delivery charges Rs 30 paid by UPI', 'debit', 'Swiggy', 'UPI'), null);
});
