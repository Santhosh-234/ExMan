// Budget arithmetic kept pure so the pace/alert rules are tested without a database or a phone.
export type BudgetState = 'ok' | 'near' | 'over';

export type BudgetStatus = {
  available: number; // limit plus any rolled-over money, in paise
  spent: number;
  remaining: number; // negative when over
  pct: number; // spent / available, 0..n
  state: BudgetState; // near = 80% or more used, over = beyond the limit
  projected: number | null; // where this month is heading at the current pace; null for finished/future months
  aheadOfPace: boolean; // heading past the limit although not there yet
  dailySafe: number | null; // what can be spent per remaining day (current month only)
};

/** Fraction of the month elapsed as of `now` (1 for past months, 0 for future ones). */
export function monthProgress(month: string, now: Date): { elapsed: number; daysLeft: number; daysInMonth: number } {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const cur = now.getFullYear() * 12 + now.getMonth();
  const mon = y * 12 + (m - 1);
  if (mon < cur) return { elapsed: 1, daysLeft: 0, daysInMonth };
  if (mon > cur) return { elapsed: 0, daysLeft: daysInMonth, daysInMonth };
  return { elapsed: now.getDate() / daysInMonth, daysLeft: daysInMonth - now.getDate() + 1, daysInMonth };
}

export function budgetStatus(o: { limit: number; carry?: number; spent: number; month: string; now: Date }): BudgetStatus {
  const available = o.limit + Math.max(0, o.carry ?? 0);
  const { elapsed, daysLeft } = monthProgress(o.month, o.now);
  const remaining = available - o.spent;
  const pct = available > 0 ? o.spent / available : 0;
  const current = elapsed > 0 && elapsed < 1;
  // projecting from the first couple of days is noise, so the pace warning waits until 15% of the month is gone
  const projected = current && elapsed >= 0.15 ? Math.round(o.spent / elapsed) : null;
  const state: BudgetState = o.spent > available ? 'over' : pct >= 0.8 ? 'near' : 'ok';
  return {
    available, spent: o.spent, remaining, pct, state, projected,
    aheadOfPace: state === 'ok' && projected != null && projected > available * 1.05,
    dailySafe: current && remaining > 0 ? Math.floor(remaining / daysLeft) : null,
  };
}

/** Unused money carried into the next month when rollover is on (never negative: overspending is not carried). */
export const carryOver = (prevLimit: number, prevSpent: number) => Math.max(0, prevLimit - prevSpent);
