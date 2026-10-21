import type { SQLiteDatabase } from 'expo-sqlite';

import { type TxnFilter, buildTxnQuery } from '@/utils/filters';
import { ensureMerchant } from './merchantCore';

export type Category = { id: number; name: string; icon: string; color: string; archived: number; is_custom: number };
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
  account_id: number | null;
  msg_hash: string | null;
  merchant_id: number | null;
  notes: string | null;
  is_transfer: number;
  transfer_auto: number;
  transfer_reason: string | null;
  transfer_pair_id: number | null;
  transfer_blocked: number;
  refund_of: number | null;
  updated_at: number | null;
};

export type Account = { id: number; name: string; kind: 'bank' | 'card' | 'cash'; bank: string | null; last4: string | null };
export type AccountStats = Account & {
  balance_paise: number | null;
  balance_kind: 'balance' | 'limit' | null;
  balance_ts: number | null;
  archived: number;
  spent: number;
  received: number;
  n: number;
};
export type TxnPatchFields = Partial<Pick<Txn, 'amount_paise' | 'merchant' | 'category_id' | 'tags' | 'status' | 'notes' | 'account_id' | 'is_transfer' | 'ts' | 'direction' | 'merchant_id' | 'refund_of'>>;

export const getCategories = (db: SQLiteDatabase) =>
  db.getAllAsync<Category>('SELECT id, name, icon, color, archived, is_custom FROM categories ORDER BY archived, id');

export const getTxns = (db: SQLiteDatabase, status: 'pending' | 'confirmed' | 'dismissed', from = 0, to = 8.64e15) =>
  db.getAllAsync<Txn>(
    'SELECT * FROM transactions WHERE status = ? AND ts >= ? AND ts < ? ORDER BY ts DESC',
    status, from, to,
  );

/** Updates fields and, for already-confirmed rows, records what changed (shown on the detail screen). */
export async function updateTxn(db: SQLiteDatabase, id: number, f: TxnPatchFields) {
  // editing the merchant text re-links the canonical merchant (and stores its clean name)
  if ('merchant' in f) {
    const m = await ensureMerchant(db, f.merchant ?? null);
    f = { ...f, merchant: m?.name ?? f.merchant ?? null, merchant_id: m?.id ?? null };
  }
  const keys = Object.keys(f) as (keyof TxnPatchFields)[];
  if (!keys.length) return;
  const old = await db.getFirstAsync<Txn>('SELECT * FROM transactions WHERE id = ?', id);
  if (!old) return;
  const now = Date.now();
  await db.runAsync(
    `UPDATE transactions SET ${keys.map((k) => `${k} = ?`).join(', ')}, synced_at = NULL, updated_at = ? WHERE id = ?`,
    ...keys.map((k) => f[k] as string | number | null), now, id,
  );
  if (old.status !== 'confirmed') return;
  for (const k of keys) {
    if (k === 'status' || k === 'merchant_id' || old[k] === f[k]) continue;
    await db.runAsync('INSERT INTO edit_log (txn_id, field, old_value, new_value, ts) VALUES (?, ?, ?, ?, ?)', id, k, old[k] == null ? null : String(old[k]), f[k] == null ? null : String(f[k]), now);
  }
}

export const getTxn = (db: SQLiteDatabase, id: number) => db.getFirstAsync<Txn>('SELECT * FROM transactions WHERE id = ?', id);
export const getEditLog = (db: SQLiteDatabase, id: number) =>
  db.getAllAsync<{ field: string; old_value: string | null; new_value: string | null; ts: number }>(
    'SELECT field, old_value, new_value, ts FROM edit_log WHERE txn_id = ? ORDER BY ts DESC, id DESC', id,
  );
export const getAccounts = (db: SQLiteDatabase) =>
  db.getAllAsync<Account>('SELECT id, name, kind, bank, last4 FROM accounts WHERE merged_into IS NULL AND archived = 0 ORDER BY kind = \'cash\' DESC, name');

