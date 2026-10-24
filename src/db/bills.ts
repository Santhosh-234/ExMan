import type { SQLiteDatabase } from 'expo-sqlite';

import { hashMessage } from '@/utils/hash';
import { parseBill } from '@/utils/bills';
import { bankFor } from '@/utils/parser';

export type Bill = { id: number; account_id: number | null; bank: string | null; last4: string | null; amount_paise: number; due_ts: number; status: string; created_ts: number; accountName: string | null };

/** Stores a bill notice if the message is one. Returns true when it was (so the caller does not also file it as unrecognised). */
export async function recordBill(db: SQLiteDatabase, m: { sender: string; text: string; ts: number }): Promise<boolean> {
  const bank = bankFor(m.sender, m.text);
  const b = parseBill(m.text, bank);
  if (!b) return false;
  const acct = b.last4
    ? await db.getFirstAsync<{ id: number }>("SELECT id FROM accounts WHERE last4 = ? AND merged_into IS NULL AND (? IS NULL OR bank = ?) ORDER BY kind = 'card' DESC LIMIT 1", b.last4, bank, bank)
    : null;
  await db.runAsync(
    'INSERT OR IGNORE INTO bills (account_id, bank, last4, amount_paise, due_ts, msg_hash, status, created_ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    acct?.id ?? null, bank, b.last4, b.amountPaise, b.dueTs, hashMessage(m.ts, m.text), 'open', m.ts,
  );
  return true;
}

/** One time: bills that were filed under Unrecognised before bills were understood move to the bills list. */
export async function backfillBills(db: SQLiteDatabase): Promise<number> {
  if ((await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'bills_v1'"))?.value === '1') return 0;
  const rows = await db.getAllAsync<{ id: number; sender: string; text: string; ts: number }>('SELECT id, sender, text, ts FROM unparsed');
  let n = 0;
  for (const r of rows) if (await recordBill(db, r)) { await db.runAsync('DELETE FROM unparsed WHERE id = ?', r.id); n++; }
  await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('bills_v1', '1')");
  return n;
}

/**
 * Closes bills that no longer need attention: paid (money arrived on that card after the notice), or long past due.
 * Run before listing so Home never shows a bill you already paid.
 */
export async function settleBills(db: SQLiteDatabase, now = Date.now()) {
  await db.runAsync(
    `UPDATE bills SET status = 'paid' WHERE status = 'open' AND account_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM transactions t WHERE t.account_id = bills.account_id AND t.direction = 'credit' AND t.ts >= bills.created_ts AND t.status != 'dismissed')`,
  );
  await db.runAsync("UPDATE bills SET status = 'expired' WHERE status = 'open' AND due_ts < ?", now - 10 * 864e5);
}

/** Unpaid bills, soonest first. Only the newest notice per card counts (a new statement replaces the last). */
export async function openBills(db: SQLiteDatabase, now = Date.now()): Promise<Bill[]> {
  await settleBills(db, now);
  const rows = await db.getAllAsync<Bill>(
    `SELECT b.*, a.name AS accountName FROM bills b LEFT JOIN accounts a ON a.id = b.account_id
     WHERE b.status = 'open' ORDER BY b.created_ts DESC`,
  );
  const seen = new Set<string>();
  const out: Bill[] = [];
  for (const r of rows) {
    const key = `${r.account_id ?? r.bank}|${r.last4}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out.sort((a, b) => a.due_ts - b.due_ts);
}

export const markBillPaid = (db: SQLiteDatabase, id: number) => db.runAsync("UPDATE bills SET status = 'paid' WHERE id = ?", id);
export const reopenBill = (db: SQLiteDatabase, id: number) => db.runAsync("UPDATE bills SET status = 'open' WHERE id = ?", id);
