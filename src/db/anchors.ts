import type { SQLiteDatabase } from 'expo-sqlite';

import { type Flow, estimateNow } from '@/utils/estimate';

export type Effective = {
  paise: number;
  /** when the figure it rests on was true: the message that quoted it, or the day the user entered it */
  baseTs: number;
  source: 'sms' | 'entered';
  /** true when transactions since then were added to it */
  rolled: boolean;
};

type AcctRow = { balance_paise: number | null; balance_kind: string | null; balance_ts: number | null; anchor_paise: number | null; anchor_ts: number | null };

export const flowsFor = (db: SQLiteDatabase, accountId: number) =>
  db.getAllAsync<Flow>("SELECT id, ts, direction, amount_paise FROM transactions WHERE account_id = ? AND status != 'dismissed'", accountId);

/** The newest known balance (quoted in a message, or entered by the user), moved forward by everything that happened after it. */
export function effectiveOf(a: AcctRow, flows: Flow[]): Effective | null {
  const sms = a.balance_paise != null && a.balance_kind !== 'limit' && a.balance_ts != null ? { paise: a.balance_paise, ts: a.balance_ts } : null;
  const entered = a.anchor_paise != null && a.anchor_ts != null ? { paise: a.anchor_paise, ts: a.anchor_ts } : null;
  const base = sms && entered ? (entered.ts >= sms.ts ? entered : sms) : sms ?? entered;
  if (!base) return null;
  const paise = estimateNow(base, flows);
  return { paise, baseTs: base.ts, source: base === entered ? 'entered' : 'sms', rolled: paise !== base.paise };
}

export async function effectiveBalance(db: SQLiteDatabase, accountId: number): Promise<Effective | null> {
  const a = await db.getFirstAsync<AcctRow>('SELECT balance_paise, balance_kind, balance_ts, anchor_paise, anchor_ts FROM accounts WHERE id = ?', accountId);
  return a ? effectiveOf(a, await flowsFor(db, accountId)) : null;
}

/**
 * The user read their balance off their bank app. Stores it as the new starting point and reports how far it was from what ExMan expected:
 * a negative difference means money left that ExMan did not see.
 */
export async function setAnchor(db: SQLiteDatabase, accountId: number, paise: number, now = Date.now()) {
  const before = await effectiveBalance(db, accountId);
  await db.runAsync('UPDATE accounts SET anchor_paise = ?, anchor_ts = ? WHERE id = ?', paise, now, accountId);
  return before ? { expected: before.paise, difference: paise - before.paise, since: before.baseTs } : { expected: null, difference: null, since: null };
}

export const clearAnchor = (db: SQLiteDatabase, accountId: number) => db.runAsync('UPDATE accounts SET anchor_paise = NULL, anchor_ts = NULL WHERE id = ?', accountId);
