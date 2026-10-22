import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeRate, localDay, makeFetchRate, parseRate, rateUrl } from './fx';

test('rate URL asks for the day, or the latest rate for a day that has not happened', () => {
  assert.equal(rateUrl('https://h/v1', '2026-10-20', 'USD', '2026-10-22'), 'https://h/v1/2026-10-20?base=USD&symbols=INR');
  assert.equal(rateUrl('https://h/v1', '2026-10-25', 'USD', '2026-10-22'), 'https://h/v1/latest?base=USD&symbols=INR');
});

test('only a sane INR rate is accepted', () => {
  assert.equal(parseRate({ amount: 1, base: 'USD', date: '2026-10-20', rates: { INR: 83.12 } }), 83.12);
  for (const bad of [null, {}, { rates: {} }, { rates: { INR: 'x' } }, { rates: { INR: 0 } }, { rates: { INR: -3 } }, { rates: { INR: 1e9 } }, { rates: { INR: NaN } }]) assert.equal(parseRate(bad), null);
});

test('local day formatting', () => {
  assert.equal(localDay(new Date(2026, 9, 5, 23, 59).getTime()), '2026-10-05');
  assert.equal(localDay(new Date(2026, 0, 1, 0, 0).getTime()), '2026-01-01');
});

test('the fetcher falls through to the second host and returns null when both fail', async () => {
  const calls: string[] = [];
  const first = (async (url: string) => { calls.push(url); return url.includes('frankfurter.dev') ? { ok: false } : { ok: true, json: async () => ({ rates: { INR: 90.5 } }) }; }) as unknown as typeof fetch;
  assert.equal(await makeFetchRate(first, () => Date.parse('2026-10-22T10:00:00Z'))('2026-10-20', 'USD'), 90.5);
  assert.equal(calls.length, 2);
  const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  assert.equal(await makeFetchRate(down)('2026-10-20', 'USD'), null);
});

test('the explanation says where the rate came from', () => {
  assert.match(describeRate('online', 83.123, 'USD'), /1 USD = ₹83\.12 · that day's published rate/);
  assert.match(describeRate('user', 88, 'USD'), /your rate/);
  assert.match(describeRate('edited', null, 'USD'), /yourself/);
  assert.match(describeRate('default', 88, 'USD'), /approximate/);
  assert.match(describeRate(null, null, 'USD'), /approximate/);
});
