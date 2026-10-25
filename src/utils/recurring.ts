// Finds payments that repeat on a schedule (subscriptions, rent, regular bills) from a merchant's charge history.
export type Charge = {
  merchant_id: number; merchant: string; amount_paise: number; ts: number;
  /** price in the original currency for foreign charges (cents of a USD price): stable while the rupee amount moves with the exchange rate */
  unit?: number;
};
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
  /** the user said so (or confirmed a suggestion) */
  manual?: boolean;
  /** when one payee mixes several charges (an app store), the amount of the repeating one is its identity */
  series?: number;
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

const INTERVAL: Record<Cadence, number> = { weekly: 7, monthly: 30, quarterly: 91, yearly: 365 };
const PER_MONTH: Record<Cadence, number> = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

/** Services that charge on a schedule almost by definition: they need one cycle fewer and tolerate a few days of drift (card postings shift). */
const KNOWN = /netflix|spotify|hotstar|disney|youtube|google (?:one|play)|apple|prime|amazon prime|openai|chatgpt|claude|anthropic|notion|zoom|adobe|microsoft|office 365|linkedin|canva|dropbox|audible|icloud|github|figma|slack|jiocinema|sonyliv|zee5|gaana|wynk|medium|duolingo|coursera|udemy|cult|gym|fitness|insurance|lic\b|broadband|airtel|jio\b|vi\b|tata ?(?:play|sky)|dth/i;
export const looksLikeSubscription = (name: string) => KNOWN.test(name);

const basisOf = (cs: Charge[]) => (cs.every((c) => c.unit != null) ? cs.map((c) => c.unit!) : cs.map((c) => c.amount_paise));

function analyse(id: number, raw: Charge[], now: number, relaxed: boolean, series?: number): Recurring | null {
  const cs = collapse([...raw].sort((a, b) => a.ts - b.ts));
  if (cs.length < 2) return null;
  const gaps = cs.slice(1).map((c, i) => (c.ts - cs[i].ts) / DAY);
  const mid = median(gaps);
  const cad = CADENCES.find((x) => mid >= x.min && mid <= x.max);
  if (!cad || cs.length < (relaxed ? Math.max(2, cad.needs - 1) : cad.needs)) return null;
  // nearly every gap must sit near the typical one; a single odd gap is forgiven once there is enough history
  const tol = cad.tol + (relaxed ? 3 : 0);
  const bad = gaps.filter((g) => Math.abs(g - mid) > tol).length;
  if (bad > (cs.length >= 5 ? 1 : 0)) return null;

  const basis = basisOf(cs);
  const typicalAll = median(basis);
  // fixed price: everything within 3%; otherwise at least 80% of charges must still be in the same ballpark (a bill)
  const fixed = basis.every((a) => Math.abs(a - typicalAll) <= typicalAll * 0.03);
  const near = basis.filter((a) => Math.abs(a - typicalAll) <= typicalAll * 0.4).length;
  if (!fixed && near / basis.length < 0.8) return null;

  const last = cs[cs.length - 1];
  const amounts = cs.map((c) => c.amount_paise);
  const before = amounts.slice(0, -1);
  const typical = median(before.length ? before.slice(-3) : amounts);
  const foreign = cs.every((c) => c.unit != null);
  const priceChange = foreign || fixed || Math.abs(last.amount_paise - typical) < typical * 0.03 || before.length < 2
    ? null
    : (before.slice(-3).every((a) => Math.abs(a - typical) <= typical * 0.03) ? { from: typical, to: last.amount_paise } : null);
  const sinceLast = (now - last.ts) / DAY;
  return {
    merchant_id: id, merchant: last.merchant, cadence: cad.c, intervalDays: mid, amount: last.amount_paise, typical, varies: !fixed,
    count: cs.length, firstTs: cs[0].ts, lastTs: last.ts, nextTs: last.ts + mid * DAY,
    monthlyCost: Math.round(last.amount_paise * cad.perMonth),
    status: sinceLast > mid * 1.6 ? 'ended' : sinceLast > mid * 1.15 ? 'overdue' : 'active',
    priceChange, ...(series != null ? { series } : {}),
  };
}

/** Groups charges whose price is within 3% of each other (an app store mixes many prices; a subscription is the one that repeats). */
function priceClusters(cs: Charge[]): Charge[][] {
  const sorted = [...cs].sort((a, b) => (a.unit ?? a.amount_paise) - (b.unit ?? b.amount_paise));
  const out: Charge[][] = [];
  for (const c of sorted) {
    const v = c.unit ?? c.amount_paise;
    const g = out[out.length - 1];
    const gv = g ? g[0].unit ?? g[0].amount_paise : 0;
    if (g && Math.abs(v - gv) <= gv * 0.03) g.push(c); else out.push([c]);
  }
  return out.filter((g) => g.length >= 2);
}

