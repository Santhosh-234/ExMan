import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { loadPatternIndex, savePattern } from '../db/patterns';
import { migrate } from '../db/schema';
import { buildPattern, tokenize } from './teach';

test('taught pattern is stored per sender key and matches later messages', async () => {
  const raw = new DatabaseSync(':memory:');
  const db: any = {
    execAsync: async (s: string) => raw.exec(s),
    getFirstAsync: async (s: string, ...p: any[]) => (s.includes('user_version') ? { user_version: 0 } : raw.prepare(s).get(...p)),
    getAllAsync: async (s: string, ...p: any[]) => raw.prepare(s).all(...p),
    runAsync: async (s: string, ...p: any[]) => { const r = raw.prepare(s).run(...p); return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes }; },
    withExclusiveTransactionAsync: async (fn: any) => fn(db),
  };
  await migrate(db);

  const text = 'ALERT: 450.50 INR gone from acct 1234 for SWIGGY ORDER on 20Oct';
  const toks = tokenize(text);
  const at = (w: string) => toks.findIndex((t) => t.text === w);
  const r = buildPattern(text, { amount: [at('450.50'), at('450.50')], account: [at('1234'), at('1234')] }, 'debit');
  assert.ok(r.ok);
  if (!r.ok) return;
  await savePattern(db, 'VM-NEWBNK-S', r.pattern, text);

  const idx = await loadPatternIndex(db);
  // same bank, different DLT prefix/suffix still matches
  assert.equal(idx.match('AD-NEWBNK-T', 'ALERT: 99 INR gone from acct 5555 for X')?.amountPaise, 9900);
  assert.equal(idx.match('VM-OTHERB-S', 'ALERT: 99 INR gone from acct 5555 for X'), null);
  assert.equal(idx.match('VM-NEWBNK-S', 'hello there'), null);
  await idx.flush(db);
  assert.equal((raw.prepare('select hits from patterns').get() as any).hits, 1);
});
