// "Teach ExMan": the user taps the amount / merchant / account in a message the parser missed and we
// derive a per-sender pattern from the words around each tapped span.
import { type CurrencyCode, currencyInfo, currencyNear, isForeign } from './currency';
import { type ParsedTxn, bankFor, modeFor, sourceFor, extractBalance } from './parser';

export type Token = { text: string; start: number; end: number };
export type Selection = { amount: [number, number]; merchant?: [number, number]; account?: [number, number] }; // inclusive token indexes
export type Pattern = { amount_re: string; merchant_re: string | null; account_re: string | null; direction: 'debit' | 'credit'; currency?: string };
export type Taught = { amountPaise: number; merchant: string | null; account: string | null; direction: 'debit' | 'credit'; currency?: string };

const TOKEN = /[A-Za-z]+|\d[\d,]*(?:\.\d+)?|\S/g;
const NUMERIC = /^\d[\d,]*(?:\.\d+)?$/;
const MAX_TEXT = 1500;

/** Currency written next to a tapped amount token ("32 USD", "USD 32", "$32"), so Teach can pick it automatically. */
export function detectCurrency(text: string, tokens: Token[], amountIndex: number): CurrencyCode | null {
  const t = tokens[amountIndex];
  return t ? currencyNear(text, t.start, t.end) : null;
}

export function tokenize(text: string): Token[] {
  return [...text.slice(0, MAX_TEXT).matchAll(TOKEN)].map((m) => ({ text: m[0], start: m.index!, end: m.index! + m[0].length }));
}

/** "VM-INDBNK-S" -> "indbnk": operator prefix and DLT suffix are not part of the bank's identity. */
export function senderKey(sender: string): string {
  const parts = sender.trim().toLowerCase().split('-');
  if (parts.length === 3 && parts[0].length === 2) return parts[1];
  if (parts.length === 2 && parts[0].length === 2) return parts[1];
  return sender.trim().toLowerCase();
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const frag = (tokens: Token[]) => tokens.map((t) => (NUMERIC.test(t.text) ? String.raw`\d[\d,]*(?:\.\d+)?` : esc(t.text))).join(String.raw`\s*`);

const AMOUNT_CAP = String.raw`([\d,]+(?:\.\d{1,2})?)`;
const ACCOUNT_CAP = String.raw`(\d{3,4})`;
const MERCHANT_CAP = String.raw`([A-Za-z0-9][A-Za-z0-9 &'.@_/\-]*?)`;

/** Regex = up to 3 words before the span, a capture group, and the next word after it. */
function fieldRegex(tokens: Token[], [a, b]: [number, number], capture: string, lazyTail = false): string {
  const before = tokens.slice(Math.max(0, a - 3), a);
  const after = tokens.slice(b + 1, b + 2);
  const head = before.length ? `${frag(before)}${String.raw`\s*`}` : '';
  const tail = after.length ? `${String.raw`\s*`}${frag(after)}` : lazyTail ? String.raw`\s*(?:[.,;]|$)` : '';
  return `${head}${capture}${tail}`;
}

const hasWord = (ts: Token[]) => ts.some((t) => /^[A-Za-z]+$/.test(t.text));

export function buildPattern(text: string, sel: Selection, direction: 'debit' | 'credit', currency = 'INR'): { ok: true; pattern: Pattern; preview: Taught } | { ok: false; error: string } {
  const tokens = tokenize(text);
  const num = (r: [number, number]) => r[0] === r[1] && NUMERIC.test(tokens[r[0]]?.text ?? '');
  if (!num(sel.amount)) return { ok: false, error: 'Tap the amount (a single number).' };
  if (sel.account && !num(sel.account)) return { ok: false, error: 'The account must be a single number (last 3-4 digits).' };

  // too little context would match any number in any message from this sender
  const aCtx = tokens.slice(Math.max(0, sel.amount[0] - 3), sel.amount[0]).concat(tokens.slice(sel.amount[1] + 1, sel.amount[1] + 2));
  if (!hasWord(aCtx)) return { ok: false, error: 'There are no words next to the amount to recognise this format. Pick a message with text around the amount.' };

  const pattern: Pattern = {
    amount_re: fieldRegex(tokens, sel.amount, AMOUNT_CAP),
    merchant_re: sel.merchant ? fieldRegex(tokens, sel.merchant, MERCHANT_CAP, true) : null,
    account_re: sel.account ? fieldRegex(tokens, sel.account, ACCOUNT_CAP) : null,
    direction,
    currency,
  };
  // the pattern must reproduce exactly what the user tapped on the example message
  const got = applyPattern(text, pattern);
  const want = (r?: [number, number]) => (r ? text.slice(tokens[r[0]].start, tokens[r[1]].end) : null);
  const amtWant = Math.round(parseFloat(want(sel.amount)!.replace(/,/g, '')) * 100);
  if (!got || got.amountPaise !== amtWant) return { ok: false, error: 'Could not build a reliable pattern from this selection. Try selecting again.' };
  if (sel.merchant && got.merchant?.toLowerCase() !== want(sel.merchant)!.toLowerCase()) return { ok: false, error: 'The merchant selection did not round-trip. Select just the name.' };
  if (sel.account && got.account !== want(sel.account)) return { ok: false, error: 'The account selection did not round-trip.' };
  return { ok: true, pattern, preview: got };
}

export function applyPattern(text: string, p: Pattern): Taught | null {
  const t = text.slice(0, MAX_TEXT);
  const amt = new RegExp(p.amount_re, 'i').exec(t);
  if (!amt) return null;
  const amountPaise = Math.round(parseFloat(amt[1].replace(/,/g, '')) * 100);
  if (!(amountPaise > 0)) return null;
  const m = p.merchant_re ? new RegExp(p.merchant_re, 'i').exec(t) : null;
  const a = p.account_re ? new RegExp(p.account_re, 'i').exec(t) : null;
  return { amountPaise, direction: p.direction, merchant: m?.[1]?.trim() || null, account: a?.[1] ?? null, currency: p.currency ?? 'INR' };
}

/** Same shape the built-in parser returns, so ingest treats taught messages identically. */
export function toParsed(text: string, sender: string, ts: number, taught: Taught): ParsedTxn {
  // a foreign amount keeps its original value; ingest converts it to rupees with the user's rate
  const foreign = isForeign(taught.currency);
  const minor = foreign ? Math.round((taught.amountPaise / 100) * 10 ** (currencyInfo(taught.currency!)?.minor ?? 2)) : undefined;
  return {
    amountPaise: foreign ? 0 : taught.amountPaise,
    ...(foreign ? { currency: taught.currency as CurrencyCode, foreignMinor: minor } : {}), direction: taught.direction, merchant: taught.merchant, account: taught.account,
    bank: bankFor(sender, text), balance: extractBalance(text), mode: modeFor(text), source: sourceFor(sender), ts,
  };
}
