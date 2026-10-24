import assert from 'node:assert/strict';
import { test } from 'node:test';

import { xirr } from './xirr';

const D = 864e5, T0 = Date.UTC(2025, 0, 1);

test('one year, 10% growth', () => {
  const r = xirr([{ ts: T0, amount: -100000 }, { ts: T0 + 365 * D, amount: 110000 }])!;
  assert.ok(Math.abs(r - 0.1) < 1e-4, String(r));
});

test('a monthly SIP that grew', () => {
  const flows = Array.from({ length: 12 }, (_, i) => ({ ts: T0 + i * 30 * D, amount: -10000 }));
  flows.push({ ts: T0 + 365 * D, amount: 130000 }); // 120,000 put in, worth 130,000
  const r = xirr(flows)!;
  assert.ok(r > 0.1 && r < 0.25, String(r)); // more than 8% because the money was invested for less than a year on average
});

test('a loss is negative', () => {
  const r = xirr([{ ts: T0, amount: -100000 }, { ts: T0 + 365 * D, amount: 80000 }])!;
  assert.ok(Math.abs(r + 0.2) < 1e-4, String(r));
});

test('meaningless cases give null', () => {
  assert.equal(xirr([]), null);
  assert.equal(xirr([{ ts: T0, amount: -100 }]), null);
  assert.equal(xirr([{ ts: T0, amount: -100 }, { ts: T0 + 5 * D, amount: 200 }]), null); // under a month
  assert.equal(xirr([{ ts: T0, amount: -100 }, { ts: T0 + 400 * D, amount: -50 }]), null); // nothing back
});

import { holdingFor } from './holdings';

test('holdings are named from the message', () => {
  assert.deepEqual(holdingFor('Rs 5000 debited towards SIP for HDFC Mutual Fund folio 9988', null).name, 'HDFC Mutual Fund');
  assert.equal(holdingFor('Rs 2000 debited ACH D- ICCL', null).type, 'stocks');
  assert.equal(holdingFor('INR 10000 sent via UPI', 'Groww').name, 'Groww');
  assert.equal(holdingFor('Your PPF contribution debited', null).type, 'ppf');
  assert.equal(holdingFor('FD 1 booked', null).type, 'fd');
  assert.equal(holdingFor('SIP instalment debited', null).name, 'Mutual fund SIPs');
  assert.equal(holdingFor('something', 'Some Fund').type, 'other');
});
