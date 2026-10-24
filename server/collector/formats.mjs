// The bank-format library: message formats the owner has vetted, served to every install as plain data (no code), so a new bank
// layout can be read without shipping an app update. A copy of the validation lives in the app (src/utils/formats.ts) and the app
// re-checks everything it downloads; this side refuses to serve anything malformed.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

export const MAX_FORMATS = 500;
const SENDER = /^[a-z0-9]{3,12}$/;
const ID = /^[a-z0-9_-]{1,40}$/;
const CURRENCY = /^[A-Z]{3}$/;
// a quantified group that itself contains a quantifier, e.g. (a+)+, is how regexes get exponentially slow
const NESTED = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/;

const okRegex = (s, required) => {
  if (s === null || s === '') return !required;
  if (typeof s !== 'string' || s.length > 400 || NESTED.test(s)) return false;
  try { new RegExp(s, 'i'); return true; } catch { return false; }
};

/** A clean copy of one format, or null when anything about it is off. */
export function validateFormat(f) {
  if (!f || typeof f !== 'object') return null;
  if (typeof f.id !== 'string' || !ID.test(f.id) || typeof f.sender_key !== 'string' || !SENDER.test(f.sender_key)) return null;
  if (f.direction !== 'debit' && f.direction !== 'credit') return null;
  if (typeof f.currency !== 'string' || !CURRENCY.test(f.currency)) return null;
  if (!okRegex(f.amount_re, true) || !okRegex(f.merchant_re ?? null, false) || !okRegex(f.account_re ?? null, false)) return null;
  return { id: f.id, sender_key: f.sender_key, direction: f.direction, amount_re: f.amount_re, merchant_re: f.merchant_re || null, account_re: f.account_re || null, currency: f.currency };
}

export function validateLibrary(x) {
  if (!x || typeof x !== 'object' || !Number.isInteger(x.version) || x.version < 0 || !Array.isArray(x.formats) || x.formats.length > MAX_FORMATS) return null;
  const formats = [];
  const seen = new Set();
  for (const f of x.formats) {
    const v = validateFormat(f);
    if (!v || seen.has(v.id)) return null; // one bad entry rejects the file: better to serve the last good version than half of a broken one
    seen.add(v.id);
    formats.push(v);
  }
  return { version: x.version, formats };
}

export const EMPTY = { version: 0, formats: [] };

/** Reads `file` when it changes. Anything missing or invalid serves the empty library, never a partial one. */
export function formatsSource(file) {
  let mtime = -1, cached = null;
  return () => {
    let m = 0;
    try { m = statSync(file).mtimeMs; } catch { m = 0; }
    if (cached && m === mtime) return cached;
    let lib = EMPTY;
    if (m) { try { lib = validateLibrary(JSON.parse(readFileSync(file, 'utf8'))) ?? EMPTY; } catch { lib = EMPTY; } }
    const body = JSON.stringify(lib);
    mtime = m;
    cached = { body, etag: `"${createHash('sha256').update(body).digest('hex').slice(0, 16)}"`, version: lib.version, count: lib.formats.length };
    return cached;
  };
}
