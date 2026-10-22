// Historical exchange rates. The only thing sent is a currency code and a date (never an amount, merchant or any identifier).
// Source: Frankfurter, a free keyless service republishing the European Central Bank's daily reference rates. It has no intraday history,
// so a rate is the one published for that day (the previous business day's on weekends and holidays), and it does not cover every currency.
import { toPaise } from './currency';

/** Currencies the rate service publishes (the ones ExMan knows about; AED is not among them). */
export const ONLINE_CODES: readonly string[] = ['USD', 'EUR', 'GBP', 'SGD', 'AUD', 'CAD', 'CHF', 'JPY', 'THB'];
export const FX_HOSTS = ['https://api.frankfurter.dev/v1', 'https://api.frankfurter.app'] as const;

export const localDay = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** URL for "rupees per 1 unit of `code` on `day`". A day that has not happened yet asks for the latest rate. */
export function rateUrl(host: string, day: string, code: string, today: string): string {
  const when = day > today ? 'latest' : day;
  return `${host}/${when}?base=${encodeURIComponent(code)}&symbols=INR`;
}

/** Reads the rate out of the service's answer; anything unexpected is null (never a guess). */
export function parseRate(body: unknown): number | null {
  const rate = (body as { rates?: { INR?: unknown } } | null)?.rates?.INR;
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 && rate < 100_000 ? rate : null;
}

export type FetchRate = (day: string, code: string) => Promise<number | null>;

/** Default fetcher: tries each host with a short timeout. Resolves null when offline or the answer is unusable. */
export function makeFetchRate(fetchFn: typeof fetch = fetch, now: () => number = Date.now): FetchRate {
  return async (day, code) => {
    const today = localDay(now());
    for (const host of FX_HOSTS) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      try {
        const res = await fetchFn(rateUrl(host, day, code, today), { signal: ctl.signal, headers: { Accept: 'application/json' } });
        if (!res.ok) continue;
        const rate = parseRate(await res.json());
        if (rate) return rate;
      } catch { /* try the next host */ } finally { clearTimeout(timer); }
    }
    return null;
  };
}

/** Rupee paise for a foreign amount at a published rate. */
export const paiseAt = (foreignMinor: number, code: string, rate: number) => toPaise(foreignMinor, code, rate);

export type FxSource = 'default' | 'user' | 'online' | 'edited';
export function describeRate(source: string | null | undefined, rate: number | null | undefined, code: string): string {
  const r = rate ? `1 ${code} = ₹${rate.toFixed(rate < 10 ? 3 : 2)}` : '';
  switch (source) {
    case 'online': return `${r} · that day's published rate`;
    case 'user': return `${r} · your rate from Exchange rates`;
    case 'edited': return 'You set this amount yourself';
    default: return `${r ? `${r} · ` : ''}approximate: no rate for that day yet`;
  }
}
