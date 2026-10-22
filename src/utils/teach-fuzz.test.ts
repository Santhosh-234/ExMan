import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reprocessUnparsed, run } from '../ingest/core';
import { savePattern } from '../db/patterns';
import { buildPattern, tokenize } from './teach';
import { makeDb } from './testdb';
import { parseMessage } from './parser';

// Randomised end-to-end check of Teach ExMan: for many message layouts (currency before/after the amount, symbols, odd verbs, merchants that
// change, ALL CAPS messages, balance/limit tails) a taught message must be kept for teaching, recorded with the right amount, and a later
// message in the same layout (different merchant, amount, card) must be read automatically with its own amount.
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

const verbs = ['hit', 'gone', 'charged', 'applied', 'posted', 'booked', 'logged', 'noted'];
const merchants = ['NETFLIX', 'UBER', 'AMAZON PRIME', 'AT&T', 'SPOTIFY.COM', 'APPLE', 'Joe\'s Cafe', 'STEAM', 'Swiggy', 'Amazon Pay', 'Big Basket', 'McDonalds'];
const tails = ['', ' Limit Rs 50000', ' Avl Lmt INR 1,20,000.00', ' Bal: Rs.5,000.25', '. Ref 8841123', ' on 20-Oct-26 10:21', ' Not you? Call 1800'];
const heads = ['', 'ALERT: ', 'Card alert - ', 'Dear Customer, ', 'INFO '];
const cur = ['USD', 'EUR', 'GBP', 'AED', 'INR'];
const amts = () => pick(['32', '32.00', '45.5', '1,234.50', '100', '7.99', '12,500', '1,20,000.00', '.32', '0.99']);
const okAmt = (a: string, c: string) => !(a.startsWith('.') && (c === 'INR'));
let V = 'hit';
const fmts: ((a: string, c: string, m: string, k: string) => string)[] = [
  (a, c, m, k) => `${k} ${V}: ${c} ${a} ${m}`,
  (a, c, m, k) => `${k} ${V}: ${a} ${c} ${m}`,
  (a, c, m, k) => `Card ${k} ${V} for ${c} ${a} at ${m}`,
  (a, c, m, k) => `${c}${a} ${V} at ${m} card ${k}`,
  (a, c, m, k) => `Your card ${k} ${V} ${a} ${c} at ${m}`,
  (a, c, m, k) => (c === 'USD' ? `${V} $${a} at ${m} card ${k}` : `${V} ${c} ${a} at ${m} card ${k}`),
];

const toMinor = (a: string) => Math.round(parseFloat(a.replace(/,/g, '')) * 100);


async function fuzz(s: number, N: number) {
  seed = s;
  const fails: Record<string, string[]> = {};
  const note = (k: string, d: string) => ((fails[k] ??= []).length < 3 && fails[k].push(d), 0);

  for (let n = 0; n < N; n++) {
  const f = fmts[Math.floor(rnd() * fmts.length)];
  const c0 = pick(cur); const c = c0, a0 = amts(), a = a0.startsWith('.') && c0 === 'INR' ? '32' : a0, m = pick(merchants), k = String(1000 + Math.floor(rnd() * 8999));
  V = pick(verbs);
  const caps = rnd() < 0.2;
  let text = pick(heads) + f(a, c, m, k) + pick(tails);
  if (caps) text = text.toUpperCase();
  const sender = pick(['VM-NEWBNK-S', 'AX-NEWBNK', 'NEWBNK', 'JD-NEWBNK-T']);
  if (parseMessage(text, { sender, ts: 1 })) continue; // the built-in parser already reads it: not a Teach case
  const { db, raw } = await makeDb();
  await run(db, [{ kind: 'sms', sender, text, ts: Date.parse('2026-10-20T10:00:00Z') }], 0);
  const inUnparsed = (raw.prepare('SELECT COUNT(*) n FROM unparsed').get() as any).n;
  if (!inUnparsed) { note('not kept for teaching', text); continue; }
  const toks = tokenize(text);
  // the amount token is the one that equals the generated amount string (first occurrence after currency position)
  const idx = toks.findIndex((t) => t.text === a);
  if (idx < 0) { note('tokenizer lost the amount', `${a} | ${text} | ${JSON.stringify(toks.map((t) => t.text))}`); continue; }
  const built = buildPattern(text, { amount: [idx, idx] }, 'debit', c);
  if (!built.ok) { note('pattern did not build: ' + built.error, text); continue; }
  await savePattern(db, sender, built.pattern, text);
  const added = await reprocessUnparsed(db);
  const t = raw.prepare('SELECT amount_paise, currency, foreign_minor FROM transactions').all() as any[];
  if (added !== 1 || t.length !== 1) { note(`not recorded after teaching (added=${added})`, text); continue; }
  if (c === 'INR') { if (t[0].amount_paise !== toMinor(a)) note('wrong INR amount', `${text} => ${t[0].amount_paise}`); }
  else if (t[0].foreign_minor !== toMinor(a) || t[0].currency !== c) note('wrong foreign amount', `${text} => ${JSON.stringify(t[0])}`);
  // same format, different numbers: must be read automatically now
  const a2 = (() => { const z = amts(); return z.startsWith('.') && c === 'INR' ? '45.5' : z; })(), m2 = pick(merchants), k2 = String(1000 + Math.floor(rnd() * 8999));
  const m2c = caps ? m2.toUpperCase() : m2; const mc = caps ? m.toUpperCase() : m;
  const t2 = pick(heads); void t2; const text2 = (() => { const x = (heads.find((h) => text.startsWith(caps ? h.toUpperCase() : h) && h !== '') ?? '') + f(a2, c, m2, k2) + (tails.find((tl) => text.endsWith(caps ? tl.toUpperCase() : tl) && tl !== '') ?? ''); return caps ? x.toUpperCase() : x; })();
  const before = (raw.prepare('SELECT COUNT(*) n FROM transactions').get() as any).n;
  await run(db, [{ kind: 'sms', sender, text: text2, ts: Date.parse('2026-10-21T10:00:00Z') }], 0);
  const after = (raw.prepare('SELECT COUNT(*) n FROM transactions').get() as any).n;
  if (after !== before + 1 && text2 !== text) note('same-format message not read', `${text2} <= taught on: ${text} | re=${(built as any).pattern.amount_re} | unparsed=${(raw.prepare('SELECT COUNT(*) n FROM unparsed').get() as any).n} | txns=${JSON.stringify(raw.prepare('SELECT amount_paise,ts FROM transactions').all())}`);
  else if (text2 !== text) {
    const last = raw.prepare('SELECT amount_paise, currency, foreign_minor FROM transactions ORDER BY id DESC LIMIT 1').get() as any;
    const got = c === 'INR' ? last.amount_paise : last.foreign_minor;
    if (got !== toMinor(a2)) note('same-format message read with wrong amount', `${text2} => ${JSON.stringify(last)} (want ${toMinor(a2)})`);
  }
}

  return fails;
}

for (const s of [1, 2, 3]) test(`teach fuzz, seed ${s}`, async () => { assert.deepEqual(await fuzz(s, 300), {}); });
