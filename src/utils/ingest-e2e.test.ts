import assert from 'node:assert/strict';
import { test } from 'node:test';

import { savePattern } from '../db/patterns';
import { reprocessUnparsed, run } from '../ingest/core';
import { buildPattern, tokenize } from './teach';
import { makeDb } from './testdb';

const SENDER = 'VM-NEWBNK-S';
const T0 = Date.parse('2026-10-20T10:00:00Z');

/** Simulates a user teaching one message: ingest it (it lands in Unrecognised), tap the amount, save, reprocess. */
async function teach(text: string, tap: string, opts: { direction?: 'debit' | 'credit'; currency?: string; merchant?: [string, string]; nth?: number } = {}) {
  const { db, raw } = await makeDb();
  await run(db, [{ kind: 'sms', sender: SENDER, text, ts: T0 }], 0);
  const stored = (raw.prepare('SELECT COUNT(*) AS n FROM unparsed').get() as { n: number }).n;
  const toks = tokenize(text);
  const idx = (w: string, nth = 0) => { let seen = 0; for (let i = 0; i < toks.length; i++) if (toks[i].text === w && seen++ === nth) return i; return -1; };
  const a = idx(tap, opts.nth ?? 0);
  assert.ok(a >= 0, `token ${tap} not found in ${JSON.stringify(toks.map((t) => t.text))}`);
  const sel: Parameters<typeof buildPattern>[1] = { amount: [a, a] };
  if (opts.merchant) sel.merchant = [idx(opts.merchant[0]), idx(opts.merchant[1])];
  const built = buildPattern(text, sel, opts.direction ?? 'debit', opts.currency ?? 'INR');
  if (!built.ok) return { db, raw, stored, built, added: 0 };
  await savePattern(db, SENDER, built.pattern, text);
  const added = await reprocessUnparsed(db);
  return { db, raw, stored, built, added };
}
const txns = (raw: import('node:sqlite').DatabaseSync) => raw.prepare('SELECT amount_paise, direction, currency, foreign_minor, merchant FROM transactions').all() as { amount_paise: number; direction: string; currency: string | null; foreign_minor: number | null; merchant: string | null }[];

const CASES: { name: string; text: string; tap: string; currency?: string; direction?: 'debit' | 'credit'; paise?: number; foreign?: number; nth?: number }[] = [
  { name: 'rupee amount before INR code', text: 'ALERT: 450.50 INR gone from acct 1234 for SWIGGY ORDER on 20Oct', tap: '450.50', paise: 45050 },
  { name: 'USD code before amount, INR limit', text: 'Charge alert: USD 32.00 NETFLIX card 1234 Limit Rs 50000', tap: '32.00', currency: 'USD', foreign: 3200 },
  { name: 'USD code after amount, INR limit', text: 'Card 1234 charged 32.00 USD at NETFLIX. Limit Rs 50000', tap: '32.00', currency: 'USD', foreign: 3200 },
  { name: 'USD only, no rupee anywhere', text: 'Hit on card 1234: 32 USD NETFLIX', tap: '32', currency: 'USD', foreign: 3200 },
  { name: 'dollar sign, no rupee anywhere', text: 'Hit on card 9876: $45.50 UBER', tap: '45.50', currency: 'USD', foreign: 4550 },
  { name: 'EUR, no rupee anywhere', text: 'Hit on card 1234 for EUR 12.00 SPOTIFY', tap: '12.00', currency: 'EUR', foreign: 1200 },
  { name: 'thousands separator', text: 'Hit on card 1234: USD 1,234.50 APPLE Limit Rs 50000', tap: '1,234.50', currency: 'USD', foreign: 123450 },
  { name: 'two amounts, tap first', text: 'Hit: 32.00 USD NETFLIX; balance 1,20,000.00 INR card 1234', tap: '32.00', currency: 'USD', foreign: 3200 },
  { name: 'leading dot', text: 'Hit on card 1234: .32 USD NETFLIX. Limit Rs 50000', tap: '.32', currency: 'USD', foreign: 32 },
  { name: 'credit in USD', text: 'Money arrived: USD 100.00 on account 1234 from PAYPAL. Bal Rs 5000', tap: '100.00', currency: 'USD', direction: 'credit', foreign: 10000 },
  { name: 'multi-line', text: 'Card alert\nAmount: USD 32.00\nMerchant: NETFLIX\nLimit: Rs 50000', tap: '32.00', currency: 'USD', foreign: 3200 },
  { name: 'rupee symbol, odd verb', text: 'Hit on card 1234: ₹ 450 ZOMATO', tap: '450', paise: 45000 },
  { name: 'same number twice, tap second', text: 'Rs 500 limit. Hit 500 at SHOP card 1234 on 20Oct', tap: '500', nth: 1, paise: 50000 },
  { name: 'amount directly after colon', text: 'Alert: 750.00 INR CAFE card 1234', tap: '750.00', paise: 75000 },
  { name: 'trailing amount', text: 'Your card 1234 hit at CAFE for 750.00 INR', tap: '750.00', paise: 75000 },
];

for (const c of CASES) {
  test(`teach: ${c.name}`, async () => {
    const r = await teach(c.text, c.tap, { currency: c.currency, direction: c.direction, nth: c.nth });
    assert.ok(r.built.ok, `pattern should build: ${r.built.ok ? '' : r.built.error}`);
    assert.equal(r.stored, 1, 'the message should reach the Unrecognised list so it can be taught');
    assert.equal(r.added, 1, 'reprocessing should record the taught message');
    const t = txns(r.raw);
    assert.equal(t.length, 1);
    assert.equal(t[0].direction, c.direction ?? 'debit');
    if (c.foreign) { assert.equal(t[0].currency, c.currency); assert.equal(t[0].foreign_minor, c.foreign); assert.ok(t[0].amount_paise > 0, 'converted rupee amount must be positive'); }
    else assert.equal(t[0].amount_paise, c.paise);
    assert.equal((r.raw.prepare('SELECT COUNT(*) AS n FROM unparsed').get() as { n: number }).n, 0, 'taught message leaves the Unrecognised list');
  });
}
