import type { SQLiteDatabase } from 'expo-sqlite';

import { type HoldingType, holdingFor } from '@/utils/holdings';
import { xirr } from '@/utils/xirr';

export type Holding = { id: number; name: string; key: string; type: HoldingType; current_paise: number | null; valued_at: number | null; archived: number };
export type HoldingStat = Holding & {
  putIn: number; takenOut: number; n: number; firstTs: number | null; lastTs: number | null;
  /** worth today as entered by the user, else null */
  value: number | null;
  /** value + withdrawals - contributions; null until a value is entered */
  gain: number | null;
  gainPct: number | null;
  xirr: number | null;
  /** average put in per month over the last 3 months */
  monthly: number;
};

/** Gives every investment transaction its holding, and releases ones that are no longer investments. Cheap; call after ingest and before showing holdings. */
export async function syncHoldings(db: SQLiteDatabase): Promise<void> {
  await db.runAsync("UPDATE transactions SET holding_id = NULL WHERE kind != 'investment' AND holding_id IS NOT NULL");
  const rows = await db.getAllAsync<{ id: number; raw_text: string | null; merchant: string | null }>("SELECT id, raw_text, merchant FROM transactions WHERE kind = 'investment' AND holding_id IS NULL");
  if (!rows.length) return;
  const ids = new Map<string, number>();
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const r of rows) {
      const h = holdingFor(r.raw_text, r.merchant);
      let id = ids.get(h.key);
      if (!id) {
        await tx.runAsync('INSERT OR IGNORE INTO holdings (name, key, type) VALUES (?, ?, ?)', h.name, h.key, h.type);
        id = (await tx.getFirstAsync<{ id: number }>('SELECT id FROM holdings WHERE key = ?', h.key))!.id;
        ids.set(h.key, id);
      }
      await tx.runAsync('UPDATE transactions SET holding_id = ? WHERE id = ?', id, r.id);
    }
  });
}

export async function holdingStats(db: SQLiteDatabase, now = Date.now()): Promise<HoldingStat[]> {
  const holdings = await db.getAllAsync<Holding>('SELECT * FROM holdings WHERE archived = 0 ORDER BY name');
  const txns = await db.getAllAsync<{ holding_id: number; direction: 'debit' | 'credit'; amount_paise: number; ts: number }>(
    "SELECT holding_id, direction, amount_paise, ts FROM transactions WHERE holding_id IS NOT NULL AND kind = 'investment' AND status != 'dismissed' ORDER BY ts",
  );
  const by = new Map<number, typeof txns>();
  for (const t of txns) (by.get(t.holding_id) ?? by.set(t.holding_id, []).get(t.holding_id)!).push(t);
  return holdings.map((h) => {
    const rows = by.get(h.id) ?? [];
    const putIn = rows.filter((r) => r.direction === 'debit').reduce((s, r) => s + r.amount_paise, 0);
    const takenOut = rows.filter((r) => r.direction === 'credit').reduce((s, r) => s + r.amount_paise, 0);
    const value = h.current_paise;
    const gain = value == null ? null : value + takenOut - putIn;
    const flows = rows.map((r) => ({ ts: r.ts, amount: r.direction === 'debit' ? -r.amount_paise : r.amount_paise }));
    if (value != null) flows.push({ ts: now, amount: value });
    return {
      ...h, putIn, takenOut, n: rows.length, firstTs: rows[0]?.ts ?? null, lastTs: rows[rows.length - 1]?.ts ?? null,
      value, gain, gainPct: gain != null && putIn > 0 ? gain / putIn : null,
      xirr: value != null ? xirr(flows) : null,
      monthly: Math.round(rows.filter((r) => r.direction === 'debit' && r.ts >= now - 90 * 864e5).reduce((s, r) => s + r.amount_paise, 0) / 3),
    };
  });
}

export const setHoldingValue = (db: SQLiteDatabase, id: number, paise: number | null) =>
  db.runAsync('UPDATE holdings SET current_paise = ?, valued_at = ? WHERE id = ?', paise, paise == null ? null : Date.now(), id);
export const renameHolding = (db: SQLiteDatabase, id: number, name: string) => db.runAsync('UPDATE holdings SET name = ? WHERE id = ?', name.trim(), id);
export const setHoldingType = (db: SQLiteDatabase, id: number, type: HoldingType) => db.runAsync('UPDATE holdings SET type = ? WHERE id = ?', type, id);
export const archiveHolding = (db: SQLiteDatabase, id: number, archived: boolean) => db.runAsync('UPDATE holdings SET archived = ? WHERE id = ?', archived ? 1 : 0, id);

/** A holding with no transactions behind it (gold at home, a policy, a friend's startup): just a name and a value. */
export async function addManualHolding(db: SQLiteDatabase, name: string, type: HoldingType, valuePaise: number | null) {
  const key = `manual:${name.trim().toLowerCase()}`;
  await db.runAsync('INSERT OR IGNORE INTO holdings (name, key, type, current_paise, valued_at) VALUES (?, ?, ?, ?, ?)', name.trim(), key, type, valuePaise, valuePaise == null ? null : Date.now());
  return (await db.getFirstAsync<{ id: number }>('SELECT id FROM holdings WHERE key = ?', key))!.id;
}
