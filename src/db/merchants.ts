import type { SQLiteDatabase } from 'expo-sqlite';

import { type Merchant } from './merchantCore';
import { type Txn, type TxnPatchFields, bulkUpdate } from './queries';

export { type Merchant, type MerchantCache, ensureMerchant } from './merchantCore';

export type Rule = { id: number; kind: 'merchant' | 'keyword'; merchant_id: number | null; keyword: string | null; category_id: number; enabled: number; created_at: number };
export const getRules = (db: SQLiteDatabase) =>
  db.getAllAsync<Rule & { merchant_name: string | null; category_name: string; category_color: string }>(
    `SELECT r.*, m.name AS merchant_name, c.name AS category_name, c.color AS category_color
     FROM rules r LEFT JOIN merchants m ON m.id = r.merchant_id JOIN categories c ON c.id = r.category_id
     ORDER BY r.kind, COALESCE(m.name, r.keyword)`,
  );

export const getMerchantRule = (db: SQLiteDatabase, merchantId: number) =>
  db.getFirstAsync<Rule>("SELECT * FROM rules WHERE kind = 'merchant' AND merchant_id = ?", merchantId);

/** Create or update the "always categorise this merchant as X" rule. */
export async function setMerchantRule(db: SQLiteDatabase, merchantId: number, categoryId: number) {
  await db.runAsync(
    `INSERT INTO rules (kind, merchant_id, category_id, enabled, created_at) VALUES ('merchant', ?, ?, 1, ?)
     ON CONFLICT (merchant_id) WHERE kind = 'merchant' DO UPDATE SET category_id = excluded.category_id, enabled = 1`,
    merchantId, categoryId, Date.now(),
  );
}

export const removeMerchantRule = (db: SQLiteDatabase, merchantId: number) => db.runAsync("DELETE FROM rules WHERE kind = 'merchant' AND merchant_id = ?", merchantId);

export const addKeywordRule = (db: SQLiteDatabase, keyword: string, categoryId: number) =>
  db.runAsync("INSERT INTO rules (kind, keyword, category_id, enabled, created_at) VALUES ('keyword', ?, ?, 1, ?)", keyword.trim().toLowerCase(), categoryId, Date.now());
export const setRuleEnabled = (db: SQLiteDatabase, id: number, enabled: boolean) => db.runAsync('UPDATE rules SET enabled = ? WHERE id = ?', enabled ? 1 : 0, id);
export const setRuleCategory = (db: SQLiteDatabase, id: number, categoryId: number) => db.runAsync('UPDATE rules SET category_id = ? WHERE id = ?', categoryId, id);
export const deleteRule = (db: SQLiteDatabase, id: number) => db.runAsync('DELETE FROM rules WHERE id = ?', id);

/** Rules loaded once per ingest batch. Merchant rules win over keyword rules. */
export async function loadRuleIndex(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<Rule>('SELECT * FROM rules WHERE enabled = 1');
  const byMerchant = new Map(rows.filter((r) => r.kind === 'merchant' && r.merchant_id).map((r) => [r.merchant_id!, r.category_id]));
  const keywords = rows.filter((r) => r.kind === 'keyword' && r.keyword);
  return {
    categoryFor(merchantId: number | null, merchantText: string | null): number | null {
      if (merchantId && byMerchant.has(merchantId)) return byMerchant.get(merchantId)!;
      const t = merchantText?.toLowerCase();
      return t ? keywords.find((k) => t.includes(k.keyword!))?.category_id ?? null : null;
    },
  };
}

/**
 * Re-categorises existing transactions of a merchant (or matching a keyword). Returns the count and an undo.
 * Only rows whose category would actually change are touched.
 */
export async function applyRuleToExisting(db: SQLiteDatabase, rule: { merchantId?: number; keyword?: string; categoryId: number }) {
  const rows = rule.merchantId
    ? await db.getAllAsync<Pick<Txn, 'id'>>("SELECT id FROM transactions WHERE merchant_id = ? AND status != 'dismissed' AND (category_id IS NULL OR category_id != ?)", rule.merchantId, rule.categoryId)
    : await db.getAllAsync<Pick<Txn, 'id'>>("SELECT id FROM transactions WHERE status != 'dismissed' AND lower(COALESCE(merchant, '')) LIKE ? AND (category_id IS NULL OR category_id != ?)", `%${rule.keyword!.toLowerCase()}%`, rule.categoryId);
  if (!rows.length) return { n: 0, undo: async () => {} };
  const undo = await bulkUpdate(db, rows.map((r) => r.id), { category_id: rule.categoryId } as TxnPatchFields);
  return { n: rows.length, undo };
}

export type MerchantStats = Merchant & { n: number; spent: number; category_id: number | null; rule_category_id: number | null };
export const getMerchantStats = (db: SQLiteDatabase) =>
  db.getAllAsync<MerchantStats>(
    `SELECT m.id, m.key, m.name,
            COUNT(t.id) AS n,
            COALESCE(SUM(CASE WHEN t.direction = 'debit' AND t.is_transfer = 0 AND t.kind NOT IN ('investment','loan') THEN t.amount_paise END), 0) AS spent,
            (SELECT category_id FROM transactions x WHERE x.merchant_id = m.id AND x.category_id IS NOT NULL GROUP BY category_id ORDER BY COUNT(*) DESC LIMIT 1) AS category_id,
            (SELECT category_id FROM rules r WHERE r.kind = 'merchant' AND r.merchant_id = m.id AND r.enabled = 1) AS rule_category_id
     FROM merchants m JOIN transactions t ON t.merchant_id = m.id AND t.status != 'dismissed'
     WHERE m.merged_into IS NULL
     GROUP BY m.id ORDER BY spent DESC, n DESC`,
  );

export async function renameMerchant(db: SQLiteDatabase, id: number, name: string) {
  await db.runAsync('UPDATE merchants SET name = ? WHERE id = ?', name, id);
  await db.runAsync('UPDATE transactions SET merchant = ? WHERE merchant_id = ?', name, id);
}

/** Moves all transactions to the target; the source stays as a hidden alias so future messages resolve to the target. */
export async function mergeMerchant(db: SQLiteDatabase, source: number, target: number) {
  if (source === target) return;
  const t = await db.getFirstAsync<{ name: string }>('SELECT name FROM merchants WHERE id = ?', target);
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('UPDATE transactions SET merchant_id = ?, merchant = ? WHERE merchant_id = ?', target, t!.name, source);
    await tx.runAsync('UPDATE merchants SET merged_into = ? WHERE id = ?', target, source);
    await tx.runAsync('UPDATE merchants SET merged_into = ? WHERE merged_into = ?', target, source);
    // a rule on the source is superseded by the target's (or moves to it when the target has none)
    await tx.runAsync("UPDATE OR IGNORE rules SET merchant_id = ? WHERE kind = 'merchant' AND merchant_id = ?", target, source);
    await tx.runAsync("DELETE FROM rules WHERE kind = 'merchant' AND merchant_id = ?", source);
  });
}
