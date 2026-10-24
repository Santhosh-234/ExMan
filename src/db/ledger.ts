import type { SQLiteDatabase } from 'expo-sqlite';

import { type Gap, checkableShare, findGaps } from '@/utils/ledger';

export type AccountGap = Gap & { accountName: string };
export type AccountHealth = { id: number; name: string; checkable: number; txns: number; gaps: number; balance: number | null };

type Row = { id: number; account_id: number; ts: number; direction: 'debit' | 'credit'; amount_paise: number; balance_paise: number | null; currency: string | null };

async function load(db: SQLiteDatabase, since: number) {
  const accounts = await db.getAllAsync<{ id: number; name: string }>("SELECT id, name FROM accounts WHERE kind != 'cash' AND merged_into IS NULL AND archived = 0");
  const rows = await db.getAllAsync<Row>(
    `SELECT id, account_id, ts, direction, amount_paise, balance_paise, currency FROM transactions
     WHERE account_id IS NOT NULL AND status != 'dismissed' AND ts >= ? ORDER BY ts, id`,
    since,
  );
  const by = new Map<number, Row[]>();
  for (const r of rows) (by.get(r.account_id) ?? by.set(r.account_id, []).get(r.account_id)!).push(r);
  const ignored = new Set((await db.getAllAsync<{ txn_id: number }>('SELECT txn_id FROM ledger_ignored')).map((r) => r.txn_id));
  return { accounts, by, ignored };
}

const toLedger = (rows: Row[]) => rows.map((r) => ({ id: r.id, ts: r.ts, direction: r.direction, amount_paise: r.amount_paise, balance_paise: r.balance_paise, approx: !!r.currency }));

/** Unexplained money movements per account over the last `days`, newest first, minus the ones the user chose to ignore. */
export async function ledgerGaps(db: SQLiteDatabase, days = 120, now = Date.now()): Promise<AccountGap[]> {
  const { accounts, by, ignored } = await load(db, now - days * 864e5);
  const out: AccountGap[] = [];
  for (const a of accounts) {
    for (const g of findGaps(a.id, toLedger(by.get(a.id) ?? []))) if (!ignored.has(g.toId)) out.push({ ...g, accountName: a.name });
  }
  return out.sort((a, b) => b.toTs - a.toTs);
}

export async function ledgerHealth(db: SQLiteDatabase, days = 120, now = Date.now()): Promise<AccountHealth[]> {
  const { accounts, by, ignored } = await load(db, now - days * 864e5);
  const out: AccountHealth[] = [];
  for (const a of accounts) {
    const rows = by.get(a.id) ?? [];
    if (!rows.length) continue;
    const gaps = findGaps(a.id, toLedger(rows)).filter((g) => !ignored.has(g.toId)).length;
    const withBal = rows.filter((r) => r.balance_paise != null);
    out.push({ id: a.id, name: a.name, checkable: checkableShare(rows), txns: rows.length, gaps, balance: withBal.length ? withBal[withBal.length - 1].balance_paise : null });
  }
  return out;
}

export const ignoreGap = (db: SQLiteDatabase, toId: number) => db.runAsync('INSERT OR IGNORE INTO ledger_ignored (txn_id) VALUES (?)', toId);
export const unignoreGap = (db: SQLiteDatabase, toId: number) => db.runAsync('DELETE FROM ledger_ignored WHERE txn_id = ?', toId);
