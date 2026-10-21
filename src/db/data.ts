import type { SQLiteDatabase } from 'expo-sqlite';

/** Removes the original SMS/notification text from transactions older than `days`. The parsed transaction stays. */
export async function purgeRawText(db: SQLiteDatabase, days: number) {
  const cutoff = Date.now() - days * 864e5;
  const r = await db.runAsync('UPDATE transactions SET raw_text = NULL WHERE raw_text IS NOT NULL AND ts < ?', cutoff);
  // unrecognised messages are only raw text, so old ones go entirely
  await db.runAsync('DELETE FROM unparsed WHERE ts < ?', cutoff);
  return r.changes;
}

/** What ExMan holds: counts by bank and source, so the user can see exactly what has been read. */
export const readSummary = (db: SQLiteDatabase) =>
  db.getAllAsync<{ bank: string | null; source: string; n: number; with_text: number }>(
    `SELECT bank, source, COUNT(*) AS n, SUM(CASE WHEN raw_text IS NOT NULL THEN 1 ELSE 0 END) AS with_text
     FROM transactions WHERE status != 'dismissed' GROUP BY bank, source ORDER BY n DESC`,
  );

/**
 * Wipes everything the user created or ExMan learned. Keeps categories, the Cash account and app settings
 * (theme, sync), and keeps the one-time backfill flags so nothing is re-processed.
 */
export async function deleteAllData(db: SQLiteDatabase) {
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const t of ['edit_log', 'rules', 'patterns', 'transactions', 'merchants', 'unparsed', 'budgets']) await tx.runAsync(`DELETE FROM ${t}`);
    await tx.runAsync("UPDATE accounts SET merged_into = NULL");
    await tx.runAsync("DELETE FROM accounts WHERE kind != 'cash'");
    await tx.runAsync("UPDATE accounts SET balance_paise = NULL, balance_kind = NULL, balance_ts = NULL");
    await tx.runAsync('DELETE FROM categories WHERE is_custom = 1');
    await tx.runAsync('UPDATE categories SET archived = 0');
  });
  await db.execAsync('VACUUM');
}
