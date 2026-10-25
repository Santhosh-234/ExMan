// The "For you" feed: the few things in your money worth looking at right now, most important first. Every item says something specific
// (a number, a date, a name) and opens the screen where you can act on it.

export type FeedKind = 'alert' | 'watch' | 'good' | 'info';
export type FeedItem = { id: string; kind: FeedKind; score: number; title: string; body?: string; route: string; icon: 'ledger' | 'forecast' | 'bill' | 'unusual' | 'duplicate' | 'budget' | 'subscription' | 'fees' | 'pace' | 'saving' | 'sip' | 'value' | 'runway' };

export type FeedSignals = {
  now: number;
  gaps: { count: number; totalPaise: number };
  shortfallTs: number | null;
  bills: { label: string; paise: number; dueTs: number }[];
  budgets: { name: string; pct: number; over: boolean; overPaise: number; leftPaise: number }[];
  subs: { merchant: string; amount: number; dueInDays: number; priceFrom: number | null }[];
  unusual: { id: number; merchant: string; paise: number; ratio: number }[];
  duplicates: { id: number; merchant: string; paise: number }[];
  feesMonthPaise: number;
  pace: { spent: number; lastMonth: number; projected: number; lastLabel: string } | null;
  saving: { rate: number; label: string } | null;
  sipsOverdue: string[];
  unvalued: string[];
  runwayMonths: number | null;
  /** bank accounts whose messages show no balance, so nothing about them can be checked yet */
  needBalance: { id: number; name: string }[];
  /** payees with two matching charges that look like subscriptions */
  maybeSubs: string[];
};

