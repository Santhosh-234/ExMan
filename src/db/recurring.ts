import type { SQLiteDatabase } from 'expo-sqlite';

import { type Cadence, type Charge, type Maybe, type Recurring, detectRecurring, suggestSubscriptions } from '@/utils/recurring';

type Row = { merchant_id: number; merchant: string; amount_paise: number; ts: number; unit: number | null };

/** Debits that could be subscription payments: pending ones count too (a subscription should not wait for you to review it), investments and loans do not. */
async function charges(db: SQLiteDatabase, now: number): Promise<Charge[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT t.merchant_id, t.merchant, t.amount_paise, t.ts, CASE WHEN t.currency IS NOT NULL THEN t.foreign_minor END AS unit FROM transactions t
     WHERE t.status != 'dismissed' AND t.direction = 'debit' AND t.is_transfer = 0 AND t.kind NOT IN ('investment','loan') AND t.merchant_id IS NOT NULL AND t.ts >= ?`,
    now - 548 * 864e5,
  );
  return rows.map((r) => ({ merchant_id: r.merchant_id, merchant: r.merchant, amount_paise: r.amount_paise, ts: r.ts, ...(r.unit ? { unit: r.unit } : {}) }));
}

const declaredMap = async (db: SQLiteDatabase) => new Map((await db.getAllAsync<{ merchant_id: number; cadence: Cadence }>('SELECT merchant_id, cadence FROM subs_marked')).map((r) => [r.merchant_id, r.cadence]));
const dismissedSet = async (db: SQLiteDatabase) => new Set((await db.getAllAsync<{ merchant_id: number }>('SELECT merchant_id FROM recurring_dismissed')).map((r) => r.merchant_id));

/** Recurring payments from the last 18 months, minus ones the user dismissed, plus ones the user declared. */
export async function getRecurring(db: SQLiteDatabase, now = Date.now()): Promise<Recurring[]> {
  const [cs, declared, dismissed] = await Promise.all([charges(db, now), declaredMap(db), dismissedSet(db)]);
  return detectRecurring(cs.filter((c) => declared.has(c.merchant_id) || !dismissed.has(c.merchant_id)), now, { declared });
}

/** Payees with two matching charges so far: worth asking "is this a subscription?". */
export async function getSuggestions(db: SQLiteDatabase, now = Date.now()): Promise<Maybe[]> {
  const [cs, declared, dismissed] = await Promise.all([charges(db, now), declaredMap(db), dismissedSet(db)]);
  const skip = new Set<number>([...declared.keys(), ...dismissed, ...detectRecurring(cs, now).map((r) => r.merchant_id)]);
  return suggestSubscriptions(cs, now, skip);
}

/** Declares a payee a subscription with this cadence (undoes an earlier "not a subscription"). */
export async function markSubscription(db: SQLiteDatabase, merchantId: number, cadence: Cadence) {
  await db.runAsync('INSERT INTO subs_marked (merchant_id, cadence, created_at) VALUES (?, ?, ?) ON CONFLICT(merchant_id) DO UPDATE SET cadence = excluded.cadence', merchantId, cadence, Date.now());
  await db.runAsync('DELETE FROM recurring_dismissed WHERE merchant_id = ?', merchantId);
}
export const unmarkSubscription = (db: SQLiteDatabase, merchantId: number) => db.runAsync('DELETE FROM subs_marked WHERE merchant_id = ?', merchantId);
export const isMarkedSubscription = async (db: SQLiteDatabase, merchantId: number) => !!(await db.getFirstAsync('SELECT 1 FROM subs_marked WHERE merchant_id = ?', merchantId));

/** Payees paid in the last few months, most recent first: the list to pick from when adding a subscription by hand. */
export const recentPayees = (db: SQLiteDatabase, now = Date.now()) =>
  db.getAllAsync<{ merchant_id: number; merchant: string; last_ts: number; last_amount: number; n: number }>(
    `SELECT t.merchant_id, t.merchant, MAX(t.ts) AS last_ts, (SELECT amount_paise FROM transactions x WHERE x.merchant_id = t.merchant_id AND x.direction = 'debit' ORDER BY x.ts DESC LIMIT 1) AS last_amount, COUNT(*) AS n
     FROM transactions t WHERE t.status != 'dismissed' AND t.direction = 'debit' AND t.is_transfer = 0 AND t.kind NOT IN ('investment','loan') AND t.merchant_id IS NOT NULL AND t.ts >= ?
     GROUP BY t.merchant_id ORDER BY last_ts DESC LIMIT 80`,
    now - 200 * 864e5,
  );

export const dismissRecurring = async (db: SQLiteDatabase, merchantId: number) => { await db.runAsync('INSERT OR IGNORE INTO recurring_dismissed (merchant_id) VALUES (?)', merchantId); await unmarkSubscription(db, merchantId); };
export const restoreRecurring = (db: SQLiteDatabase, merchantId: number) => db.runAsync('DELETE FROM recurring_dismissed WHERE merchant_id = ?', merchantId);

/** Active and overdue payments summed per month, for the headline figure. */
export const monthlyTotal = (list: Recurring[]) => list.filter((r) => r.status !== 'ended').reduce((s, r) => s + r.monthlyCost, 0);
