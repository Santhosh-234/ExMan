// Compares a parsed bank statement with the transactions ExMan has for the same account.
// Every statement line ends up as matched, differing in amount, or missing from ExMan; ExMan transactions the statement doesn't show are "extra".
import { type StmtLine, dayOfTs } from './statement';

export type ExTxn = {
  id: number;
  ts: number;
  direction: 'debit' | 'credit';
  amount_paise: number;
  /** the original bank message or narration, searched for the statement's reference number */
  raw_text: string | null;
  balance_paise?: number | null;
  merchant?: string | null;
};

export type Matched = { line: StmtLine; txn: ExTxn; how: 'ref' | 'amount' };
export type Differs = { line: StmtLine; txn: ExTxn };
export type Missing = { line: StmtLine; /** the same reference is on a transaction of another account: this is one side of a transfer between your own accounts */ partner: ExTxn | null };

export type Reconciliation = {
  matched: Matched[];
  differs: Differs[];
  missing: Missing[];
  /** ExMan has them, the statement doesn't (duplicates, or wrongly read) */
  extra: ExTxn[];
  /** too close to the end of the statement to expect them on it yet */
  edge: ExTxn[];
};

const DAY = 864e5;
const refsIn = (t: string | null) => (t ? [...new Set(t.match(/(?<!\d)\d{12}(?!\d)/g) ?? [])] : []);
const dayNum = (key: string) => { const [y, m, d] = key.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); };
const tsDay = (ts: number) => dayNum(dayOfTs(ts));
const TOLERANCE_DAYS = 2;

export function reconcile(lines: StmtLine[], mine: ExTxn[], from: string, to: string, others: ExTxn[] = []): Reconciliation {
  const usedLine = new Set<number>();
  const usedTxn = new Set<number>();
  const matched: Matched[] = [];
  const differs: Differs[] = [];

  // 1. the reference number is the strongest evidence: it identifies the payment whatever day each side recorded it
  const byRef = new Map<string, ExTxn[]>();
  for (const t of mine) for (const r of refsIn(t.raw_text)) (byRef.get(r) ?? byRef.set(r, []).get(r)!).push(t);
  for (const l of lines) {
    if (!l.ref) continue;
    const c = (byRef.get(l.ref) ?? []).filter((t) => !usedTxn.has(t.id) && t.direction === l.direction);
    if (!c.length) continue;
    const exact = c.find((t) => t.amount_paise === l.paise);
    const t = exact ?? c[0];
    usedLine.add(l.seq); usedTxn.add(t.id);
    if (exact) matched.push({ line: l, txn: t, how: 'ref' });
    else differs.push({ line: l, txn: t });
  }

  // 2. same direction and amount within a couple of days; closest day first so a near match is never stolen by a far one
  for (let tol = 0; tol <= TOLERANCE_DAYS; tol++) {
    for (const l of lines) {
      if (usedLine.has(l.seq)) continue;
      const ld = dayNum(l.day);
      let best: ExTxn | null = null;
      let bestGap = Infinity;
      for (const t of mine) {
        if (usedTxn.has(t.id) || t.direction !== l.direction || t.amount_paise !== l.paise) continue;
        const gap = Math.abs(tsDay(t.ts) - ld);
        if (gap > tol) continue;
        const off = Math.abs(t.ts - l.ts);
        if (gap < bestGap || (gap === bestGap && best && off < Math.abs(best.ts - l.ts))) { best = t; bestGap = gap; }
      }
      if (best) { usedLine.add(l.seq); usedTxn.add(best.id); matched.push({ line: l, txn: best, how: 'amount' }); }
    }
  }

  // 3. a lone leftover on each side, same day and direction, amounts close: the same payment recorded with a different amount
  const left = lines.filter((l) => !usedLine.has(l.seq));
  for (const l of left) {
    const pool = mine.filter((t) => !usedTxn.has(t.id) && t.direction === l.direction && Math.abs(tsDay(t.ts) - dayNum(l.day)) <= 1);
    const rivals = left.filter((o) => o.direction === l.direction && Math.abs(dayNum(o.day) - dayNum(l.day)) <= 1);
    if (pool.length === 1 && rivals.length === 1 && Math.abs(pool[0].amount_paise - l.paise) <= Math.max(l.paise * 0.15, 100)) {
      usedLine.add(l.seq); usedTxn.add(pool[0].id); differs.push({ line: l, txn: pool[0] });
    }
  }

  const otherRef = new Map<string, ExTxn>();
  for (const t of others) for (const r of refsIn(t.raw_text)) if (!otherRef.has(r)) otherRef.set(r, t);
  const missing: Missing[] = lines.filter((l) => !usedLine.has(l.seq)).map((l) => ({ line: l, partner: (l.ref && otherRef.get(l.ref)) || null }));

  const a = dayNum(from);
  const b = dayNum(to);
  const extra: ExTxn[] = [];
  const edge: ExTxn[] = [];
  for (const t of mine) {
    if (usedTxn.has(t.id)) continue;
    const d = tsDay(t.ts);
    if (d < a || d > b) continue;
    (d > b - TOLERANCE_DAYS ? edge : extra).push(t);
  }
  matched.sort((x, y) => x.line.seq - y.line.seq);
  return { matched, differs, missing, extra, edge };
}
