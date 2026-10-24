// "Familiar payments": a payee you have confirmed many times, always under the same category, at about the usual amount. With the
// setting on, such payments skip Review and are confirmed on arrival. Anything out of the ordinary still waits for a look.

export type FamiliarStat = { n: number; category: number | null; categoryShare: number; median: number };
export type Incoming = { category: number | null; amountPaise: number; direction: 'debit' | 'credit'; kind: string; foreign: boolean; transfer: boolean };

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

/** Per-merchant history -> stats (only debits that were counted as ordinary spending). */
export function familiarStats(rows: { merchant_id: number; category_id: number | null; amount_paise: number }[]): Map<number, FamiliarStat> {
  const by = new Map<number, typeof rows>();
  for (const r of rows) by.set(r.merchant_id, [...(by.get(r.merchant_id) ?? []), r]);
  const out = new Map<number, FamiliarStat>();
  for (const [id, rs] of by) {
    const counts = new Map<number | null, number>();
    for (const r of rs) counts.set(r.category_id, (counts.get(r.category_id) ?? 0) + 1);
    const [cat, c] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    out.set(id, { n: rs.length, category: cat, categoryShare: c / rs.length, median: median(rs.map((r) => r.amount_paise)) });
  }
  return out;
}

export function isFamiliar(stat: FamiliarStat | undefined, p: Incoming): boolean {
  if (!stat || p.direction !== 'debit' || p.kind !== 'normal' || p.foreign || p.transfer) return false;
  if (stat.n < 5 || stat.category == null || stat.categoryShare < 0.9 || p.category !== stat.category) return false;
  return p.amountPaise <= stat.median * 3 && p.amountPaise >= stat.median / 3;
}
