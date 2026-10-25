// What the home-screen widget says. Pure, so the privacy rule (nothing sensitive when the app is locked or amounts are hidden) is tested.
export type WidgetInput = {
  private: boolean;
  safeDaily: number | null; // paise
  spentThisMonth: number; // paise
  next: { label: string; paise: number; ts: number } | null;
};

const inr = (paise: number) => '₹' + Math.round(paise / 100).toLocaleString('en-IN');
const day = (ts: number) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export function widgetLines(i: WidgetInput): { title: string; amount: string; sub: string } {
  if (i.private) return { title: 'ExMan', amount: 'Tap to open', sub: 'Amounts are hidden here' };
  const sub = i.next ? `Next: ${i.next.label} ${inr(i.next.paise)} · ${day(i.next.ts)}` : '';
  if (i.safeDaily != null) return { title: 'Safe to spend today', amount: inr(i.safeDaily), sub };
  return { title: 'Spent this month', amount: inr(i.spentThisMonth), sub };
}
