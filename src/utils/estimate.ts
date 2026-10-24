// Some banks never quote a balance in their messages. If the user tells ExMan the balance once (the "anchor"), every transaction before
// and after it moves the balance, so it can be estimated for any moment. The estimate is only as good as the transactions ExMan has seen,
// which is exactly what re-entering the balance later checks.
import type { BalancePoint } from './networth';

export type Anchor = { paise: number; ts: number };
export type Flow = { id: number; ts: number; direction: 'debit' | 'credit'; amount_paise: number };

const signed = (f: Flow) => (f.direction === 'credit' ? f.amount_paise : -f.amount_paise);
const byTime = (a: Flow, b: Flow) => a.ts - b.ts || a.id - b.id;

/** The balance after each transaction, consistent with the anchor (also for transactions before it). */
export function runningBalances(anchor: Anchor, flows: Flow[]): BalancePoint[] {
  const sorted = [...flows].sort(byTime);
  let cum = 0, atAnchor = 0;
  const cums = sorted.map((f) => { cum += signed(f); if (f.ts <= anchor.ts) atAnchor = cum; return cum; });
  return sorted.map((f, i) => ({ ts: f.ts, paise: anchor.paise + cums[i] - atAnchor }));
}

/** What the balance should be now: the anchor plus everything that happened after it. */
export function estimateNow(anchor: Anchor, flows: Flow[]): number {
  return anchor.paise + flows.filter((f) => f.ts > anchor.ts).reduce((s, f) => s + signed(f), 0);
}

/** How far a newly entered balance is from the estimate. Negative: less money than ExMan thinks, so spending is missing. */
export function difference(entered: number, estimated: number) { return entered - estimated; }
