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
const FOREIGN = new RegExp(String.raw`\b(${CODES})\s?([\d,]+(?:\.\d{1,2})?)`, 'i');
const BAL_BEFORE = /(?:bal(?:ance)?|limit|lmt|avl|available|outstanding|due)\W*(?:is|of|:|-)?\s*$/i;

/** First foreign-currency amount in a message that is not a balance or limit figure. */
export function extractForeign(text: string): { code: CurrencyCode; minor: number } | null {
  const re = new RegExp(FOREIGN.source, 'gi');
  for (const m of text.matchAll(re)) {
    if (BAL_BEFORE.test(text.slice(Math.max(0, m.index! - 30), m.index!))) continue;
    const code = m[1].toUpperCase() as CurrencyCode;
    const info = BY.get(code)!;
    const minor = Math.round(parseFloat(m[2].replace(/,/g, '')) * 10 ** info.minor);
    if (minor > 0) return { code, minor };
  }
  return null;
}
