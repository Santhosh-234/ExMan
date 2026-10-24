import type { SQLiteDatabase } from 'expo-sqlite';

import { type SyncResult, syncFormats } from '@/db/formats';
import { notifyIngested } from './events';
import { reprocessDetailed } from './core';

/** Fetches the format library (at most daily) and, when it changed, re-reads the messages that were previously unreadable with it. */
export async function refreshFormats(db: SQLiteDatabase, opts: { force?: boolean; fetchFn?: typeof fetch; url?: string; now?: number } = {}): Promise<SyncResult & { added: number }> {
  const r = await syncFormats(db, opts);
  let added = 0;
  if (r.status === 'updated') {
    added = (await reprocessDetailed(db)).added;
    notifyIngested();
  }
  return { ...r, added };
}
