// Bank formats shared between phones through the project server. A format is plain data: a few regular expressions that locate the
// amount, payee and account in one bank's message layout. Nothing here is code, and everything downloaded is re-validated.
import { KEEP } from '@/telemetry/mask';
import { type Pattern, senderKey } from './teach';

export const MAX_FORMATS = 500;
export type LibraryFormat = { id: string; sender_key: string; direction: 'debit' | 'credit'; amount_re: string; merchant_re: string | null; account_re: string | null; currency: string };
export type Library = { version: number; formats: LibraryFormat[] };

const SENDER = /^[a-z0-9]{3,12}$/;
const ID = /^[a-z0-9_-]{1,40}$/;
const CURRENCY = /^[A-Z]{3}$/;
// a quantified group that itself contains a quantifier, e.g. (a+)+, is how regexes get exponentially slow
const NESTED = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/;

const okRegex = (s: unknown, required: boolean) => {
  if (s === null || s === undefined || s === '') return !required;
  if (typeof s !== 'string' || s.length > 400 || NESTED.test(s)) return false;
  try { new RegExp(s, 'i'); return true; } catch { return false; }
};

export function validateFormat(f: unknown): LibraryFormat | null {
  const x = f as Record<string, unknown> | null;
  if (!x || typeof x !== 'object') return null;
  if (typeof x.id !== 'string' || !ID.test(x.id) || typeof x.sender_key !== 'string' || !SENDER.test(x.sender_key)) return null;
  if (x.direction !== 'debit' && x.direction !== 'credit') return null;
  if (typeof x.currency !== 'string' || !CURRENCY.test(x.currency)) return null;
  if (!okRegex(x.amount_re, true) || !okRegex(x.merchant_re, false) || !okRegex(x.account_re, false)) return null;
  return { id: x.id, sender_key: x.sender_key, direction: x.direction, amount_re: x.amount_re as string, merchant_re: (x.merchant_re as string) || null, account_re: (x.account_re as string) || null, currency: x.currency };
}

/** The whole library, or null if any part of it is off (the app then keeps the library it already has). */
export function validateLibrary(x: unknown): Library | null {
  const l = x as { version?: unknown; formats?: unknown } | null;
  if (!l || typeof l !== 'object' || !Number.isInteger(l.version) || (l.version as number) < 0 || !Array.isArray(l.formats) || l.formats.length > MAX_FORMATS) return null;
  const formats: LibraryFormat[] = [];
  const seen = new Set<string>();
  for (const f of l.formats) {
    const v = validateFormat(f);
    if (!v || seen.has(v.id)) return null;
    seen.add(v.id);
    formats.push(v);
  }
  return { version: l.version as number, formats };
}

/** Words that appear literally in a regex (escapes and character classes removed). */
export function literalWords(re: string): string[] {
  return re.replace(/\\./g, ' ').replace(/\[[^\]]*\]/g, ' ').match(/[A-Za-z]+/g) ?? [];
}

/**
 * What a taught pattern looks like when shared: only if every literal word in it is ordinary banking vocabulary (the same list the
 * "Report a gap" masking keeps). A pattern that picked up a name or anything unusual is never offered.
 */
export function shareableProps(p: Pattern, sender: string): { sender_key: string; direction: 'debit' | 'credit'; rx_value: string; rx_payee: string; rx_acct: string; currency: string } | null {
  const parts = [p.amount_re, p.merchant_re ?? '', p.account_re ?? ''];
  if (parts.some((r) => r.length > 400)) return null;
  for (const r of parts) for (const w of literalWords(r)) if (w.length > 2 && !KEEP.has(w.toLowerCase())) return null;
  const sender_key = senderKey(sender);
  if (!SENDER.test(sender_key)) return null;
  return { sender_key, direction: p.direction, rx_value: p.amount_re, rx_payee: p.merchant_re ?? '', rx_acct: p.account_re ?? '', currency: p.currency ?? 'INR' };
}
