// Net worth = what is in your bank accounts + what your investments are worth + other assets - what you owe.
// History is rebuilt from the balances quoted in messages and from investment cash flows.

export type BalancePoint = { ts: number; paise: number };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export type MonthEnd = { label: string; end: number; partial: boolean };

/** Calendar month ends for the last `n` months, oldest first. The current month ends "now". */
export function monthEnds(now: number, n: number): MonthEnd[] {
  const d = new Date(now);
  const out: MonthEnd[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const next = new Date(d.getFullYear(), d.getMonth() - i + 1, 1).getTime();
    out.push({ label: MONTHS[start.getMonth()], end: Math.min(next, now), partial: next > now });
  }
  return out;
}

/** The last known balance at or before `ts` (balances sorted by time); null before the first one. */
export function balanceAt(points: BalancePoint[], ts: number): number | null {
  let lo = 0, hi = points.length - 1, ans: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].ts <= ts) { ans = points[mid].paise; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export type SeriesInput = {
  months: MonthEnd[];
  accounts: BalancePoint[][]; // one sorted list per bank account
  invested: { ts: number; paise: number }[]; // + put in, - taken out
  other: number; // hand-entered assets minus liabilities (held constant)
  nowInvestments: number; // what investments are worth today (value if known, else cost)
};

export type NetPoint = { label: string; total: number; bank: number; investments: number };

export function netWorthSeries(i: SeriesInput): NetPoint[] {
  return i.months.map((m, idx) => {
    const bank = i.accounts.reduce((s, a) => s + (balanceAt(a, m.end) ?? 0), 0);
    const last = idx === i.months.length - 1;
    const investments = last ? i.nowInvestments : i.invested.filter((x) => x.ts <= m.end).reduce((s, x) => s + x.paise, 0);
    return { label: m.label, bank, investments, total: bank + investments + i.other };
  });
}
