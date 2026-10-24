import type { SQLiteDatabase } from 'expo-sqlite';

import { openBills } from '@/db/bills';
import { getRecurring } from '@/db/recurring';
import { type Forecast, type Scheduled, dailyVariable, forecast } from '@/utils/forecast';
import { type Charge, type Recurring, detectRecurring } from '@/utils/recurring';

export type ForecastResult = { forecast: Forecast; balance: number; accounts: number; sources: { income: number; recurring: number; bills: number; sip: number; loan: number } };

const DAY = 864e5;

/** Occurrences of a repeating payment inside [now, now + days], starting from its next expected date. */
function occurrences(r: Recurring, now: number, days: number): number[] {
  if (r.status === 'ended') return [];
  const out: number[] = [];
  let ts = r.nextTs;
  const step = Math.max(1, r.intervalDays) * DAY;
  if (ts < now) ts = now + DAY; // overdue: expected any day now
  for (let k = 0; ts <= now + days * DAY && k < 40; k++, ts += step) out.push(ts);
  return out;
}

export async function detect(db: SQLiteDatabase, sql: string, now: number, ...params: (string | number)[]): Promise<Recurring[]> {
  const rows = await db.getAllAsync<{ id: number; name: string; amount_paise: number; ts: number }>(sql, ...params);
  const charges: Charge[] = rows.map((r) => ({ merchant_id: r.id, merchant: r.name, amount_paise: r.amount_paise, ts: r.ts }));
  return detectRecurring(charges, now);
}

/** Null when no bank balance is known yet (nothing to project from). */
export async function loadForecast(db: SQLiteDatabase, now = Date.now(), days = 30): Promise<ForecastResult | null> {
  const banks = await db.getAllAsync<{ balance_paise: number }>(
    "SELECT balance_paise FROM accounts WHERE kind = 'bank' AND merged_into IS NULL AND archived = 0 AND balance_paise IS NOT NULL AND balance_kind != 'limit'",
  );
  if (!banks.length) return null;
  const balance = banks.reduce((s, b) => s + b.balance_paise, 0);
  const since = now - 548 * DAY;

  const subs = await getRecurring(db, now);
  const income = await detect(db,
    // many credit alerts carry no payer name; those are grouped by amount (Rs 500 buckets) so a fixed salary is still found
    `SELECT COALESCE(merchant_id, -(1 + CAST(amount_paise / 50000 AS INTEGER))) AS id, COALESCE(merchant, 'Salary or regular income') AS name, amount_paise, ts FROM transactions
     WHERE direction = 'credit' AND status = 'confirmed' AND is_transfer = 0 AND kind NOT IN ('investment','loan') AND refund_of IS NULL AND ts >= ?`, now, since);
  const sips = await detect(db,
    `SELECT t.holding_id AS id, h.name AS name, t.amount_paise, t.ts FROM transactions t JOIN holdings h ON h.id = t.holding_id
     WHERE t.kind = 'investment' AND t.direction = 'debit' AND t.status != 'dismissed' AND t.ts >= ?`, now, since);
  const loans = await detect(db,
    `SELECT merchant_id AS id, COALESCE(merchant, 'Loan') AS name, amount_paise, ts FROM transactions
     WHERE kind = 'loan' AND direction = 'debit' AND status != 'dismissed' AND merchant_id IS NOT NULL AND ts >= ?`, now, since);
  const bills = await openBills(db, now);

  const scheduled: Scheduled[] = [];
  const add = (rs: Recurring[], sign: 1 | -1, kind: Scheduled['kind']) => { for (const r of rs) for (const ts of occurrences(r, now, days)) scheduled.push({ ts, paise: sign * r.amount, label: r.merchant, kind }); };
  add(income, 1, 'income');
  add(subs, -1, 'recurring');
  add(sips, -1, 'sip');
  add(loans, -1, 'loan');
  for (const b of bills) scheduled.push({ ts: b.due_ts - 12 * 3600e3, paise: -b.amount_paise, label: b.accountName ?? (b.bank ? `${b.bank} bill` : 'Bill'), kind: 'bill' });

  // everyday spending: what was counted as spent in the last 60 days, minus the repeating payments inside that window
  const win = 60;
  const spent = (await db.getFirstAsync<{ s: number | null }>(
    `SELECT SUM(t.amount_paise) AS s FROM transactions t WHERE t.direction = 'debit' AND t.status = 'confirmed' AND t.is_transfer = 0 AND t.kind NOT IN ('investment','loan') AND t.ts >= ?`, now - win * DAY))?.s ?? 0;
  const first = (await db.getFirstAsync<{ m: number | null }>("SELECT MIN(ts) AS m FROM transactions WHERE status = 'confirmed'"))?.m ?? now;
  const repeating = subs.reduce((s, r) => s + r.amount * Math.floor(win / Math.max(1, r.intervalDays)), 0);
  const covered = Math.min(win, Math.max(1, Math.round((now - first) / DAY)));
  const f = forecast({ now, balance, scheduled, dailyVariable: dailyVariable(spent, repeating, covered), days });
  const count = (k: Scheduled['kind']) => scheduled.filter((s) => s.kind === k).length;
  return { forecast: f, balance, accounts: banks.length, sources: { income: count('income'), recurring: count('recurring'), bills: count('bill'), sip: count('sip'), loan: count('loan') } };
}

/** SIPs and other regular investments (grouped by holding), for the forecast and the "SIP didn't run" check. */
export const detectSips = (db: SQLiteDatabase, now: number) =>
  detect(db,
    `SELECT t.holding_id AS id, h.name AS name, t.amount_paise, t.ts FROM transactions t JOIN holdings h ON h.id = t.holding_id
     WHERE t.kind = 'investment' AND t.direction = 'debit' AND t.status != 'dismissed' AND t.ts >= ?`, now, now - 548 * DAY);