/** Hand-entered transaction (cash etc.); confirmed immediately, no message to hash. */
export async function addManualTxn(
  db: SQLiteDatabase,
  t: { amount_paise: number; direction: 'debit' | 'credit'; merchant: string | null; category_id: number | null; account_id: number | null; ts: number; tags: string; notes: string | null },
) {
  const acct = t.account_id ? await db.getFirstAsync<Account>('SELECT * FROM accounts WHERE id = ?', t.account_id) : null;
  return (
    await db.runAsync(
      `INSERT INTO transactions (amount_paise, direction, merchant, category_id, account_id, source, bank, account_last4, ts, status, tags, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?, 'confirmed', ?, ?, ?)`,
      t.amount_paise, t.direction, t.merchant, t.category_id, t.account_id, acct?.bank ?? null, acct?.last4 ?? null, t.ts, t.tags, t.notes, Date.now(),
    )
  ).lastInsertRowId;
}

export const PAGE = 100;
/** Filtered ledger page + the aggregate for the whole filtered set. */
export async function queryTxns(db: SQLiteDatabase, f: TxnFilter, offset = 0) {
  const { where, params } = buildTxnQuery(f);
  return db.getAllAsync<Txn>(`SELECT t.* FROM transactions t WHERE ${where} ORDER BY t.ts DESC, t.id DESC LIMIT ${PAGE} OFFSET ?`, ...params, offset);
}
export async function summarize(db: SQLiteDatabase, f: TxnFilter) {
  const { where, params } = buildTxnQuery(f);
  const r = await db.getFirstAsync<{ n: number; spent: number | null; received: number | null }>(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN t.is_transfer = 0 THEN ${SPEND} END) AS spent,
            SUM(CASE WHEN t.direction = 'credit' AND t.is_transfer = 0 AND t.refund_of IS NULL THEN t.amount_paise END) AS received
     FROM transactions t WHERE ${where}`,
    ...params,
  );
  return { n: r?.n ?? 0, spent: r?.spent ?? 0, received: r?.received ?? 0 };
}

/** Applies one patch to many rows; returns the previous values so the caller can offer Undo. */
export async function bulkUpdate(db: SQLiteDatabase, ids: number[], patch: TxnPatchFields) {
  const keys = Object.keys(patch) as (keyof TxnPatchFields)[];
  const before = await db.getAllAsync<Txn>(`SELECT * FROM transactions WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  for (const id of ids) await updateTxn(db, id, patch);
  return () => (async () => {
    for (const b of before) await updateTxn(db, b.id, Object.fromEntries(keys.map((k) => [k, b[k]])) as TxnPatchFields);
  })();
}
export const deleteTxn = (db: SQLiteDatabase, id: number) => db.runAsync('DELETE FROM transactions WHERE id = ?', id);

export type CategorySpend = { category_id: number | null; name: string; color: string; total: number };

/** Confirmed debits grouped by category within [from, to). */
// Spending is debits minus credits linked to a purchase as a refund; income is credits that aren't refunds.
const SPEND = "CASE WHEN t.direction = 'debit' THEN t.amount_paise WHEN t.refund_of IS NOT NULL THEN -t.amount_paise END";
const IS_SPEND = "(t.direction = 'debit' OR (t.direction = 'credit' AND t.refund_of IS NOT NULL))";
const IS_INCOME = "(t.direction = 'credit' AND t.refund_of IS NULL)";

export const spendByCategory = (db: SQLiteDatabase, from: number, to: number) =>
  db.getAllAsync<CategorySpend>(
    `SELECT t.category_id, COALESCE(c.name, 'Uncategorised') AS name, COALESCE(c.color, '#6B7280') AS color,
            SUM(${SPEND}) AS total
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.status = 'confirmed' AND t.is_transfer = 0 AND ${IS_SPEND} AND t.ts >= ? AND t.ts < ?
     GROUP BY t.category_id HAVING total > 0 ORDER BY total DESC`,
    from, to,
  );

export const totalFor = async (db: SQLiteDatabase, direction: 'debit' | 'credit', from: number, to: number) =>
  (
    await db.getFirstAsync<{ s: number | null }>(
      `SELECT SUM(${direction === 'debit' ? SPEND : 't.amount_paise'}) AS s FROM transactions t
       WHERE t.status = 'confirmed' AND t.is_transfer = 0 AND ${direction === 'debit' ? IS_SPEND : IS_INCOME} AND t.ts >= ? AND t.ts < ?`,
      from, to,
    )
  )?.s ?? 0;

