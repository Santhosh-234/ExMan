// The self-checking ledger. Most bank messages quote the balance after the transaction, so the balances of one account form a chain
// that must add up: each balance equals the previous balance plus the transactions in between. When it does not, money moved that ExMan
// never saw (a lost message, an amount read wrongly, a charge with no alert). That difference is a "gap".

export type LedgerTxn = {
  id: number;
  ts: number;
  direction: 'debit' | 'credit';
  amount_paise: number;
  balance_paise: number | null;
  /** converted from a foreign currency: the bank's own rate differs a little, so small differences are not gaps */
  approx?: boolean;
};

export type Gap = {
  accountId: number;
  fromId: number; // the earlier balance the chain starts from
  toId: number; // the transaction whose balance does not add up (a gap is identified by this)
  fromTs: number;
  toTs: number;
  /** signed: negative = money left that ExMan has no record of, positive = money arrived unrecorded */
  amountPaise: number;
};

const signed = (t: LedgerTxn) => (t.direction === 'credit' ? t.amount_paise : -t.amount_paise);
const TOLERANCE = 100; // one rupee: rounding in the bank's own figures
const REORDER_WINDOW = 15 * 60_000; // messages can arrive out of order within a few minutes

function chain(accountId: number, sorted: LedgerTxn[]): Gap[] {
  const gaps: Gap[] = [];
  let anchor: LedgerTxn | null = null;
  let explained = 0; // net effect of everything after the anchor, up to and including the current transaction
  let approxSum = 0;
  for (const t of sorted) {
    explained += signed(t);
    if (t.approx) approxSum += t.amount_paise;
    if (t.balance_paise == null) continue;
    if (anchor) {
      const gap = t.balance_paise - anchor.balance_paise! - explained;
      const slack = TOLERANCE + Math.round(approxSum * 0.05);
      if (Math.abs(gap) > slack) gaps.push({ accountId, fromId: anchor.id, toId: t.id, fromTs: anchor.ts, toTs: t.ts, amountPaise: gap });
    }
    anchor = t;
    explained = 0;
    approxSum = 0;
  }
  return gaps;
}

export function findGaps(accountId: number, txns: LedgerTxn[]): Gap[] {
  const sorted = [...txns].sort((a, b) => a.ts - b.ts || a.id - b.id);
  let gaps = chain(accountId, sorted);
  // Messages sometimes arrive out of order. If swapping two neighbours that are minutes apart makes the chain add up, that is all it was.
  for (let pass = 0; pass < 3 && gaps.length; pass++) {
    let changed = false;
    for (const g of gaps) {
      const k = sorted.findIndex((t) => t.id === g.toId);
      for (const j of [k - 1, k]) {
        if (j < 0 || j + 1 >= sorted.length || sorted[j + 1].ts - sorted[j].ts > REORDER_WINDOW) continue;
        const swapped = [...sorted];
        [swapped[j], swapped[j + 1]] = [swapped[j + 1], swapped[j]];
        const better = chain(accountId, swapped);
        if (better.length < gaps.length) { sorted.splice(0, sorted.length, ...swapped); gaps = better; changed = true; break; }
      }
      if (changed) break;
    }
    if (!changed) break;
  }
  return gaps;
}

/** Share of an account's transactions that carry a balance: how much of the chain can be checked at all. */
export function checkableShare(txns: Pick<LedgerTxn, 'balance_paise'>[]): number {
  return txns.length ? txns.filter((t) => t.balance_paise != null).length / txns.length : 0;
}
