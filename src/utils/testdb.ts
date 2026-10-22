// Shared helper for integration tests: an expo-sqlite shaped adapter over node:sqlite, fully migrated.
import { DatabaseSync } from 'node:sqlite';

import { migrate } from '../db/schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TestDb = any;

export async function makeDb(): Promise<{ db: TestDb; raw: DatabaseSync }> {
  const raw = new DatabaseSync(':memory:');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    execAsync: async (s: string) => raw.exec(s),
    getFirstAsync: async (s: string, ...p: unknown[]) => (s.includes('user_version') ? { user_version: 0 } : raw.prepare(s).get(...(p as never[]))),
    getAllAsync: async (s: string, ...p: unknown[]) => raw.prepare(s).all(...(p as never[])).map((r) => ({ ...r })),
    runAsync: async (s: string, ...p: unknown[]) => { const r = raw.prepare(s).run(...(p as never[])); return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) }; },
    withExclusiveTransactionAsync: async (fn: (tx: unknown) => Promise<void>) => fn(db),
    withTransactionAsync: async (fn: () => Promise<void>) => fn(),
  };
  await migrate(db);
  return { db, raw };
}
