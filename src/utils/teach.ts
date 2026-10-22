// "Teach ExMan": the user taps the amount / merchant / account in a message the parser missed and we
// derive a per-sender pattern from the words around each tapped span.
import { type CurrencyCode, currencyInfo, currencyNear, isForeign } from './currency';
import { type ParsedTxn, bankFor, modeFor, sourceFor, extractBalance } from './parser';

export type Token = { text: string; start: number; end: number };
export type Selection = { amount: [number, number]; merchant?: [number, number]; account?: [number, number] }; // inclusive token indexes
export type Pattern = { amount_re: string; merchant_re: string | null; account_re: string | null; direction: 'debit' | 'credit'; currency?: string };
export type Taught = { amountPaise: number; merchant: string | null; account: string | null; direction: 'debit' | 'credit'; currency?: string };

const TOKEN = /[A-Za-z]+|\d[\d,]*(?:\.\d+)?|\S/g;
export const NUMERIC = /^(?:\d[\d,]*(?:\.\d+)?|\.\d+)$/;
const MAX_TEXT = 1500;

/** Currency written next to a tapped amount token ("32 USD", "USD 32", "$32"), so Teach can pick it automatically. */
export function detectCurrency(text: string, tokens: Token[], amountIndex: number): CurrencyCode | null {
  const t = tokens[amountIndex];
  return t ? currencyNear(text, t.start, t.end) : null;
}

export function tokenize(text: string): Token[] {
  const raw = [...text.slice(0, MAX_TEXT).matchAll(TOKEN)].map((m) => ({ text: m[0], start: m.index!, end: m.index! + m[0].length }));
  // ".32" written with no integer part is one number, but only when the dot starts a word ("Rs.500" keeps its dot apart)
  const out: Token[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i], n = raw[i + 1];
    const prev = out[out.length - 1];
    // ".32" is one number when the dot starts a word, or directly follows a foreign currency code or symbol ("USD.32", "$.32"); "Rs.500" keeps its dot apart
    const startsWord = t.start === 0 || /\s/.test(text[t.start - 1]) || (!!prev && prev.end === t.start && /^(?:USD|EUR|GBP|AED|SGD|AUD|CAD|CHF|JPY|THB|[$€£])$/i.test(prev.text));
    if (t.text === '.' && startsWord && n && n.start === t.end && /^\d+$/.test(n.text)) { out.push({ text: `.${n.text}`, start: t.start, end: n.end }); i++; }
    else out.push(t);
  }
  return out;
}

