import { rupees } from './format';

export type Spend = { category_id: number | null; name: string; total: number };

/**
 * Plain-language callouts for a month: biggest category, notable swings against the last-3-month average,
 * savings rate and change since last month. At most `max` lines, most useful first.
 */
export function buildCallouts(o: { spend: Spend[]; history: Spend[][]; spent: number; prevSpent: number; income: number }, max = 4): string[] {
  const out: string[] = [];
  const { spend, history, spent, prevSpent, income } = o;
  if (spent <= 0) return out;

  const top = spend[0];
  if (top) out.push(`${top.name} is your biggest spend: ${rupees(top.total)} (${Math.round((top.total / spent) * 100)}% of the month).`);

  // compare each category with its average over the months that had any spending
  const months = history.filter((m) => m.length > 0);
  if (months.length >= 1) {
    const swings = spend.map((c) => {
      const avg = months.reduce((s, m) => s + (m.find((x) => x.category_id === c.category_id)?.total ?? 0), 0) / months.length;
      return { c, avg, delta: c.total - avg, pct: avg > 0 ? Math.round(((c.total - avg) / avg) * 100) : 0 };
    }).filter((s) => s.avg > 0 && Math.abs(s.delta) >= 50_000 && Math.abs(s.pct) >= 25); // at least ₹500 and 25%
    const up = swings.filter((s) => s.delta > 0).sort((a, b) => b.delta - a.delta)[0];
    const down = swings.filter((s) => s.delta < 0).sort((a, b) => a.delta - b.delta)[0];
    const label = months.length >= 3 ? '3-month average' : 'recent average';
    if (up) out.push(`${up.c.name} is ${up.pct}% above your ${label} (${rupees(up.avg)}).`);
    if (down) out.push(`${down.c.name} is ${Math.abs(down.pct)}% below your ${label}. Nice.`);
  }

  if (income > 0) {
    const saved = income - spent;
    out.push(saved >= 0 ? `You've saved ${Math.round((saved / income) * 100)}% of your income so far.` : `You've spent ${rupees(-saved)} more than you earned this month.`);
  }
  if (prevSpent > 0) {
    const d = Math.round(((spent - prevSpent) / prevSpent) * 100);
    if (d !== 0) out.push(`Spending is ${Math.abs(d)}% ${d > 0 ? 'higher' : 'lower'} than last month.`);
  }
  return out.slice(0, max);
}