export const topMerchants = (db: SQLiteDatabase, from: number, to: number, limit = 5) =>
  db.getAllAsync<{ merchant: string; total: number; n: number }>(
    `SELECT t.merchant, SUM(${SPEND}) AS total, COUNT(*) AS n FROM transactions t
     WHERE t.status = 'confirmed' AND t.is_transfer = 0 AND ${IS_SPEND} AND t.merchant IS NOT NULL AND t.ts >= ? AND t.ts < ?
     GROUP BY t.merchant HAVING total > 0 ORDER BY total DESC LIMIT ?`,
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
    `SELECT strftime('%Y-%m', t.ts / 1000, 'unixepoch', 'localtime') AS month,
            CASE WHEN ${IS_SPEND} THEN 'debit' ELSE 'credit' END AS direction,
            SUM(CASE WHEN ${IS_SPEND} THEN ${SPEND} ELSE t.amount_paise END) AS total
     FROM transactions t WHERE t.status = 'confirmed' AND t.is_transfer = 0 AND t.ts >= ? AND t.ts < ? GROUP BY 1, 2`,
    from, to,
  );

export const countPending = async (db: SQLiteDatabase) =>
  (await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM transactions WHERE status = 'pending'"))?.n ?? 0;

/** Categories ordered by how often the user has confirmed them (for one-tap suggestions). */
export const topCategoryIds = async (db: SQLiteDatabase, limit = 5) =>
  (
    await db.getAllAsync<{ category_id: number }>(
      `SELECT category_id FROM transactions WHERE status = 'confirmed' AND category_id IS NOT NULL
       GROUP BY category_id ORDER BY COUNT(*) DESC LIMIT ?`,
      limit,
    )
  ).map((r) => r.category_id);

export const getAccountNames = async (db: SQLiteDatabase) =>
  new Map((await db.getAllAsync<{ id: number; name: string }>('SELECT id, name FROM accounts')).map((a) => [a.id, a.name]));

/** All visible accounts with this-period activity; archived ones included so the screen can show them dimmed. */
export const getAccountStats = (db: SQLiteDatabase, from: number, to: number) =>
  db.getAllAsync<AccountStats>(
    `SELECT a.id, a.name, a.kind, a.bank, a.last4, a.balance_paise, a.balance_kind, a.balance_ts, a.archived,
            COALESCE(SUM(CASE WHEN t.direction = 'debit' AND t.is_transfer = 0 THEN t.amount_paise END), 0) AS spent,
            COALESCE(SUM(CASE WHEN t.direction = 'credit' AND t.is_transfer = 0 THEN t.amount_paise END), 0) AS received,
            COUNT(t.id) AS n
     FROM accounts a
     LEFT JOIN transactions t ON t.account_id = a.id AND t.status = 'confirmed' AND t.ts >= ? AND t.ts < ?
     WHERE a.merged_into IS NULL
     GROUP BY a.id
     ORDER BY a.archived, a.kind = 'cash' DESC, a.kind, a.name`,
    from, to,
  );

export const getAccount = (db: SQLiteDatabase, id: number) =>
  db.getFirstAsync<AccountStats>(
    'SELECT id, name, kind, bank, last4, balance_paise, balance_kind, balance_ts, archived, 0 AS spent, 0 AS received, 0 AS n FROM accounts WHERE id = ?', id,
  );

export const setAccountFirefly = (db: SQLiteDatabase, id: number, name: string) => db.runAsync('UPDATE accounts SET firefly_name = ? WHERE id = ?', name.trim() || null, id);
export const getAccountFirefly = async (db: SQLiteDatabase, id: number) => (await db.getFirstAsync<{ firefly_name: string | null }>('SELECT firefly_name FROM accounts WHERE id = ?', id))?.firefly_name ?? '';
export const renameAccount = (db: SQLiteDatabase, id: number, name: string) => db.runAsync('UPDATE accounts SET name = ? WHERE id = ?', name, id);
export const setAccountArchived = (db: SQLiteDatabase, id: number, archived: boolean) => db.runAsync('UPDATE accounts SET archived = ? WHERE id = ?', archived ? 1 : 0, id);

export async function addAccount(db: SQLiteDatabase, name: string, kind: Account['kind']) {
  // bank/last4 stay NULL: hand-made accounts never match SMS, so nothing is auto-assigned to them
  return (await db.runAsync('INSERT INTO accounts (name, kind) VALUES (?, ?)', name, kind)).lastInsertRowId;
}

/** Moves all transactions to `target`; the source stays as a hidden alias so later SMS keep resolving to the target. */
export async function mergeAccount(db: SQLiteDatabase, source: number, target: number) {
  if (source === target) return;
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('UPDATE transactions SET account_id = ? WHERE account_id = ?', target, source);
    await tx.runAsync('UPDATE accounts SET merged_into = ? WHERE id = ?', target, source);
    // anything previously merged into the source now points at the target
    await tx.runAsync('UPDATE accounts SET merged_into = ? WHERE merged_into = ?', target, source);
    // keep whichever balance is newer
    await tx.runAsync(
      `UPDATE accounts SET balance_paise = s.balance_paise, balance_kind = s.balance_kind, balance_ts = s.balance_ts
       FROM (SELECT balance_paise, balance_kind, balance_ts FROM accounts WHERE id = ?) AS s
       WHERE accounts.id = ? AND s.balance_ts IS NOT NULL AND (accounts.balance_ts IS NULL OR accounts.balance_ts < s.balance_ts)`,
      source, target,
    );
  });
}

