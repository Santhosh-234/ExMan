import type { SQLiteDatabase } from 'expo-sqlite';

import { SCHEMA_VERSION } from '@/db/schema';
import { type RandomBytes, decryptBytes, encryptBytes, utf8Decode, utf8Encode } from './crypto';

// Parents before children so a restore can insert in this order. telemetry_events is deliberately not backed up.
const TABLES = ['categories', 'accounts', 'merchants', 'transactions', 'budgets', 'settings', 'rules', 'patterns', 'unparsed', 'edit_log', 'transfer_merchants'] as const;
// settings that belong to this installation, not to the user's data: kept as-is on restore, never exported
const DEVICE_SETTINGS = ['telemetry_install_id', 'telemetry_notice_seen', 'onboarded'];

type Cell = string | number | null;
export type Dump = { format: 1; schema: number; created: number; tables: Record<string, { columns: string[]; rows: Cell[][] }> };

export async function dumpAll(db: SQLiteDatabase): Promise<Dump> {
  const tables: Dump['tables'] = {};
  for (const t of TABLES) {
    const where = t === 'settings' ? ` WHERE key NOT IN (${DEVICE_SETTINGS.map((k) => `'${k}'`).join(',')})` : '';
    const rows = await db.getAllAsync<Record<string, Cell>>(`SELECT * FROM ${t}${where}`);
    const columns = rows.length ? Object.keys(rows[0]) : (await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${t})`)).map((c) => c.name);
    tables[t] = { columns, rows: rows.map((r) => columns.map((c) => r[c])) };
  }
  return { format: 1, schema: SCHEMA_VERSION, created: Date.now(), tables };
}

export function validateDump(d: unknown): asserts d is Dump {
  const x = d as Dump;
  if (!x || x.format !== 1 || typeof x.schema !== 'number' || !x.tables) throw new Error('Not a valid ExMan backup');
  if (x.schema > SCHEMA_VERSION) throw new Error('This backup is from a newer version of ExMan. Update the app and try again.');
  for (const t of TABLES) if (!x.tables[t] || !Array.isArray(x.tables[t].columns) || !Array.isArray(x.tables[t].rows)) throw new Error(`Backup is missing "${t}"`);
}

/** Replaces all current data with the backup. Unknown columns in the file are ignored; missing ones take defaults. */
export async function restoreAll(db: SQLiteDatabase, d: Dump): Promise<{ transactions: number }> {
  validateDump(d);
  await db.execAsync('PRAGMA foreign_keys = OFF');
  try {
    await db.withExclusiveTransactionAsync(async (tx) => {
      const have = new Map<string, Set<string>>();
      for (const t of TABLES) have.set(t, new Set((await tx.getAllAsync<{ name: string }>(`PRAGMA table_info(${t})`)).map((c) => c.name)));
      for (const t of [...TABLES].reverse()) {
        if (t === 'settings') await tx.runAsync(`DELETE FROM settings WHERE key NOT IN (${DEVICE_SETTINGS.map((k) => `'${k}'`).join(',')})`);
        else await tx.runAsync(`DELETE FROM ${t}`);
      }
      for (const t of TABLES) {
        const { columns, rows } = d.tables[t];
        const idx = columns.map((c, i) => [c, i] as const).filter(([c]) => have.get(t)!.has(c));
        if (!idx.length || !rows.length) continue;
        const sql = `INSERT OR REPLACE INTO ${t} (${idx.map(([c]) => c).join(',')}) VALUES (${idx.map(() => '?').join(',')})`;
        for (const row of rows) await tx.runAsync(sql, ...idx.map(([, i]) => row[i]));
      }
    });
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON');
  }
  return { transactions: d.tables.transactions.rows.length };
}

export async function makeBackup(db: SQLiteDatabase, password: string, random: RandomBytes) {
  return encryptBytes(utf8Encode(JSON.stringify(await dumpAll(db))), password, random);
}

export async function readBackup(file: Uint8Array, password: string): Promise<Dump> {
  const d = JSON.parse(utf8Decode(await decryptBytes(file, password)));
  validateDump(d);
  return d;
}
