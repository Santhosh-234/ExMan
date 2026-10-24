import type { SQLiteDatabase } from 'expo-sqlite';

import { openBills } from '@/db/bills';
import { detectSips, loadForecast } from '@/db/forecast';
import { netWorth } from '@/db/networth';
import { holdingStats } from '@/db/holdings';
import { ledgerGaps } from '@/db/ledger';
import { budgetOverview, totalFor } from '@/db/queries';
import { getRecurring } from '@/db/recurring';
import { type FeedItem, type FeedSignals, buildFeed, findUnusual } from '@/utils/feed';
import { monthKey, monthRange, shiftMonth } from '@/utils/format';
import { budgetStatus } from '@/utils/budgets';

const DAY = 864e5;
const MONTH_NAME = (key: string) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'long' }); };

export async function feedSignals(db: SQLiteDatabase, now = Date.now()): Promise<FeedSignals> {
  const d = new Date(now);
  const cur = monthKey(d), prev = shiftMonth(cur, -1);
  const [from, to] = monthRange(cur);
  const [pf, pt] = monthRange(prev);

  const gaps = await ledgerGaps(db, 60, now);
  const fc = await loadForecast(db, now);
  const bills = (await openBills(db, now)).map((b) => ({ label: b.accountName ?? (b.bank ? `${b.bank} bill` : 'Bill'), paise: b.amount_paise, dueTs: b.due_ts }));

  const lines = (await budgetOverview(db, cur)).filter((l) => l.category_id !== null).map((line) => ({ line, st: budgetStatus({ limit: line.limit, carry: line.carry, spent: line.spent, month: cur, now: d }) }))
    .filter((x) => x.st.state !== 'ok').sort((a, b) => b.st.pct - a.st.pct).slice(0, 2);
  const budgets = lines.map((x) => ({ name: x.line.name, pct: x.st.pct, over: x.st.state === 'over', overPaise: Math.max(0, -x.st.remaining), leftPaise: Math.max(0, x.st.remaining) }));

  const rec = await getRecurring(db, now);
  const subs = rec.filter((r) => r.status === 'active' && (r.priceChange || r.nextTs - now <= 3 * DAY))
    .map((r) => ({ merchant: r.merchant, amount: r.amount, dueInDays: Math.ceil((r.nextTs - now) / DAY), priceFrom: r.priceChange?.from ?? null }));

  // payments far above what that merchant normally charges, and identical payments minutes apart
  const recent = await db.getAllAsync<{ id: number; merchant: string; merchant_id: number; paise: number }>(
    `SELECT id, merchant, merchant_id, amount_paise AS paise FROM transactions
     WHERE direction = 'debit' AND status != 'dismissed' AND is_transfer = 0 AND kind NOT IN ('investment','loan') AND merchant_id IS NOT NULL AND ts >= ? AND ts <= ?`, now - 7 * DAY, now);
  const history = new Map<number, number[]>();
  if (recent.length) {
    const ids = [...new Set(recent.map((r) => r.merchant_id))];
    const rows = await db.getAllAsync<{ merchant_id: number; amount_paise: number }>(
      `SELECT merchant_id, amount_paise FROM transactions WHERE direction = 'debit' AND status != 'dismissed' AND is_transfer = 0 AND merchant_id IN (${ids.map(() => '?').join(',')}) AND ts < ? AND ts >= ?`,
      ...ids, now - 7 * DAY, now - 365 * DAY);
    for (const r of rows) (history.get(r.merchant_id) ?? history.set(r.merchant_id, []).get(r.merchant_id)!).push(r.amount_paise);
  }
  const unusual = findUnusual(recent, history);
  const duplicates = (await db.getAllAsync<{ id: number; merchant: string; paise: number }>(
    `SELECT a.id, a.merchant, a.amount_paise AS paise FROM transactions a JOIN transactions b
       ON b.id > a.id AND b.merchant_id = a.merchant_id AND b.amount_paise = a.amount_paise AND b.direction = 'debit' AND b.status != 'dismissed' AND ABS(b.ts - a.ts) < 1800000
     WHERE a.direction = 'debit' AND a.status != 'dismissed' AND a.merchant_id IS NOT NULL AND a.is_transfer = 0 AND a.kind NOT IN ('investment','loan') AND a.amount_paise >= 30000 AND a.ts >= ?
     GROUP BY a.id`, now - 7 * DAY));

  const feesMonthPaise = (await db.getFirstAsync<{ s: number | null }>("SELECT SUM(amount_paise) AS s FROM transactions WHERE kind = 'fee' AND direction = 'debit' AND status != 'dismissed' AND ts >= ? AND ts < ?", from, to))?.s ?? 0;

  const spent = await totalFor(db, 'debit', from, to);
  const lastSpent = await totalFor(db, 'debit', pf, pt);
  const dim = Math.round((to - from) / DAY);
  const frac = (d.getDate() - 0.5) / dim;
  const pace = d.getDate() >= 7 && lastSpent > 0 ? { spent, lastMonth: lastSpent, projected: Math.round(spent / frac), lastLabel: MONTH_NAME(prev) } : null;

  const inc = await totalFor(db, 'credit', pf, pt);
  const saving = inc > 0 && lastSpent > 0 ? { rate: (inc - lastSpent) / inc, label: MONTH_NAME(prev) } : null;

  const sips = await detectSips(db, now);
  const sipsOverdue = sips.filter((r) => r.status === 'overdue' && r.cadence === 'monthly').map((r) => r.merchant);
  const unvalued = (await holdingStats(db, now)).filter((h) => h.n > 0 && h.value == null).map((h) => h.name);

  const spent3 = await totalFor(db, 'debit', now - 90 * DAY, now + DAY);
  const runwayMonths = fc && spent3 > 0 ? fc.balance / (spent3 / 3) : null;

  return {
    now, gaps: { count: gaps.length, totalPaise: gaps.reduce((s, g) => s + Math.abs(g.amountPaise), 0) },
    shortfallTs: fc?.forecast.shortfallTs ?? null, bills, budgets, subs, unusual, duplicates, feesMonthPaise, pace, saving, sipsOverdue, unvalued,
    runwayMonths: runwayMonths && runwayMonths > 0 ? runwayMonths : null,
    needBalance: (await netWorth(db, now, 2)).unknownBanks,
  };
}

const KEY = 'feed_dismissed';
const HIDE_FOR = 14 * DAY;

async function dismissedMap(db: SQLiteDatabase): Promise<Record<string, number>> {
  try { return JSON.parse((await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', KEY))?.value ?? '{}'); } catch { return {}; }
}

export async function dismissFeedItem(db: SQLiteDatabase, id: string, now = Date.now()) {
  const m = await dismissedMap(db);
  m[id] = now;
  for (const k of Object.keys(m)) if (now - m[k] > HIDE_FOR) delete m[k];
  await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', KEY, JSON.stringify(m));
}

export async function loadFeed(db: SQLiteDatabase, now = Date.now()): Promise<FeedItem[]> {
  const m = await dismissedMap(db);
  const hidden = new Set(Object.keys(m).filter((k) => now - m[k] < HIDE_FOR));
  return buildFeed(await feedSignals(db, now), hidden);
}
