import assert from 'node:assert/strict';
import { test } from 'node:test';

import { maskMessage } from '../telemetry/mask';
import { EVENTS, bucketMessages, bucketMs, sanitize } from '../telemetry/schema';

test('unknown events are rejected; unknown properties are stripped', () => {
  assert.equal(sanitize('transaction_created', { amount: 500 }), null);
  const e = sanitize('review_action', { action: 'confirm', via: 'swipe', amount: 500, merchant: 'Swiggy', note: 'x' });
  assert.deepEqual(e, { name: 'review_action', props: { action: 'confirm', via: 'swipe' } });
});

test('values must match the allow-list (enums, patterns, ranges)', () => {
  assert.equal(sanitize('review_action', { action: 'delete everything', via: 'swipe' }), null);
  assert.equal(sanitize('feature_used', { feature: 'manual_add' })?.props.feature, 'manual_add');
  assert.equal(sanitize('feature_used', { feature: 'Swiggy 450' }), null);
  assert.equal(sanitize('parser_stats', { bank: 'HDFC', parsed: -1, unrecognised: 0, taught: 0 }), null);
  assert.equal(sanitize('parser_stats', { bank: 'HDFC', parsed: 12, unrecognised: 1, taught: 0 })?.props.parsed, 12);
  assert.equal(sanitize('error', { kind: 'js_error', screen: 'home', code: 'TypeError' })?.props.code, 'TypeError');
  // an error code can't smuggle free text: spaces and long strings fail the pattern
  assert.equal(sanitize('error', { kind: 'js_error', screen: 'home', code: 'Cannot read 450 of Swiggy' }), null);
  assert.equal(sanitize('app_open', { version: '1.0.0', runtime: '12bf9e92', update: 'ota', os_version: 14 })?.props.os_version, 14);
  assert.equal(sanitize('app_open', { version: '1.0', runtime: '12bf9e92', update: 'ota', os_version: 14 }), null);
});

test('no event can carry financial content: only counts, enums, versions and masked templates are allowed', () => {
  for (const [name, spec] of Object.entries(EVENTS))
    for (const key of Object.keys(spec)) assert.doesNotMatch(key, /amount|merchant|account|balance|name|text|vpa|phone|number/i, `${name}.${key}`);
});

test('masked templates drop digits, names, UPI ids and links but keep structure', () => {
  const m = maskMessage('Rs. 1,250.00 debited from a/c XX1234 on 20-10-26 to VPA rahul.sharma@oksbi (UPI Ref 123456789012). Avl Bal Rs 9,000.50. Not you? Call 1800 425 0000 or visit https://bank.example/fraud');
  assert.ok(!/\d/.test(m), m);
  assert.ok(!/rahul|sharma|oksbi|example/i.test(m), m);
  assert.match(m, /^Rs\. #,#\.# debited from a\/c XX# on #-#-# to VPA <VPA> \(UPI Ref #\)\. Avl Bal Rs #,#\.#\. Not you\? Call # # # or <W> <URL>$/);
  assert.match(sanitize('gap_report', { sender_key: 'indbnk', template: m })?.props.template as string, /debited/);
  assert.equal(maskMessage('Paid ₹450 to Chai Point Pvt Ltd'), 'Paid ₹# to <W>');
});

test('buckets', () => {
  assert.deepEqual([bucketMessages(5), bucketMessages(500), bucketMessages(2000), bucketMessages(9000)], ['<100', '100-1k', '1k-5k', '5k+']);
  assert.deepEqual([bucketMs(200), bucketMs(3000), bucketMs(9000), bucketMs(30000)], ['<1s', '1-5s', '5-15s', '15s+']);
});
