import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeMerchant } from './merchants';

const n = (s: string) => normalizeMerchant(s);

test('brand spellings collapse to one merchant', () => {
  for (const s of ['SWIGGY', 'swiggy@icici', 'Swiggy Instamart', 'SWIGGY LIMITED', 'swiggy.stores@axisbank'])
    assert.deepEqual(n(s), { key: 'swiggy', name: 'Swiggy' }, s);
  for (const s of ['AMAZON PAY IN', 'Amazon Pay', 'AMZN Mktp IN', 'amazon@apl', 'Amazon.in'])
    assert.equal(n(s)?.name, 'Amazon', s);
  assert.equal(n('UBER INDIA SYSTEMS PVT LTD')?.name, 'Uber');
  assert.equal(n('bigbasket@hdfcbank')?.name, 'BigBasket');
});

test('personal and unknown names are cleaned, not merged', () => {
  assert.deepEqual(n('rahul.sharma@oksbi'), { key: 'rahul sharma', name: 'Rahul Sharma' });
  assert.deepEqual(n('Chai Point'), { key: 'chai point', name: 'Chai Point' });
  assert.deepEqual(n('M/S SHARMA STORES PVT LTD'), { key: 'sharma stores', name: 'Sharma Stores' });
  assert.deepEqual(n('LOCAL MART 458812'), { key: 'local mart', name: 'Local Mart' });
  assert.equal(n('9876543210@ybl')?.name, '9876543210');
});

test('different QR handles stay distinct', () => {
  const a = n('paytmqr281005050101abc@paytm')!;
  const b = n('paytmqr281005050199xyz@paytm')!;
  assert.notEqual(a.key, b.key);
  assert.match(a.name, /^UPI QR/);
});

test('empty input', () => {
  assert.equal(n('  '), null);
  assert.equal(n('Pvt Ltd'), null);
});
