import type { SQLiteDatabase } from 'expo-sqlite';

import { effectiveOf } from '@/db/anchors';
import { holdingStats } from '@/db/holdings';
import { runningBalances } from '@/utils/estimate';
import { type NetPoint, type BalancePoint, monthEnds, netWorthSeries } from '@/utils/networth';

export type NetItem = { id: number; name: string; side: 'asset' | 'liability'; amount_paise: number; updated_at: number };
export type BankBalance = { id: number; name: string; paise: number; ts: number | null; stale: boolean; /** worked out from a balance you entered plus the transactions since */ estimated: boolean };
export type NetWorth = {
  total: number;
  banks: BankBalance[];
  /** bank accounts with transactions but no balance anywhere: the user can enter one */
  unknownBanks: { id: number; name: string }[];
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
  const accts = await db.getAllAsync<{ id: number; name: string; balance_paise: number | null; balance_ts: number | null; balance_kind: string | null; anchor_paise: number | null; anchor_ts: number | null }>(
    "SELECT id, name, balance_paise, balance_ts, balance_kind, anchor_paise, anchor_ts FROM accounts WHERE kind = 'bank' AND merged_into IS NULL AND archived = 0",
  );
  const allFlows = await db.getAllAsync<{ id: number; account_id: number; ts: number; direction: 'debit' | 'credit'; amount_paise: number; balance_paise: number | null }>(
    "SELECT id, account_id, ts, direction, amount_paise, balance_paise FROM transactions WHERE account_id IS NOT NULL AND status != 'dismissed' ORDER BY ts",
  );
  const flowsBy = new Map<number, typeof allFlows>();
  for (const f of allFlows) (flowsBy.get(f.account_id) ?? flowsBy.set(f.account_id, []).get(f.account_id)!).push(f);
  const eff = new Map(accts.map((a) => [a.id, effectiveOf(a, flowsBy.get(a.id) ?? [])]));
  const banks: BankBalance[] = accts
    .filter((a) => eff.get(a.id))
    .map((a) => { const e = eff.get(a.id)!; return { id: a.id, name: a.name, paise: e.paise, ts: e.baseTs, stale: !e.rolled && now - e.baseTs > 45 * 864e5, estimated: e.source === 'entered' }; });
  const unknownBanks = accts.filter((a) => !eff.get(a.id) && (flowsBy.get(a.id)?.length ?? 0) > 0).map((a) => ({ id: a.id, name: a.name }));
  const bankTotal = banks.reduce((s, b) => s + b.paise, 0);

  const holdings = await holdingStats(db, now);
  const cost = holdings.reduce((s, h) => s + (h.putIn - h.takenOut), 0);
  const investments = holdings.reduce((s, h) => s + (h.value ?? (h.putIn - h.takenOut)), 0);
  const investmentsValued = holdings.length > 0 && holdings.every((h) => h.value != null);

  const items = await getNetItems(db);
  const assets = items.filter((i) => i.side === 'asset').reduce((s, i) => s + i.amount_paise, 0);
  const liabilities = items.filter((i) => i.side === 'liability').reduce((s, i) => s + i.amount_paise, 0);

  const bankIds = new Set(banks.map((b) => b.id));
  const per = new Map<number, BalancePoint[]>();
  for (const a of accts) {
    if (!bankIds.has(a.id)) continue;
    const flows = flowsBy.get(a.id) ?? [];
    const sms = flows.filter((f) => f.balance_paise != null).map((f) => ({ ts: f.ts, paise: f.balance_paise! }));
    const lastSms = sms.length ? sms[sms.length - 1].ts : 0;
    // a balance the user entered after the last message figure takes over; before that the messages' own balances are the history
    per.set(a.id, a.anchor_paise != null && a.anchor_ts != null && a.anchor_ts >= lastSms ? runningBalances({ paise: a.anchor_paise, ts: a.anchor_ts }, flows) : sms);
  }
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
  return { total: bankTotal + investments + assets - liabilities, banks, unknownBanks, bankTotal, investments, investmentCost: cost, investmentsValued, assets, liabilities, items, series };
}