const DAY = 864e5;
export const inr = (paise: number) => '₹' + Math.round(paise / 100).toLocaleString('en-IN');
const when = (ts: number) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const inDays = (n: number) => (n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

export function buildFeed(s: FeedSignals, dismissed: ReadonlySet<string> = new Set()): FeedItem[] {
  const out: FeedItem[] = [];
  const add = (i: FeedItem) => { if (!dismissed.has(i.id)) out.push(i); };

  if (s.gaps.count > 0) add({ id: 'gaps', kind: 'alert', score: 90, icon: 'ledger', route: '/ledger',
    title: `${inr(Math.abs(s.gaps.totalPaise))} not accounted for`, body: `${s.gaps.count} difference${s.gaps.count === 1 ? '' : 's'} between your bank balances and your transactions` });
  if (s.shortfallTs != null) add({ id: `short-${new Date(s.shortfallTs).toISOString().slice(0, 7)}`, kind: 'alert', score: 95, icon: 'forecast', route: '/wealth',
    title: `Balance could run short around ${when(s.shortfallTs)}`, body: 'Based on bills, salary and your usual spending' });

  for (const b of s.bills) {
    const d = Math.ceil((b.dueTs - s.now) / DAY);
    if (d > 10) continue;
    add({ id: `bill-${b.label}-${b.dueTs}`, kind: d <= 3 ? 'alert' : 'watch', score: d <= 3 ? 88 : 70, icon: 'bill', route: '/wealth',
      title: `${b.label}: ${inr(b.paise)} due ${d < 0 ? `${-d} day${d === -1 ? '' : 's'} ago` : inDays(d)}`, body: `Due ${when(b.dueTs)}` });
  }
  for (const d of s.duplicates.slice(0, 2)) add({ id: `dupe-${d.id}`, kind: 'alert', score: 85, icon: 'duplicate', route: `/txn/${d.id}`,
    title: `Charged twice? ${d.merchant} ${inr(d.paise)}`, body: 'Two identical payments within minutes' });
  for (const u of s.unusual.slice(0, 2)) add({ id: `unusual-${u.id}`, kind: 'watch', score: 75, icon: 'unusual', route: `/txn/${u.id}`,
    title: `${u.merchant} ${inr(u.paise)} is ${Math.round(u.ratio)}× your usual`, body: 'Much more than you normally pay here' });
  for (const b of s.budgets) add({ id: `budget-${b.name}-${b.over ? 'over' : 'near'}`, kind: b.over ? 'alert' : 'watch', score: b.over ? 80 : 60, icon: 'budget', route: '/budgets',
    title: b.over ? `${b.name} is ${inr(b.overPaise)} over budget` : `${b.name}: ${Math.round(b.pct * 100)}% of budget used`, body: b.over ? undefined : `${inr(b.leftPaise)} left this month` });
  for (const m of s.subs) {
    if (m.priceFrom != null) add({ id: `subprice-${m.merchant}`, kind: 'watch', score: 55, icon: 'subscription', route: '/subscriptions', title: `${m.merchant} costs more now`, body: `${inr(m.priceFrom)} → ${inr(m.amount)} a cycle` });
    else if (m.dueInDays <= 3) add({ id: `sub-${m.merchant}-${Math.max(0, m.dueInDays)}`, kind: 'info', score: 45, icon: 'subscription', route: '/subscriptions', title: `${m.merchant} ${inr(m.amount)} ${inDays(m.dueInDays)}` });
  }
  if (s.pace && s.pace.lastMonth > 0) {
    const r = s.pace.projected / s.pace.lastMonth;
    if (r > 1.15) add({ id: `pace-${new Date(s.now).toISOString().slice(0, 7)}`, kind: 'watch', score: 65, icon: 'pace', route: '/insights',
      title: `On track to spend ${inr(s.pace.projected)} this month`, body: `${Math.round((r - 1) * 100)}% more than ${s.pace.lastLabel}` });
    else if (r < 0.85) add({ id: `pacegood-${new Date(s.now).toISOString().slice(0, 7)}`, kind: 'good', score: 30, icon: 'pace', route: '/insights',
      title: `Spending is ${Math.round((1 - r) * 100)}% below ${s.pace.lastLabel} so far`, body: `Heading for ${inr(s.pace.projected)}` });
  }
  if (s.saving) {
    if (s.saving.rate < 0) add({ id: `save-${s.saving.label}`, kind: 'watch', score: 70, icon: 'saving', route: '/insights', title: `You spent more than you earned in ${s.saving.label}` });
    else if (s.saving.rate >= 0.2) add({ id: `save-${s.saving.label}`, kind: 'good', score: 25, icon: 'saving', route: '/insights', title: `You saved ${Math.round(s.saving.rate * 100)}% of your income in ${s.saving.label}` });
  }
  if (s.feesMonthPaise >= 10000) add({ id: `fees-${new Date(s.now).toISOString().slice(0, 7)}`, kind: 'info', score: 40, icon: 'fees', route: '/activity?kind=fee', title: `${inr(s.feesMonthPaise)} in bank charges this month` });
  for (const n of s.sipsOverdue.slice(0, 2)) add({ id: `sip-${n}-${new Date(s.now).toISOString().slice(0, 7)}`, kind: 'watch', score: 58, icon: 'sip', route: '/investments', title: `${n} hasn't run this month`, body: 'Your SIP is usually debited by now' });
  if (s.unvalued.length) add({ id: 'unvalued', kind: 'info', score: 20, icon: 'value', route: '/investments', title: `What are your investments worth now?`, body: `Add values for ${s.unvalued.slice(0, 2).join(', ')}${s.unvalued.length > 2 ? ' and more' : ''} to see returns` });
  if (s.maybeSubs.length) add({ id: `maybesubs-${s.maybeSubs.join(',').slice(0, 60)}`, kind: 'info', score: 42, icon: 'subscription', route: '/subscriptions', title: s.maybeSubs.length === 1 ? `Is ${s.maybeSubs[0]} a subscription?` : `${s.maybeSubs.length} payments might be subscriptions`, body: s.maybeSubs.slice(0, 3).join(', ') });
  for (const a of s.needBalance.slice(0, 1)) add({ id: `needbal-${a.id}`, kind: 'info', score: 35, icon: 'ledger', route: `/account/${a.id}`, title: `Add your ${a.name} balance`, body: 'Its messages do not show one. Enter it once and ExMan can track and check it' });
  if (s.runwayMonths != null && s.runwayMonths > 0) add({ id: 'runway', kind: 'info', score: 15, icon: 'runway', route: '/wealth', title: `Your bank balance covers ${s.runwayMonths.toFixed(1)} months of spending` });

  return out.sort((a, b) => b.score - a.score);
}

/** Median helper shared by the unusual-spend detector. */
export const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** A payment far above what that merchant normally charges. Needs history and a meaningful amount, so small purchases never trigger it. */
export function findUnusual(recent: { id: number; merchant: string; merchant_id: number; paise: number }[], history: Map<number, number[]>, minPaise = 100000, ratio = 3) {
  const out: FeedSignals['unusual'] = [];
  for (const r of recent) {
    const prior = history.get(r.merchant_id) ?? [];
    if (prior.length < 3 || r.paise < minPaise) continue;
    const m = median(prior);
    if (m > 0 && r.paise / m >= ratio) out.push({ id: r.id, merchant: r.merchant, paise: r.paise, ratio: r.paise / m });
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}
