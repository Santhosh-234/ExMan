import type { SQLiteDatabase } from 'expo-sqlite';

import { type TxnFilter, buildTxnQuery } from '@/utils/filters';
import { carryOver } from '@/utils/budgets';
import { monthRange, shiftMonth } from '@/utils/format';
import { type Kind } from '@/utils/kinds';
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
  currency: string | null;
  foreign_minor: number | null;
  fx_rate: number | null;
  fx_source: string | null;
  kind: Kind;
  balance_paise: number | null;
  holding_id: number | null;
  updated_at: number | null;
};

export type Account = { id: number; name: string; kind: 'bank' | 'card' | 'cash'; bank: string | null; last4: string | null };
export type AccountStats = Account & {
  balance_paise: number | null;
  balance_kind: 'balance' | 'limit' | null;
  balance_ts: number | null;
  anchor_paise: number | null;
  anchor_ts: number | null;
  archived: number;
  spent: number;
  received: number;
  n: number;
};
export type TxnPatchFields = Partial<Pick<Txn, 'amount_paise' | 'merchant' | 'category_id' | 'tags' | 'status' | 'notes' | 'account_id' | 'is_transfer' | 'ts' | 'direction' | 'merchant_id' | 'refund_of' | 'kind' | 'holding_id'>>;

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
  if (f.amount_paise !== undefined && old.currency && old.amount_paise !== f.amount_paise) await db.runAsync("UPDATE transactions SET fx_source = 'edited' WHERE id = ?", id); // typed by the user: never re-rated
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
  // link to a canonical merchant so rules ("Always put X under Y") and transfer rules work for hand-entered rows too
  const m = await ensureMerchant(db, t.merchant);
  return (
    await db.runAsync(
      `INSERT INTO transactions (amount_paise, direction, merchant, merchant_id, category_id, account_id, source, bank, account_last4, ts, status, tags, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, 'confirmed', ?, ?, ?)`,
      t.amount_paise, t.direction, m?.name ?? t.merchant, m?.id ?? null, t.category_id, t.account_id, acct?.bank ?? null, acct?.last4 ?? null, t.ts, t.tags, t.notes, Date.now(),
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
            SUM(CASE WHEN ${COUNTED} THEN ${SPEND} END) AS spent,
            SUM(CASE WHEN t.direction = 'credit' AND ${COUNTED} AND t.refund_of IS NULL THEN t.amount_paise END) AS received
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
/** Counted as spending or income: not a transfer, and not an investment or loan movement (those are shown on their own). */
const COUNTED = "(t.is_transfer = 0 AND t.kind NOT IN ('investment','loan'))";
const SPEND = "CASE WHEN t.direction = 'debit' THEN t.amount_paise WHEN t.refund_of IS NOT NULL THEN -t.amount_paise END";
const IS_SPEND = "(t.direction = 'debit' OR (t.direction = 'credit' AND t.refund_of IS NOT NULL))";
const IS_INCOME = "(t.direction = 'credit' AND t.refund_of IS NULL)";

export const spendByCategory = (db: SQLiteDatabase, from: number, to: number) =>
  db.getAllAsync<CategorySpend>(
    `SELECT t.category_id, COALESCE(c.name, 'Uncategorised') AS name, COALESCE(c.color, '#6B7280') AS color,
            SUM(${SPEND}) AS total
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.status = 'confirmed' AND ${COUNTED} AND ${IS_SPEND} AND t.ts >= ? AND t.ts < ?
     GROUP BY t.category_id HAVING total > 0 ORDER BY total DESC`,
    from, to,
  );

export const totalFor = async (db: SQLiteDatabase, direction: 'debit' | 'credit', from: number, to: number) =>
  (
    await db.getFirstAsync<{ s: number | null }>(
      `SELECT SUM(${direction === 'debit' ? SPEND : 't.amount_paise'}) AS s FROM transactions t
       WHERE t.status = 'confirmed' AND ${COUNTED} AND ${direction === 'debit' ? IS_SPEND : IS_INCOME} AND t.ts >= ? AND t.ts < ?`,
      from, to,
    )
  )?.s ?? 0;

/** Merchants the user typed into manual entries most recently (for one-tap suggestions on the Add screen). */
/** Money put into investments (net of money taken back out) and loan repayments in a period: the movements kept out of spending. */
export async function kindTotals(db: SQLiteDatabase, from: number, to: number) {
  const rows = await db.getAllAsync<{ kind: string; direction: string; s: number }>(
    "SELECT kind, direction, SUM(amount_paise) AS s FROM transactions WHERE status = 'confirmed' AND is_transfer = 0 AND kind IN ('investment','loan') AND ts >= ? AND ts < ? GROUP BY 1, 2", from, to);
  const net = (k: string) => rows.filter((r) => r.kind === k).reduce((a, r) => a + (r.direction === 'debit' ? r.s : -r.s), 0);
  return { invested: net('investment'), loans: net('loan') };
}

export const recentManualMerchants = (db: SQLiteDatabase, limit = 6) =>
  db.getAllAsync<{ merchant: string }>(
    `SELECT merchant FROM transactions WHERE source = 'manual' AND merchant IS NOT NULL AND merchant <> '' AND status = 'confirmed'
     GROUP BY merchant ORDER BY MAX(ts) DESC LIMIT ?`, limit,
  );

export const topMerchants = (db: SQLiteDatabase, from: number, to: number, limit = 5) =>
  db.getAllAsync<{ merchant: string; total: number; n: number }>(
    `SELECT t.merchant, SUM(${SPEND}) AS total, COUNT(*) AS n FROM transactions t
     WHERE t.status = 'confirmed' AND ${COUNTED} AND ${IS_SPEND} AND t.merchant IS NOT NULL AND t.ts >= ? AND t.ts < ?
     GROUP BY t.merchant HAVING total > 0 ORDER BY total DESC LIMIT ?`,
    from, to, limit,
  );

/**
 * A budget applies from the month it was set until a later row replaces it, so it only needs setting once.
 * A row with limit 0 means "no budget from this month on". `categoryId` null is the overall monthly budget.
 */
export async function getBudgetRow(db: SQLiteDatabase, categoryId: number | null, month: string) {
  const r = await db.getFirstAsync<{ limit_paise: number; rollover: number }>(
    'SELECT limit_paise, rollover FROM budgets WHERE category_id IS ? AND month <= ? ORDER BY month DESC LIMIT 1', categoryId, month,
  );
  return r && r.limit_paise > 0 ? { limit: r.limit_paise, rollover: !!r.rollover } : null;
}

export async function setBudgetRow(db: SQLiteDatabase, categoryId: number | null, month: string, paise: number | null, rollover = false) {
  // UNIQUE(category_id, month) does not dedupe NULL category_id, so delete-then-insert
  await db.runAsync('DELETE FROM budgets WHERE category_id IS ? AND month = ?', categoryId, month);
  const prior = await db.getFirstAsync('SELECT 1 FROM budgets WHERE category_id IS ? AND month < ?', categoryId, month);
  // clearing writes a zero row so later months stop inheriting; with nothing earlier there is nothing to override
  if (paise || prior) await db.runAsync('INSERT INTO budgets (category_id, month, limit_paise, rollover) VALUES (?, ?, ?, ?)', categoryId, month, paise ?? 0, rollover ? 1 : 0);
}

export const getBudget = async (db: SQLiteDatabase, month: string) => (await getBudgetRow(db, null, month))?.limit ?? null;
export const setBudget = (db: SQLiteDatabase, month: string, paise: number | null) => setBudgetRow(db, null, month, paise, false);

export type BudgetLine = { category_id: number | null; name: string; color: string; limit: number; rollover: boolean; carry: number; spent: number };

/** Overall budget plus every category with a budget in force for `month`, with spending and rollover applied. */
export async function budgetOverview(db: SQLiteDatabase, month: string): Promise<BudgetLine[]> {
  const [from, to] = monthRange(month);
  const prevMonth = shiftMonth(month, -1);
  const [pf, pt] = monthRange(prevMonth);
  const spend = new Map((await spendByCategory(db, from, to)).map((c) => [c.category_id, c.total]));
  const prevSpend = new Map((await spendByCategory(db, pf, pt)).map((c) => [c.category_id, c.total]));
  const cats = new Map((await getCategories(db)).map((c) => [c.id, c]));
  const ids: (number | null)[] = [null, ...(await db.getAllAsync<{ category_id: number }>('SELECT DISTINCT category_id FROM budgets WHERE category_id IS NOT NULL AND month <= ?', month)).map((r) => r.category_id)];
  const out: BudgetLine[] = [];
  for (const id of ids) {
    const row = await getBudgetRow(db, id, month);
    if (!row) continue;
    let carry = 0;
    if (row.rollover) {
      const prev = await getBudgetRow(db, id, prevMonth);
      if (prev) carry = carryOver(prev.limit, id === null ? await totalFor(db, 'debit', pf, pt) : prevSpend.get(id) ?? 0);
    }
    out.push({
      category_id: id, name: id === null ? 'Overall' : cats.get(id)?.name ?? 'Category', color: id === null ? '#10B981' : cats.get(id)?.color ?? '#6B7280',
      limit: row.limit, rollover: row.rollover, carry, spent: id === null ? await totalFor(db, 'debit', from, to) : spend.get(id) ?? 0,
    });
  }
  return out;
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
     FROM transactions t WHERE t.status = 'confirmed' AND ${COUNTED} AND t.ts >= ? AND t.ts < ? GROUP BY 1, 2`,
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
    `SELECT a.id, a.name, a.kind, a.bank, a.last4, a.balance_paise, a.balance_kind, a.balance_ts, a.anchor_paise, a.anchor_ts, a.archived,
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
    'SELECT id, name, kind, bank, last4, balance_paise, balance_kind, balance_ts, anchor_paise, anchor_ts, archived, 0 AS spent, 0 AS received, 0 AS n FROM accounts WHERE id = ?', id,
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

/** Everything the CSV needs, joined to names, for [from, to). Dismissed rows are skipped. */
export const exportRows = (db: SQLiteDatabase, from = 0, to = 8.64e15) =>
  db.getAllAsync<import('@/utils/csv').ExportRow>(
    `SELECT t.ts, t.direction, t.is_transfer, t.refund_of, t.amount_paise, t.currency, t.foreign_minor, t.merchant,
            c.name AS category, a.name AS account, t.bank, t.account_last4, t.payment_mode, t.source, t.tags, t.notes, t.status, t.transfer_reason
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN accounts a ON a.id = t.account_id
     WHERE t.status != 'dismissed' AND t.ts >= ? AND t.ts < ? ORDER BY t.ts DESC`,
    from, to,
  );
