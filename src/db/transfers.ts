import type { SQLiteDatabase } from 'expo-sqlite';

import { REASON, type TxnLite, WINDOW, classifyAlone, findCardBillPartner, findOwnTransferPartner } from '@/utils/transfers';

const SELECT = `SELECT t.id, t.merchant_id, t.amount_paise, t.direction, t.ts, t.account_id, a.kind AS account_kind, t.payment_mode AS mode, t.merchant, t.raw_text,
                       t.is_transfer, t.transfer_blocked AS blocked, t.transfer_reason AS reason, t.transfer_pair_id AS pair_id
                FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id`;

const load = (db: SQLiteDatabase, id: number) => db.getFirstAsync<TxnLite>(`${SELECT} WHERE t.id = ? AND t.status != 'dismissed'`, id);

/** Candidates are bounded by amount and time in SQL (uses idx_txn_dedup), then judged by the pure rules. */
const around = (db: SQLiteDatabase, t: TxnLite, window: number) =>
  db.getAllAsync<TxnLite>(`${SELECT} WHERE t.amount_paise = ? AND t.ts BETWEEN ? AND ? AND t.id != ? AND t.status != 'dismissed'`, t.amount_paise, t.ts - window, t.ts + window, t.id);

async function mark(db: SQLiteDatabase, id: number, reason: string, pairId: number | null) {
  await db.runAsync('UPDATE transactions SET is_transfer = 1, transfer_auto = 1, transfer_reason = ?, transfer_pair_id = ?, synced_at = NULL WHERE id = ?', reason, pairId, id);
}

/** Flags transfers among the given transactions. Returns how many transactions were newly marked. */
export async function detectTransfers(db: SQLiteDatabase, ids: number[]): Promise<number> {
  let marked = 0;
  for (const id of ids) {
    const t = await load(db, id);
    if (!t || t.is_transfer || t.blocked) continue;

    // the user said this merchant is always a transfer (e.g. their own card issuer or another account of theirs)
    if (t.merchant_id && (await db.getFirstAsync('SELECT 1 FROM transfer_merchants WHERE merchant_id = ?', t.merchant_id))) {
      await mark(db, t.id, REASON.rule, null);
      await db.runAsync('UPDATE transactions SET transfer_auto = 0 WHERE id = ?', t.id); // the user's own rule is not a surprise to surface
      marked++;
      continue;
    }
    const alone = classifyAlone(t);
    if (alone) {
      // find the other leg so the pair is linked and the funding debit is excluded too
      const partner = alone === REASON.cardReceived ? findCardBillPartner(t, await around(db, t, WINDOW.cardBill)) : null;
      await mark(db, t.id, alone, partner?.id ?? null);
      marked++;
      if (partner) { await mark(db, partner.id, REASON.cardBill, t.id); marked++; }
      continue;
    }
    // a bank debit whose card-side payment credit was seen earlier
    if (t.direction === 'debit' && t.account_kind !== 'card') {
      const card = findCardBillPartner(t, await around(db, t, WINDOW.cardBill));
      if (card) {
        await mark(db, t.id, REASON.cardBill, card.id);
        await db.runAsync('UPDATE transactions SET transfer_pair_id = ? WHERE id = ?', t.id, card.id);
        marked++;
        continue;
      }
    }
    const own = findOwnTransferPartner(t, await around(db, t, WINDOW.neft));
    if (own) {
      await mark(db, t.id, REASON.own, own.id);
      await mark(db, own.id, REASON.own, t.id);
      marked += 2;
    }
  }
  return marked;
}

/** "Not a transfer": clears the flag on both legs and stops the detector from flagging them again. */
export async function rejectTransfer(db: SQLiteDatabase, id: number) {
  const row = await db.getFirstAsync<{ transfer_pair_id: number | null }>('SELECT transfer_pair_id FROM transactions WHERE id = ?', id);
  for (const x of [id, row?.transfer_pair_id].filter((v): v is number => v != null)) {
    await db.runAsync('UPDATE transactions SET is_transfer = 0, transfer_auto = 0, transfer_reason = NULL, transfer_pair_id = NULL, transfer_blocked = 1, synced_at = NULL WHERE id = ?', x);
  }
}

/** The user marks it themselves; not an auto-detection, so it never shows in "detected" notices. */
export const markTransferByUser = (db: SQLiteDatabase, id: number) =>
  db.runAsync('UPDATE transactions SET is_transfer = 1, transfer_auto = 0, transfer_reason = ?, transfer_blocked = 0, synced_at = NULL WHERE id = ?', REASON.user, id);

export const countAutoTransfers = async (db: SQLiteDatabase) =>
  (await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM transactions WHERE transfer_auto = 1 AND status != 'dismissed'"))?.n ?? 0;

/** "Looks right": keep them as transfers but stop surfacing them as new. */
export const acknowledgeAutoTransfers = (db: SQLiteDatabase) => db.runAsync('UPDATE transactions SET transfer_auto = 0 WHERE transfer_auto = 1');

/** Once, over existing history (oldest first so each leg finds the earlier one). */
export async function backfillTransfers(db: SQLiteDatabase) {
  if (await db.getFirstAsync("SELECT 1 FROM settings WHERE key = 'transfers_backfilled_v1'")) return 0;
  let n = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ids = (await tx.getAllAsync<{ id: number }>("SELECT id FROM transactions WHERE status != 'dismissed' AND is_transfer = 0 ORDER BY ts ASC")).map((r) => r.id);
    n = await detectTransfers(tx, ids);
    await tx.runAsync("INSERT INTO settings (key, value) VALUES ('transfers_backfilled_v1', '1')");
  });
  return n;
}

export const isTransferMerchant = async (db: SQLiteDatabase, merchantId: number) => !!(await db.getFirstAsync('SELECT 1 FROM transfer_merchants WHERE merchant_id = ?', merchantId));

/**
 * "Always treat this merchant as a transfer": remembers it, and marks that merchant's existing transactions.
 * Returns an undo. Turning it off un-marks only the rows this rule marked.
 */
export async function setTransferMerchant(db: SQLiteDatabase, merchantId: number, on: boolean) {
  if (on) {
    await db.runAsync('INSERT OR IGNORE INTO transfer_merchants (merchant_id) VALUES (?)', merchantId);
    const rows = await db.getAllAsync<{ id: number }>("SELECT id FROM transactions WHERE merchant_id = ? AND status != 'dismissed' AND is_transfer = 0 AND transfer_blocked = 0", merchantId);
    for (const r of rows) {
      await db.runAsync('UPDATE transactions SET is_transfer = 1, transfer_auto = 0, transfer_reason = ?, synced_at = NULL WHERE id = ?', REASON.rule, r.id);
    }
    return { n: rows.length, undo: async () => { for (const r of rows) await db.runAsync('UPDATE transactions SET is_transfer = 0, transfer_reason = NULL, synced_at = NULL WHERE id = ? AND transfer_reason = ?', r.id, REASON.rule); await db.runAsync('DELETE FROM transfer_merchants WHERE merchant_id = ?', merchantId); } };
  }
  await db.runAsync('DELETE FROM transfer_merchants WHERE merchant_id = ?', merchantId);
  const rows = await db.getAllAsync<{ id: number }>('SELECT id FROM transactions WHERE merchant_id = ? AND transfer_reason = ?', merchantId, REASON.rule);
  for (const r of rows) await db.runAsync('UPDATE transactions SET is_transfer = 0, transfer_reason = NULL, synced_at = NULL WHERE id = ?', r.id);
  return { n: rows.length, undo: async () => { await setTransferMerchant(db, merchantId, true); } };
}
