import { drain, readInbox } from '../../modules/vibe-listener';
import { run } from './core';

// The ingest logic lives in ./core (pure of native modules, so it is unit-tested end to end); this file holds the two entry points that read from the phone.
export { backfillAccounts, backfillMerchants, loadRates, purgeOtpMessages, reprocessDetailed, reprocessUnparsed } from './core';

/** Drain native queue -> parse -> skip duplicates -> insert as 'pending'. Returns rows added. */
export function ingest(db: import('expo-sqlite').SQLiteDatabase): Promise<number> {
  const msgs = drain();
  return run(db, msgs, msgs.length ? Math.min(...msgs.map((m) => m.ts)) - 120_000 : 0);
}

/** One-off import of existing SMS from the last `days` days. Safe to re-run. Returns rows added. */
export function importHistory(db: import('expo-sqlite').SQLiteDatabase, days: number, onProgress?: (done: number, total: number) => void): Promise<number> {
  const since = Date.now() - days * 864e5;
  return run(db, readInbox(since), since - 120_000, onProgress);
}