export const CATEGORY_COLORS = ['#F59E0B', '#84CC16', '#3B82F6', '#EC4899', '#8B5CF6', '#F43F5E', '#14B8A6', '#10B981', '#06B6D4', '#F97316', '#A855F7', '#6B7280'];

export const getCategoryUsage = (db: SQLiteDatabase) =>
  db.getAllAsync<{ category_id: number; n: number }>("SELECT category_id, COUNT(*) AS n FROM transactions WHERE category_id IS NOT NULL AND status != 'dismissed' GROUP BY category_id");

export async function addCategory(db: SQLiteDatabase, name: string, color: string) {
  // names are unique; a clash (even with an archived category) is reported instead of silently merging
  const clash = await db.getFirstAsync('SELECT 1 FROM categories WHERE lower(name) = lower(?)', name);
  if (clash) throw new Error('A category with that name already exists');
  return (await db.runAsync("INSERT INTO categories (name, icon, color, is_custom) VALUES (?, 'tag', ?, 1)", name, color)).lastInsertRowId;
}

export async function updateCategory(db: SQLiteDatabase, id: number, f: { name?: string; color?: string }) {
  if (f.name != null) {
    const clash = await db.getFirstAsync('SELECT 1 FROM categories WHERE lower(name) = lower(?) AND id != ?', f.name, id);
    if (clash) throw new Error('A category with that name already exists');
    await db.runAsync('UPDATE categories SET name = ? WHERE id = ?', f.name, id);
  }
  if (f.color != null) await db.runAsync('UPDATE categories SET color = ? WHERE id = ?', f.color, id);
}

export const setCategoryArchived = (db: SQLiteDatabase, id: number, archived: boolean) => db.runAsync('UPDATE categories SET archived = ? WHERE id = ?', archived ? 1 : 0, id);

/** Custom categories only. Their transactions become uncategorised; rules pointing at it are removed (FK cascade). */
export async function deleteCategory(db: SQLiteDatabase, id: number) {
  const c = await db.getFirstAsync<{ is_custom: number }>('SELECT is_custom FROM categories WHERE id = ?', id);
  if (!c?.is_custom) throw new Error('Built-in categories can be archived but not deleted');
  await db.runAsync('DELETE FROM categories WHERE id = ?', id);
}

/** Purchases a refund could belong to: confirmed debits up to 180 days before it, same merchant first. */
export async function refundCandidates(db: SQLiteDatabase, refund: Pick<Txn, 'id' | 'amount_paise' | 'ts' | 'merchant_id'>) {
  return db.getAllAsync<Txn>(
    `SELECT * FROM transactions
     WHERE direction = 'debit' AND status = 'confirmed' AND is_transfer = 0 AND amount_paise >= ? AND ts <= ? AND ts >= ?
     ORDER BY (merchant_id IS NOT NULL AND merchant_id = ?) DESC, (amount_paise = ?) DESC, ts DESC LIMIT 15`,
    refund.amount_paise, refund.ts, refund.ts - 180 * 864e5, refund.merchant_id ?? -1, refund.amount_paise,
  );
}

/** Links a credit to its purchase: it takes the purchase's category and merchant so reports net it out correctly. */
export async function linkRefund(db: SQLiteDatabase, refundId: number, purchase: Pick<Txn, 'id' | 'category_id' | 'merchant_id' | 'merchant'>) {
  await updateTxn(db, refundId, { refund_of: purchase.id, category_id: purchase.category_id, merchant_id: purchase.merchant_id, merchant: purchase.merchant });
}
export const unlinkRefund = (db: SQLiteDatabase, refundId: number) => updateTxn(db, refundId, { refund_of: null });
