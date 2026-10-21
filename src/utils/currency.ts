// Foreign-currency card spends (e.g. "Spent USD 12.99 on your card"). Amounts are stored in INR paise using an
// approximate rate the user can edit; the original amount is kept alongside.
export const CURRENCIES = [
  { code: 'USD', symbol: '$', minor: 2, rate: 88 },
  { code: 'EUR', symbol: '€', minor: 2, rate: 95 },
  { code: 'GBP', symbol: '£', minor: 2, rate: 112 },
  { code: 'AED', symbol: 'AED ', minor: 2, rate: 24 },
  { code: 'SGD', symbol: 'S$', minor: 2, rate: 66 },
  { code: 'AUD', symbol: 'A$', minor: 2, rate: 58 },
  { code: 'CAD', symbol: 'C$', minor: 2, rate: 64 },
  { code: 'CHF', symbol: 'CHF ', minor: 2, rate: 105 },
  { code: 'JPY', symbol: '¥', minor: 0, rate: 0.58 },
  { code: 'THB', symbol: '฿', minor: 2, rate: 2.5 },
] as const;
export type CurrencyCode = (typeof CURRENCIES)[number]['code'];

const BY = new Map<string, (typeof CURRENCIES)[number]>(CURRENCIES.map((c) => [c.code, c]));
export const isForeign = (code: string | null | undefined): code is CurrencyCode => !!code && code !== 'INR' && BY.has(code);
export const currencyInfo = (code: string) => BY.get(code);

/** Amount in the currency's minor units (cents) -> INR paise at `rate` rupees per 1 unit. Rounds to the nearest paisa. */
export function toPaise(minor: number, code: string, rate: number): number {
  const c = BY.get(code);
  const units = minor / 10 ** (c?.minor ?? 2);
  return Math.max(1, Math.round(units * rate * 100));
}

export const formatForeign = (minor: number, code: string) => {
  const c = BY.get(code);
  const digits = c?.minor ?? 2;
  return `${code} ${(minor / 10 ** digits).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};

const CODES = CURRENCIES.map((c) => c.code).join('|');
const NUM = String.raw`([\d,]+(?:\.\d{1,2})?)`;
// "USD 32", "32 USD", "32.50USD", and currency symbols before the number ("$32", "US$ 32", "€10", "£5")
const BEFORE = new RegExp(String.raw`(?<![A-Za-z])(${CODES})\s?${NUM}`, 'gi');
const AFTER = new RegExp(String.raw`${NUM}\s?(${CODES})(?![A-Za-z])`, 'gi');
const SYMBOL = new RegExp(String.raw`(US\$|\$|€|£)\s?${NUM}`, 'g');
const SYMBOL_CODE: Record<string, CurrencyCode> = { 'US$': 'USD', $: 'USD', '€': 'EUR', '£': 'GBP' };
const BAL_BEFORE = /(?:bal(?:ance)?|limit|lmt|avl|available|outstanding|due)\W*(?:is|of|:|-)?\s*$/i;

/** Currency written right next to the amount at `text[start..end)`: a code on either side or a symbol before it. */
export function currencyNear(text: string, start: number, end: number): CurrencyCode | null {
  const before = text.slice(Math.max(0, start - 4), start);
  const after = text.slice(end, end + 5);
  const code = (s: string, re: RegExp) => { const m = s.match(re); return m ? (m[1].toUpperCase() as CurrencyCode) : null; };
  return code(before, new RegExp(String.raw`(?<![A-Za-z])(${CODES})\s?$`, 'i')) ?? code(after, new RegExp(String.raw`^\s?(${CODES})(?![A-Za-z])`, 'i'))
    ?? (/(US\$|\$)\s?$/.test(before) ? 'USD' : /€\s?$/.test(before) ? 'EUR' : /£\s?$/.test(before) ? 'GBP' : null);
}

/** First foreign-currency amount in a message that is not a balance or limit figure. Either order: "USD 32" or "32 USD". */
export function extractForeign(text: string): { code: CurrencyCode; minor: number } | null {
  const hits: { index: number; code: CurrencyCode; num: string }[] = [];
  for (const m of text.matchAll(BEFORE)) hits.push({ index: m.index!, code: m[1].toUpperCase() as CurrencyCode, num: m[2] });
  for (const m of text.matchAll(AFTER)) hits.push({ index: m.index!, code: m[2].toUpperCase() as CurrencyCode, num: m[1] });
  for (const m of text.matchAll(SYMBOL)) hits.push({ index: m.index!, code: SYMBOL_CODE[m[1]], num: m[2] });
  hits.sort((a, b) => a.index - b.index);
  for (const h of hits) {
    if (BAL_BEFORE.test(text.slice(Math.max(0, h.index - 30), h.index))) continue;
    const info = BY.get(h.code)!;
    const minor = Math.round(parseFloat(h.num.replace(/,/g, '')) * 10 ** info.minor);
    if (minor > 0) return { code: h.code, minor };
  }
  return null;
}
