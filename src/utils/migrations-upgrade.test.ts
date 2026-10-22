// A phone that has been running an old build keeps its data when the app upgrades: replay every old schema version with a row in it,
// migrate to the latest, and check nothing was lost and the result matches a fresh install.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { MIGRATIONS, migrate } from '../db/schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function adapter(raw: DatabaseSync): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    execAsync: async (s: string) => raw.exec(s),
    getFirstAsync: async (s: string, ...p: unknown[]) => raw.prepare(s).get(...(p as never[])),
    getAllAsync: async (s: string, ...p: unknown[]) => raw.prepare(s).all(...(p as never[])).map((r) => ({ ...r })),
    runAsync: async (s: string, ...p: unknown[]) => { const r = raw.prepare(s).run(...(p as never[])); return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) }; },
    withExclusiveTransactionAsync: async (fn: (tx: unknown) => Promise<void>) => fn(db),
  };
  return db;
}

const schemaOf = (raw: DatabaseSync) => (raw.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all() as { type: string; name: string; sql: string | null }[])
  .map((r) => `${r.type}:${r.name}`).join('\n');
const columns = (raw: DatabaseSync, t: string) => (raw.prepare(`PRAGMA table_info(${t})`).all() as { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }[]);

/** Inserts one plausible row into a table using only the columns that exist in that version. */
function seedRow(raw: DatabaseSync, table: string, overrides: Record<string, unknown>) {
  const cols = columns(raw, table).filter((c) => !c.pk || c.name in overrides);
  const vals: Record<string, unknown> = {};
  for (const c of cols) {
    if (c.name in overrides) vals[c.name] = overrides[c.name];
    else if (c.notnull && c.dflt_value == null) vals[c.name] = /INT|REAL/i.test(c.type) ? 1 : 'x';
  }
  const names = Object.keys(vals);
  raw.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...(Object.values(vals) as never[]));
}

for (let from = 1; from < MIGRATIONS.length; from++) {
  test(`upgrading from schema v${from} keeps the data and ends up identical to a fresh install`, async () => {
    const raw = new DatabaseSync(':memory:');
    for (let v = 0; v < from; v++) raw.exec(MIGRATIONS[v]);
    raw.exec(`PRAGMA user_version = ${from}`);
    const hasTxn = columns(raw, 'transactions').length > 0;
    if (hasTxn) {
      seedRow(raw, 'transactions', { amount_paise: 123400, direction: 'debit', ts: 1_760_000_000_000, source: 'sms', raw_text: 'Rs 1234 spent at SHOP', merchant: 'Shop', status: 'confirmed' });
      seedRow(raw, 'transactions', { amount_paise: 5000, direction: 'credit', ts: 1_760_000_100_000, source: 'sms', raw_text: 'Rs 50 credited', status: 'pending' });
    }
    const before = hasTxn ? (raw.prepare('SELECT amount_paise, direction, merchant, status FROM transactions ORDER BY ts').all().map((r) => ({ ...r }))) : [];

    await migrate(adapter(raw));

    const after = raw.prepare('SELECT amount_paise, direction, merchant, status FROM transactions ORDER BY ts').all().map((r) => ({ ...r }));
    for (const b of before) assert.ok(after.some((a) => JSON.stringify(a) === JSON.stringify(b)), `row lost or changed: ${JSON.stringify(b)} (v${from})`);
    assert.equal((raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, MIGRATIONS.length);
    assert.deepEqual(raw.prepare('PRAGMA integrity_check').all().map((r) => ({ ...r })), [{ integrity_check: 'ok' }]);

    const fresh = new DatabaseSync(':memory:');
    await migrate(adapter(fresh));
    assert.equal(schemaOf(raw), schemaOf(fresh), 'tables and indexes must match a fresh install');
    for (const t of ['transactions', 'accounts', 'categories', 'budgets', 'settings'])
      assert.deepEqual(columns(raw, t).map((c) => c.name).sort(), columns(fresh, t).map((c) => c.name).sort(), `${t} columns`);
  });
}
