import type { SQLiteDatabase } from 'expo-sqlite';

import { holdingStats } from '@/db/holdings';
import { type NetPoint, type BalancePoint, monthEnds, netWorthSeries } from '@/utils/networth';

export type NetItem = { id: number; name: string; side: 'asset' | 'liability'; amount_paise: number; updated_at: number };
export type BankBalance = { id: number; name: string; paise: number; ts: number | null; stale: boolean };
export type NetWorth = {
  total: number;
  banks: BankBalance[];
  bankTotal: number;
  investments: number;
  investmentCost: number;
  /** false while some holding has no value entered, so the figure is what was put in */
  investmentsValued: boolean;
  assets: number;
  liabilities: number;
  items: NetItem[];
  series: NetPoint[];
};

export const getNetItems = (db: SQLiteDatabase) => db.getAllAsync<NetItem>('SELECT * FROM net_items ORDER BY side, name');
export const saveNetItem = (db: SQLiteDatabase, item: { id?: number; name: string; side: 'asset' | 'liability'; paise: number }) =>
  item.id
    ? db.runAsync('UPDATE net_items SET name = ?, side = ?, amount_paise = ?, updated_at = ? WHERE id = ?', item.name.trim(), item.side, item.paise, Date.now(), item.id)
    : db.runAsync('INSERT INTO net_items (name, side, amount_paise, updated_at) VALUES (?, ?, ?, ?)', item.name.trim(), item.side, item.paise, Date.now());
export const deleteNetItem = (db: SQLiteDatabase, id: number) => db.runAsync('DELETE FROM net_items WHERE id = ?', id);

export async function netWorth(db: SQLiteDatabase, now = Date.now(), months = 12): Promise<NetWorth> {
  const accts = await db.getAllAsync<{ id: number; name: string; balance_paise: number | null; balance_ts: number | null; balance_kind: string | null }>(
    "SELECT id, name, balance_paise, balance_ts, balance_kind FROM accounts WHERE kind = 'bank' AND merged_into IS NULL AND archived = 0",
  );
  const banks: BankBalance[] = accts
    .filter((a) => a.balance_paise != null && a.balance_kind !== 'limit')
    .map((a) => ({ id: a.id, name: a.name, paise: a.balance_paise!, ts: a.balance_ts, stale: !a.balance_ts || now - a.balance_ts > 45 * 864e5 }));
  const bankTotal = banks.reduce((s, b) => s + b.paise, 0);

  const holdings = await holdingStats(db, now);
  const cost = holdings.reduce((s, h) => s + (h.putIn - h.takenOut), 0);
  const investments = holdings.reduce((s, h) => s + (h.value ?? (h.putIn - h.takenOut)), 0);
  const investmentsValued = holdings.length > 0 && holdings.every((h) => h.value != null);

  const items = await getNetItems(db);
  const assets = items.filter((i) => i.side === 'asset').reduce((s, i) => s + i.amount_paise, 0);
  const liabilities = items.filter((i) => i.side === 'liability').reduce((s, i) => s + i.amount_paise, 0);

  const bankIds = new Set(banks.map((b) => b.id));
  const bal = await db.getAllAsync<{ account_id: number; ts: number; balance_paise: number }>(
    'SELECT account_id, ts, balance_paise FROM transactions WHERE balance_paise IS NOT NULL AND account_id IS NOT NULL ORDER BY ts',
  );
  const per = new Map<number, BalancePoint[]>();
  for (const r of bal) if (bankIds.has(r.account_id)) (per.get(r.account_id) ?? per.set(r.account_id, []).get(r.account_id)!).push({ ts: r.ts, paise: r.balance_paise });
  const flows = await db.getAllAsync<{ ts: number; direction: string; amount_paise: number }>("SELECT ts, direction, amount_paise FROM transactions WHERE kind = 'investment' AND status != 'dismissed' ORDER BY ts");
  const series = netWorthSeries({
    months: monthEnds(now, months),
    accounts: [...per.values()],
    invested: flows.map((f) => ({ ts: f.ts, paise: f.direction === 'debit' ? f.amount_paise : -f.amount_paise })),
    other: assets - liabilities,
    nowInvestments: investments,
  });
  // the last point is today's snapshot, whatever the message history says
  if (series.length) series[series.length - 1] = { ...series[series.length - 1], bank: bankTotal, investments, total: bankTotal + investments + assets - liabilities };
  return { total: bankTotal + investments + assets - liabilities, banks, bankTotal, investments, investmentCost: cost, investmentsValued, assets, liabilities, items, series };
}