/** "VM-INDBNK-S" -> "indbnk": operator prefix and DLT suffix are not part of the bank's identity. */
export function senderKey(sender: string): string {
  const parts = sender.trim().toLowerCase().split('-');
  if (parts.length === 3 && parts[0].length === 2) return parts[1];
  if (parts.length === 2 && parts[0].length === 2) return parts[1];
  return sender.trim().toLowerCase();
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const frag = (tokens: Token[]) => tokens.map((t) => (NUMERIC.test(t.text) ? String.raw`(?:\d[\d,]*(?:\.\d+)?|\.\d+)` : esc(t.text))).join(String.raw`\s*`);

const AMOUNT_CAP = String.raw`((?:[\d,]+(?:\.\d{1,2})?|\.\d{1,2}))`;
const ACCOUNT_CAP = String.raw`(\d{3,4})`;
const MERCHANT_CAP = String.raw`([A-Za-z0-9][A-Za-z0-9 &'.@_/\-]*?)`;

// Wording that belongs to a bank's template rather than to one transaction (lower-case compare).
const STABLE_WORDS = new Set((
  'inr rs usd eur gbp aed sgd aud cad chf jpy thb upi neft imps rtgs atm pos ecs emi sms otp nach vpa ist xx debited credited debit credit spent paid pay payment payments received receive sent send withdrawn withdrawal deposited deposit '
  + 'transferred transfer purchase purchased txn trans transaction card account acct ac bank ending with at on to from for via using towards by of in your you has have been is was are successful successfully thank thanks dear customer '
  + 'alert info notice avl available bal balance limit lmt total ref reference rrn id no number not call if then block mandate online amount amt sale refund reversed reversal charged charge'
).split(/\s+/));

/**
 * Which tokens probably change from message to message (a merchant such as "Netflix", "AT&T" or "Joe's Cafe"), judged from one example:
 * a capitalised or ALL-CAPS word that is not known template wording. A whole run of characters with no space (SPOTIFY.COM, Joe's) counts
 * as one word. Such words must not become part of a pattern's context or it would only match that one merchant. In a message written
 * entirely in capitals case says nothing, so only dictionary wording counts as stable there.
 */
function variableWords(text: string, tokens: Token[]): (t: Token) => boolean {
  const alpha = (t: Token) => /^[A-Za-z]+$/.test(t.text);
  const letters = tokens.filter((t) => alpha(t) && t.text.length >= 2);
  const allCaps = letters.length > 2 && letters.filter((t) => t.text === t.text.toUpperCase()).length / letters.length > 0.8;
  const looksVariable = (t: Token) => {
    if (!alpha(t) || t.text.length < 2 || STABLE_WORDS.has(t.text.toLowerCase()) || /^x+$/i.test(t.text)) return false;
    return allCaps ? true : t.text[0] === t.text[0].toUpperCase();
  };
  // group tokens into space-free chunks; one variable word makes the whole chunk variable
  const chunkOf = new Map<Token, Token[]>();
  let cur: Token[] = [];
  const flush = () => { for (const t of cur) chunkOf.set(t, cur); cur = []; };
  tokens.forEach((t, i) => {
    if (i > 0 && t.start > tokens[i - 1].end) flush();
    cur.push(t);
  });
  flush();
  void text;
  const memo = new Map<Token[], boolean>();
  return (t) => {
    const chunk = chunkOf.get(t) ?? [t];
    if (!memo.has(chunk)) memo.set(chunk, chunk.some(looksVariable) || (chunk.length > 1 && chunk.some((x) => x.text === '&')));
    return memo.get(chunk)!;
  };
}

/** The stable words around a span: up to 3 before it (stopping at a variable word) and the next word if it is stable. */
function contextOf(text: string, tokens: Token[], [a, b]: [number, number]) {
  const variable = variableWords(text, tokens);
  const before: Token[] = [];
  // three tokens back, and keep going (up to six) until at least one real word is included: "card 1234 : $" alone says nothing
  for (let i = a - 1; i >= 0 && (before.length < 3 || (!before.some((t) => /^[A-Za-z]+$/.test(t.text)) && before.length < 6)); i--) {
    if (variable(tokens[i])) break;
    before.unshift(tokens[i]);
  }
  const next = tokens[b + 1];
  const after = next && !variable(next) ? [next] : [];
  return { before, after };
}

// the captured number must be the whole number, not the start of a longer one
const WHOLE_NUMBER = String.raw`(?![\d]|[.,]\d)`;

/** Regex = stable words before the span, a capture group, and the stable word after it (or a boundary when the next word varies). */
function fieldRegex(text: string, tokens: Token[], span: [number, number], capture: string, lazyTail = false, wholeNumber = false): string {
  const { before, after } = contextOf(text, tokens, span);
  const head = before.length ? `${frag(before)}${String.raw`\s*`}` : '';
  const tail = after.length ? `${String.raw`\s*`}${frag(after)}` : lazyTail ? String.raw`\s*(?:[.,;]|$)` : wholeNumber ? WHOLE_NUMBER : '';
  return `${head}${capture}${tail}`;
}

const hasWord = (ts: Token[]) => ts.some((t) => /^[A-Za-z]+$/.test(t.text));

export function buildPattern(text: string, sel: Selection, direction: 'debit' | 'credit', currency = 'INR'): { ok: true; pattern: Pattern; preview: Taught } | { ok: false; error: string } {
  const tokens = tokenize(text);
  const num = (r: [number, number]) => r[0] === r[1] && NUMERIC.test(tokens[r[0]]?.text ?? '');
  if (!num(sel.amount)) return { ok: false, error: 'Tap the amount (a single number).' };
  if (sel.account && !num(sel.account)) return { ok: false, error: 'The account must be a single number (last 3-4 digits).' };

  // too little context would match any number in any message from this sender
  const aCtx = contextOf(text, tokens, sel.amount);
  if (!hasWord([...aCtx.before, ...aCtx.after])) return { ok: false, error: 'There are no fixed words next to the amount to recognise this format (a merchant name next to it changes between messages). Try a message with wording like "debited" or "spent" beside the amount.' };

  const pattern: Pattern = {
    amount_re: fieldRegex(text, tokens, sel.amount, AMOUNT_CAP, false, true),
    merchant_re: sel.merchant ? fieldRegex(text, tokens, sel.merchant, MERCHANT_CAP, true) : null,
    account_re: sel.account ? fieldRegex(text, tokens, sel.account, ACCOUNT_CAP) : null,
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
