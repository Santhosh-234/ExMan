import type { SQLiteDatabase } from 'expo-sqlite';

import { extractBalance } from '@/utils/parser';
import { type Kind, KINDS, classifyKind } from '@/utils/kinds';

/** merchant id -> the kind the user says that merchant always is (e.g. Groww is always an investment). */
export async function loadKindRules(db: SQLiteDatabase): Promise<Map<number, Kind>> {
  const rows = await db.getAllAsync<{ merchant_id: number; kind: Kind }>('SELECT merchant_id, kind FROM kind_rules');
  return new Map(rows.filter((r) => KINDS.includes(r.kind)).map((r) => [r.merchant_id, r.kind]));
}

export const setKindRule = (db: SQLiteDatabase, merchantId: number, kind: Kind) =>
  db.runAsync('INSERT INTO kind_rules (merchant_id, kind) VALUES (?, ?) ON CONFLICT(merchant_id) DO UPDATE SET kind = excluded.kind', merchantId, kind);
export const removeKindRule = (db: SQLiteDatabase, merchantId: number) => db.runAsync('DELETE FROM kind_rules WHERE merchant_id = ?', merchantId);

/** Applies a kind to every existing transaction of a merchant. Returns the ids changed and an undo. */
export async function applyKindToMerchant(db: SQLiteDatabase, merchantId: number, kind: Kind) {
  const rows = await db.getAllAsync<{ id: number; kind: Kind }>("SELECT id, kind FROM transactions WHERE merchant_id = ? AND status != 'dismissed' AND kind != ?", merchantId, kind);
  for (const r of rows) await db.runAsync('UPDATE transactions SET kind = ?, synced_at = NULL WHERE id = ?', kind, r.id);
  return { n: rows.length, undo: async () => { for (const r of rows) await db.runAsync('UPDATE transactions SET kind = ?, synced_at = NULL WHERE id = ?', r.kind, r.id); } };
}

const done = async (db: SQLiteDatabase, key: string) => (await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key))?.value === '1';
const mark = (db: SQLiteDatabase, key: string) => db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')", key);

/** One time: gives every existing message-based transaction its kind and the balance its message quoted. Manual entries stay regular. */
export async function backfillKinds(db: SQLiteDatabase) {
  if (await done(db, 'kinds_v1')) return 0;
  const rules = await loadKindRules(db);
  const rows = await db.getAllAsync<{ id: number; raw_text: string | null; merchant: string | null; merchant_id: number | null; direction: 'debit' | 'credit'; payment_mode: string | null }>(
    "SELECT id, raw_text, merchant, merchant_id, direction, payment_mode FROM transactions WHERE source != 'manual' AND kind = 'normal'",
  );
  let n = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const r of rows) {
      const kind = (r.merchant_id && rules.get(r.merchant_id)) || classifyKind({ text: r.raw_text, merchant: r.merchant, direction: r.direction, mode: r.payment_mode })?.kind;
      const bal = r.raw_text ? extractBalance(r.raw_text) : null;
      if (kind && kind !== 'normal') { await tx.runAsync('UPDATE transactions SET kind = ? WHERE id = ?', kind, r.id); n++; }
      if (bal) await tx.runAsync('UPDATE transactions SET balance_paise = ? WHERE id = ? AND balance_paise IS NULL', bal.paise, r.id);
    }
  });
  await mark(db, 'kinds_v1');
  return n;
}
