// Projects the bank balance forward day by day from what is already known: the balance today, income and payments that repeat
// (salary, subscriptions, SIPs, EMIs), bills with a due date, and the usual everyday spending in between.

export type Scheduled = { ts: number; paise: number; label: string; kind: 'income' | 'recurring' | 'bill' | 'sip' | 'loan' }; // paise: + in, - out

export type ForecastInput = {
  now: number;
  balance: number;
  scheduled: Scheduled[];
  /** average everyday spending per day, not counting anything already in `scheduled` */
  dailyVariable: number;
  days?: number;
};

export type ForecastPoint = { ts: number; label: string; balance: number };
export type Forecast = {
  points: ForecastPoint[]; // today first
  endBalance: number;
  low: { ts: number; balance: number };
  /** first day the balance is projected to go below zero */
  shortfallTs: number | null;
  /** balance expected at the end of this calendar month */
  monthEnd: { ts: number; balance: number };
  /** what can be spent each day for the rest of the month and still not go below zero */
  safeDaily: number;
  upcoming: Scheduled[];
  variableTotal: number;
};

const DAY = 864e5;
const startOfDay = (ts: number) => new Date(new Date(ts).setHours(0, 0, 0, 0)).getTime();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function forecast(i: ForecastInput): Forecast {
  const days = i.days ?? 30;
  const today = startOfDay(i.now);
  const byDay = new Map<number, number>();
  const upcoming: Scheduled[] = [];
  for (const s of i.scheduled) {
    // something that should already have happened but has not: assume it lands tomorrow rather than vanish
    const ts = s.ts < i.now ? i.now + DAY : s.ts;
    const d = startOfDay(ts);
    if (d < today || d > today + days * DAY) continue;
    byDay.set(d, (byDay.get(d) ?? 0) + s.paise);
    upcoming.push({ ...s, ts });
  }
  upcoming.sort((a, b) => a.ts - b.ts);

  const points: ForecastPoint[] = [{ ts: today, label: 'Today', balance: i.balance }];
  let bal = i.balance;
  let low = { ts: today, balance: bal };
  let shortfallTs: number | null = bal < 0 ? today : null;
  const monthEndDay = startOfDay(new Date(new Date(i.now).getFullYear(), new Date(i.now).getMonth() + 1, 0).getTime());
  let monthEnd = { ts: monthEndDay, balance: bal };
  for (let k = 1; k <= days; k++) {
    const d = today + k * DAY;
    bal += (byDay.get(d) ?? 0) - i.dailyVariable;
    const dt = new Date(d);
    points.push({ ts: d, label: `${dt.getDate()} ${MONTHS[dt.getMonth()]}`, balance: Math.round(bal) });
    if (bal < low.balance) low = { ts: d, balance: Math.round(bal) };
    if (shortfallTs == null && bal < 0) shortfallTs = d;
    if (d <= monthEndDay) monthEnd = { ts: d, balance: Math.round(bal) };
  }
  if (monthEndDay < today + DAY) monthEnd = { ts: today, balance: i.balance };

  // everyday spending that still fits before month end: today's balance plus what arrives, minus what is committed, over the days left
  const daysLeft = Math.max(1, Math.round((monthEndDay - today) / DAY) + 1);
  const committed = upcoming.filter((u) => startOfDay(u.ts) <= monthEndDay).reduce((s, u) => s + u.paise, 0);
  const safeDaily = Math.max(0, Math.floor((i.balance + committed) / daysLeft));
  return {
    points, endBalance: points[points.length - 1].balance, low, shortfallTs, monthEnd, safeDaily, upcoming,
    variableTotal: Math.round(i.dailyVariable * days),
  };
}

/** Everyday spend per day from a window of totals: what was spent minus the repeating payments inside it, over the days covered. */
export function dailyVariable(spentPaise: number, repeatingPaise: number, daysCovered: number): number {
  const days = Math.max(14, daysCovered);
  return Math.max(0, Math.round((spentPaise - repeatingPaise) / days));
}
