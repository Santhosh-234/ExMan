export type Flow = { ts: number; amount: number }; // negative = money you put in, positive = money you got back (or what it is worth now)

const YEAR = 365 * 864e5;

/**
 * Annualised return (XIRR) for dated cash flows: the rate r where the flows discounted to the first date add up to zero.
 * Null when it is meaningless: no money in, nothing back, or under a month of history (annualising a few days is noise).
 */
export function xirr(flows: Flow[]): number | null {
  if (flows.length < 2) return null;
  const f = [...flows].sort((a, b) => a.ts - b.ts);
  if (!f.some((x) => x.amount < 0) || !f.some((x) => x.amount > 0)) return null;
  if (f[f.length - 1].ts - f[0].ts < 30 * 864e5) return null;
  const t0 = f[0].ts;
  const npv = (r: number) => f.reduce((s, x) => s + x.amount / Math.pow(1 + r, (x.ts - t0) / YEAR), 0);
  let lo = -0.99, hi = 10; // -99% .. +1000% a year
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}
