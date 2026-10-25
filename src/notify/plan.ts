// Reminders ExMan can schedule ahead of time on the phone: they are worked out from what the app already knows (bills, subscription
// dates, the forecast) and set as local notifications, so nothing is sent anywhere and nothing needs the app to be running at the time.

export type ReminderPrefs = { bills: boolean; subscriptions: boolean; shortfall: boolean };
export const DEFAULT_PREFS: ReminderPrefs = { bills: true, subscriptions: true, shortfall: true };

export type Planned = { id: string; at: number; title: string; body: string; route: string };

export type PlanInput = {
  now: number;
  prefs: ReminderPrefs;
  /** hide amounts from the lock screen (app lock or "hide amounts" is on) */
  private: boolean;
  bills: { label: string; paise: number; dueTs: number }[];
  subs: { merchant: string; paise: number; nextTs: number; status: 'active' | 'overdue' | 'ended' }[];
  shortfallTs: number | null;
};

const DAY = 864e5;
export const HOUR_OF_REMINDER = 9; // local time
export const MAX_PLANNED = 40;

const at9 = (ts: number) => new Date(new Date(ts).setHours(HOUR_OF_REMINDER, 0, 0, 0)).getTime();
const inr = (paise: number) => '₹' + Math.round(paise / 100).toLocaleString('en-IN');
const dayOf = (ts: number) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export function planReminders(i: PlanInput): Planned[] {
  const out: Planned[] = [];
  const add = (p: Planned) => { if (p.at > i.now + 60_000 && p.at < i.now + 45 * DAY) out.push(p); };
  const amt = (paise: number) => (i.private ? '' : ` ${inr(paise)}`);

  if (i.prefs.bills) for (const b of i.bills) {
    const label = i.private ? 'A card bill' : b.label;
    add({ id: `bill-${b.dueTs}-${b.label}-2d`, at: at9(b.dueTs - 2 * DAY), title: `${label} is due in 2 days`, body: i.private ? 'Open ExMan to see the amount.' : `${inr(b.paise)} due on ${dayOf(b.dueTs)}. Paying on time avoids late fees.`, route: '/wealth' });
    add({ id: `bill-${b.dueTs}-${b.label}-0d`, at: at9(b.dueTs), title: `${label} is due today`, body: i.private ? 'Open ExMan to see the amount.' : `${inr(b.paise)} is due today.`, route: '/wealth' });
  }
  if (i.prefs.subscriptions) for (const s of i.subs) {
    if (s.status === 'ended') continue;
    const name = i.private ? 'A subscription' : s.merchant;
    add({ id: `sub-${s.nextTs}-${s.merchant}`, at: at9(s.nextTs - DAY), title: `${name} renews tomorrow`, body: i.private ? 'Open ExMan to see which one.' : `About${amt(s.paise)} will be charged.`, route: '/subscriptions' });
  }
  if (i.prefs.shortfall && i.shortfallTs != null) {
    add({ id: `short-${i.shortfallTs}`, at: at9(i.shortfallTs - 2 * DAY), title: 'Your balance could run short', body: `Around ${dayOf(i.shortfallTs)}, based on your bills, income and usual spending.`, route: '/wealth' });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, MAX_PLANNED);
}
