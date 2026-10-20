import type { SQLiteDatabase } from 'expo-sqlite';

export type Category = { id: number; name: string; icon: string; color: string };
export type Txn = {
  id: number;
  amount_paise: number;
  direction: 'debit' | 'credit';
  merchant: string | null;
  category_id: number | null;
  source: string;
  bank: string | null;
  account_last4: string | null;
  payment_mode: string | null;
  ts: number;
  status: 'pending' | 'confirmed' | 'dismissed';
  tags: string;
  raw_text: string | null;
};

export const getCategories = (db: SQLiteDatabase) =>
  db.getAllAsync<Category>('SELECT id, name, icon, color FROM categories ORDER BY id');

export const getTxns = (db: SQLiteDatabase, status: 'pending' | 'confirmed' | 'dismissed', from = 0, to = 8.64e15) =>
  db.getAllAsync<Txn>(
    'SELECT * FROM transactions WHERE status = ? AND ts >= ? AND ts < ? ORDER BY ts DESC',
    status, from, to,
  );

export const updateTxn = (
  db: SQLiteDatabase,
  id: number,
  f: Partial<Pick<Txn, 'amount_paise' | 'merchant' | 'category_id' | 'tags' | 'status'>>,
) => {
  const keys = Object.keys(f) as (keyof typeof f)[];
  if (!keys.length) return Promise.resolve();
  return db.runAsync(
    `UPDATE transactions SET ${keys.map((k) => `${k} = ?`).join(', ')}, synced_at = NULL WHERE id = ?`,
    ...keys.map((k) => f[k] as string | number | null), id,
  );
};

export const deleteTxn = (db: SQLiteDatabase, id: number) => db.runAsync('DELETE FROM transactions WHERE id = ?', id);

export type CategorySpend = { category_id: number | null; name: string; color: string; total: number };

/** Confirmed debits grouped by category within [from, to). */
export const spendByCategory = (db: SQLiteDatabase, from: number, to: number) =>
  db.getAllAsync<CategorySpend>(
    `SELECT t.category_id, COALESCE(c.name, 'Uncategorised') AS name, COALESCE(c.color, '#6B7280') AS color,
            SUM(t.amount_paise) AS total
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.status = 'confirmed' AND t.direction = 'debit' AND t.ts >= ? AND t.ts < ?
     GROUP BY t.category_id ORDER BY total DESC`,
    from, to,
  );

export const totalFor = async (db: SQLiteDatabase, direction: 'debit' | 'credit', from: number, to: number) =>
  (
    await db.getFirstAsync<{ s: number | null }>(
      `SELECT SUM(amount_paise) AS s FROM transactions
       WHERE status = 'confirmed' AND direction = ? AND ts >= ? AND ts < ?`,
      direction, from, to,
    )
  )?.s ?? 0;

export const topMerchants = (db: SQLiteDatabase, from: number, to: number, limit = 5) =>
  db.getAllAsync<{ merchant: string; total: number; n: number }>(
    `SELECT merchant, SUM(amount_paise) AS total, COUNT(*) AS n FROM transactions
     WHERE status = 'confirmed' AND direction = 'debit' AND merchant IS NOT NULL AND ts >= ? AND ts < ?
     GROUP BY merchant ORDER BY total DESC LIMIT ?`,
    from, to, limit,
  );

export async function getBudget(db: SQLiteDatabase, month: string) {
  return (
    (await db.getFirstAsync<{ limit_paise: number }>(
      'SELECT limit_paise FROM budgets WHERE category_id IS NULL AND month = ?', month,
    ))?.limit_paise ?? null
  );
}

export async function setBudget(db: SQLiteDatabase, month: string, paise: number | null) {
  // UNIQUE(category_id, month) does not dedupe NULL category_id, so delete-then-insert
  await db.runAsync('DELETE FROM budgets WHERE category_id IS NULL AND month = ?', month);
  if (paise) await db.runAsync('INSERT INTO budgets (category_id, month, limit_paise) VALUES (NULL, ?, ?)', month, paise);
}

export async function getSetting(db: SQLiteDatabase, key: string) {
  return (await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key))?.value ?? '';
}

export const setSetting = (db: SQLiteDatabase, key: string, value: string) =>
  db.runAsync('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);

/** Confirmed totals per month and direction in one scan: [{month:'2026-10', direction, total}]. */
export const monthlyTotals = (db: SQLiteDatabase, from: number, to: number) =>
  db.getAllAsync<{ month: string; direction: 'debit' | 'credit'; total: number }>(
    `SELECT strftime('%Y-%m', ts / 1000, 'unixepoch', 'localtime') AS month, direction, SUM(amount_paise) AS total
     FROM transactions WHERE status = 'confirmed' AND ts >= ? AND ts < ? GROUP BY month, direction`,
    from, to,
  );

export const countPending = async (db: SQLiteDatabase) =>
  (await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM transactions WHERE status = 'pending'"))?.n ?? 0;
