// Finds payments that repeat on a schedule (subscriptions, rent, regular bills) from a merchant's charge history.
export type Charge = { merchant_id: number; merchant: string; amount_paise: number; ts: number };
export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type Recurring = {
  merchant_id: number;
  merchant: string;
  cadence: Cadence;
  intervalDays: number;
  amount: number; // latest charge
  typical: number; // median of the charges before the latest one
  varies: boolean; // amounts differ between cycles (a bill) rather than a fixed price (a subscription)
  count: number;
  firstTs: number;
  lastTs: number;
  nextTs: number;
  monthlyCost: number;
  status: 'active' | 'overdue' | 'ended';
  priceChange: { from: number; to: number } | null;
};

const DAY = 864e5;
// [min, max] days between charges for each cadence, and how many cycles are enough to call it a pattern
const CADENCES: { c: Cadence; min: number; max: number; tol: number; needs: number; perMonth: number }[] = [
  { c: 'weekly', min: 6, max: 8, tol: 1.5, needs: 4, perMonth: 52 / 12 },
  { c: 'monthly', min: 26, max: 35, tol: 5, needs: 3, perMonth: 1 },
  { c: 'quarterly', min: 80, max: 100, tol: 10, needs: 3, perMonth: 1 / 3 },
  { c: 'yearly', min: 350, max: 380, tol: 20, needs: 2, perMonth: 1 / 12 },
];

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

/** Charges within 3 days of each other are one cycle (a retry or a double alert), keeping the first. */
function collapse(cs: Charge[]): Charge[] {
  const out: Charge[] = [];
  for (const c of cs) if (!out.length || c.ts - out[out.length - 1].ts > 3 * DAY) out.push(c);
  return out;
}

export function detectRecurring(charges: Charge[], now: number): Recurring[] {
  const by = new Map<number, Charge[]>();
  for (const c of charges) by.set(c.merchant_id, [...(by.get(c.merchant_id) ?? []), c]);
  const found: Recurring[] = [];

  for (const [id, raw] of by) {
    const cs = collapse([...raw].sort((a, b) => a.ts - b.ts));
    if (cs.length < 2) continue;
    const gaps = cs.slice(1).map((c, i) => (c.ts - cs[i].ts) / DAY);
    const mid = median(gaps);
    const cad = CADENCES.find((x) => mid >= x.min && mid <= x.max);
    if (!cad || cs.length < cad.needs) continue;
    // nearly every gap must sit near the typical one; a single odd gap is forgiven once there is enough history
    const bad = gaps.filter((g) => Math.abs(g - mid) > cad.tol).length;
    if (bad > (cs.length >= 5 ? 1 : 0)) continue;

    const amounts = cs.map((c) => c.amount_paise);
    const typicalAll = median(amounts);
    // fixed price: everything within 3%; otherwise at least 80% of charges must still be in the same ballpark (a bill)
    const fixed = amounts.every((a) => Math.abs(a - typicalAll) <= typicalAll * 0.03);
    const near = amounts.filter((a) => Math.abs(a - typicalAll) <= typicalAll * 0.4).length;
    if (!fixed && near / amounts.length < 0.8) continue;

    const last = cs[cs.length - 1];
    const before = amounts.slice(0, -1);
    const typical = median(before.length ? before.slice(-3) : amounts);
    const priceChange = fixed || Math.abs(last.amount_paise - typical) < typical * 0.03 || before.length < 2
      ? null
      : (before.slice(-3).every((a) => Math.abs(a - typical) <= typical * 0.03) ? { from: typical, to: last.amount_paise } : null);
    const sinceLast = (now - last.ts) / DAY;
    found.push({
      merchant_id: id, merchant: last.merchant, cadence: cad.c, intervalDays: mid, amount: last.amount_paise, typical, varies: !fixed,
      count: cs.length, firstTs: cs[0].ts, lastTs: last.ts, nextTs: last.ts + mid * DAY,
      monthlyCost: Math.round(last.amount_paise * cad.perMonth),
      status: sinceLast > mid * 1.6 ? 'ended' : sinceLast > mid * 1.15 ? 'overdue' : 'active',
      priceChange,
    });
  }
  return found.sort((a, b) => a.nextTs - b.nextTs);
}

export const cadenceLabel = (c: Cadence) => ({ weekly: 'Every week', monthly: 'Every month', quarterly: 'Every 3 months', yearly: 'Every year' })[c];
