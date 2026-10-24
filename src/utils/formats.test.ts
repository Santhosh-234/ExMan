import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateFormat, validateLibrary, shareableProps } from './formats';
import { buildPattern, tokenize } from './teach';

const good = { id: 'indbnk-1a2b3c4d', sender_key: 'indbnk', direction: 'debit', amount_re: String.raw`spent\s*rs\s*((?:[\d,]+(?:\.\d{1,2})?))`, merchant_re: null, account_re: null, currency: 'INR' };

test('a well-formed format passes and keeps its fields', () => {
  assert.deepEqual(validateFormat(good), good);
  assert.equal(validateFormat({ ...good, merchant_re: '', account_re: '' })?.merchant_re, null);
});

test('malformed formats are refused', () => {
  const bad = [
    { ...good, id: 'Bad ID' }, { ...good, sender_key: 'x' }, { ...good, direction: 'both' }, { ...good, currency: 'inr' },
    { ...good, amount_re: '' }, { ...good, amount_re: '([a-z' }, { ...good, amount_re: '(a+)+$' }, { ...good, amount_re: 'x'.repeat(401) },
    { ...good, merchant_re: '(.*)*' }, null, 'text', {},
  ];
  for (const b of bad) assert.equal(validateFormat(b), null, JSON.stringify(b));
});

test('a library with one bad or duplicate entry is refused whole', () => {
  assert.equal(validateLibrary({ version: 1, formats: [good] })?.formats.length, 1);
  assert.equal(validateLibrary({ version: 1, formats: [good, { ...good, id: 'zz' , amount_re: '(' }] }), null);
  assert.equal(validateLibrary({ version: 1, formats: [good, good] }), null);
  assert.equal(validateLibrary({ version: -1, formats: [] }), null);
  assert.equal(validateLibrary({ version: 1.5, formats: [] }), null);
  assert.equal(validateLibrary({ version: 1, formats: 'x' }), null);
  assert.equal(validateLibrary(null), null);
  assert.equal(validateLibrary({ version: 2, formats: Array.from({ length: 501 }, (_, i) => ({ ...good, id: `f${i}` })) }), null);
});

test('a taught pattern is shareable only when it contains nothing but banking words', () => {
  const text = 'Spent Rs 450.50 on card ending 1234 at SWIGGY on 20-10-26';
  const toks = tokenize(text);
  const a = toks.findIndex((t) => t.text === '450.50');
  const built = buildPattern(text, { amount: [a, a] }, 'debit', 'INR');
  if (!built.ok) throw new Error('pattern not built');
  const props = shareableProps(built.pattern, 'VM-INDBNK-S');
  assert.ok(props, 'ordinary wording is shareable');
  assert.equal(props!.sender_key, 'indbnk');
  assert.ok(validateFormat({ id: 'indbnk-aaaaaaaa', sender_key: props!.sender_key, direction: props!.direction, amount_re: props!.rx_value, merchant_re: props!.rx_payee, account_re: props!.rx_acct, currency: props!.currency }));

  // a name in the context is never shared
  assert.equal(shareableProps({ ...built.pattern, amount_re: built.pattern.amount_re + 'priya' }, 'VM-INDBNK-S'), null);
  assert.equal(shareableProps({ amount_re: 'rs\\s*(\\d+)', merchant_re: null, account_re: null, direction: 'debit' }, 'ab'), null); // sender too short
});