/** A subscription the user declared: one charge is enough, and the cadence is theirs. */
function declared(id: number, cs: Charge[], cadence: Cadence, now: number): Recurring | null {
  if (!cs.length) return null;
  const sorted = collapse([...cs].sort((a, b) => a.ts - b.ts));
  const last = sorted[sorted.length - 1];
  const interval = INTERVAL[cadence];
  const basis = basisOf(sorted);
  const m = median(basis);
  const fixed = basis.every((a) => Math.abs(a - m) <= m * 0.03);
  const sinceLast = (now - last.ts) / DAY;
  return {
    merchant_id: id, merchant: last.merchant, cadence, intervalDays: interval, amount: last.amount_paise, typical: median(sorted.map((c) => c.amount_paise)), varies: !fixed,
    count: sorted.length, firstTs: sorted[0].ts, lastTs: last.ts, nextTs: last.ts + interval * DAY,
    monthlyCost: Math.round(last.amount_paise * PER_MONTH[cadence]),
    status: sinceLast > interval * 1.6 ? 'ended' : sinceLast > interval * 1.15 ? 'overdue' : 'active',
    priceChange: null, manual: true,
  };
}

export function detectRecurring(charges: Charge[], now: number, opts: { declared?: ReadonlyMap<number, Cadence> } = {}): Recurring[] {
  const by = new Map<number, Charge[]>();
  for (const c of charges) by.set(c.merchant_id, [...(by.get(c.merchant_id) ?? []), c]);
  const found: Recurring[] = [];

  for (const [id, raw] of by) {
    const mine = opts.declared?.get(id);
    const relaxed = !!mine || looksLikeSubscription(raw[raw.length - 1].merchant);
    const whole = analyse(id, raw, now, relaxed);
    if (mine) {
      // the user's cadence wins; if the data agrees, keep its richer figures
      found.push(whole && whole.cadence === mine ? { ...whole, manual: true } : declared(id, raw, mine, now)!);
      continue;
    }
    if (whole) { found.push(whole); continue; }
    for (const cluster of priceClusters(raw)) {
      const r = analyse(id, cluster, now, relaxed, median(cluster.map((c) => c.amount_paise)));
      if (r) found.push(r);
    }
  }
  return found.sort((a, b) => a.nextTs - b.nextTs);
}

export type Maybe = { merchant_id: number; merchant: string; cadence: Cadence; amount: number; count: number; lastTs: number };

/**
 * Payees with only two charges so far whose timing and price look like a subscription: worth asking about instead of waiting for a
 * third charge. Anything already detected, declared or dismissed is left out by the caller.
 */
export function suggestSubscriptions(charges: Charge[], now: number, skip: ReadonlySet<number> = new Set()): Maybe[] {
  const by = new Map<number, Charge[]>();
  for (const c of charges) if (!skip.has(c.merchant_id)) by.set(c.merchant_id, [...(by.get(c.merchant_id) ?? []), c]);
  const out: Maybe[] = [];
  for (const [id, raw] of by) {
    const cs = collapse([...raw].sort((a, b) => a.ts - b.ts));
    if (cs.length < 2 || cs.length > 3) continue;
    const basis = basisOf(cs);
    const m = median(basis);
    if (!basis.every((a) => Math.abs(a - m) <= m * 0.05)) continue;
    const gaps = cs.slice(1).map((c, i) => (c.ts - cs[i].ts) / DAY);
    const cad = CADENCES.find((x) => gaps.every((g) => g >= x.min - 1 && g <= x.max + 1));
    if (!cad || cad.c === 'weekly') continue; // two weekly purchases prove nothing
    const last = cs[cs.length - 1];
    if ((now - last.ts) / DAY > INTERVAL[cad.c] * 1.6) continue;
    out.push({ merchant_id: id, merchant: last.merchant, cadence: cad.c, amount: last.amount_paise, count: cs.length, lastTs: last.ts });
  }
  return out.sort((a, b) => b.lastTs - a.lastTs);
}

export const cadenceLabel = (c: Cadence) => ({ weekly: 'Every week', monthly: 'Every month', quarterly: 'Every 3 months', yearly: 'Every year' })[c];
