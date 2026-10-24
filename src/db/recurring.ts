import type { SQLiteDatabase } from 'expo-sqlite';

import { type Recurring, detectRecurring } from '@/utils/recurring';

/** Recurring payments found in the last 18 months of confirmed spending, minus ones the user dismissed. */
export async function getRecurring(db: SQLiteDatabase, now = Date.now()): Promise<Recurring[]> {
  const since = now - 548 * 864e5;
  const charges = await db.getAllAsync<{ merchant_id: number; merchant: string; amount_paise: number; ts: number }>(
    `SELECT t.merchant_id, t.merchant, t.amount_paise, t.ts FROM transactions t
     WHERE t.status = 'confirmed' AND t.direction = 'debit' AND t.is_transfer = 0 AND t.kind NOT IN ('investment','loan') AND t.merchant_id IS NOT NULL AND t.ts >= ?
       AND t.merchant_id NOT IN (SELECT merchant_id FROM recurring_dismissed)`,
    since,
  );
  return detectRecurring(charges, now);
}

export const dismissRecurring = (db: SQLiteDatabase, merchantId: number) => db.runAsync('INSERT OR IGNORE INTO recurring_dismissed (merchant_id) VALUES (?)', merchantId);
export const restoreRecurring = (db: SQLiteDatabase, merchantId: number) => db.runAsync('DELETE FROM recurring_dismissed WHERE merchant_id = ?', merchantId);

/** Active and overdue payments summed per month, for the headline figure. */
export const monthlyTotal = (list: Recurring[]) => list.filter((r) => r.status !== 'ended').reduce((s, r) => s + r.monthlyCost, 0);
