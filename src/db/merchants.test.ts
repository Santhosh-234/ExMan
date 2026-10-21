import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { ensureMerchant } from './merchantCore';
import { applyRuleToExisting, getMerchantRule, loadRuleIndex, mergeMerchant, setMerchantRule } from './merchants';
import { migrate } from './schema';

// Minimal expo-sqlite-shaped adapter over node:sqlite so migrations and queries run for real.
function makeDb() {
  const raw = new DatabaseSync(':memory:');
  const db: any = {
    execAsync: async (s: string) => raw.exec(s),
    getFirstAsync: async (s: string, ...p: any[]) => (s.includes('user_version') ? { user_version: 0 } : raw.prepare(s).get(...p)),
    getAllAsync: async (s: string, ...p: any[]) => raw.prepare(s).all(...p),
    runAsync: async (s: string, ...p: any[]) => { const r = raw.prepare(s).run(...p); return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes }; },
    withExclusiveTransactionAsync: async (fn: any) => fn(db),
  };
  return { raw, db };
}

test('merchants: spellings share one row, rules upsert, apply, merge keeps alias', async () => {
  const { raw, db } = makeDb();
  await migrate(db);

  const a = (await ensureMerchant(db, 'SWIGGY'))!;
  const b = (await ensureMerchant(db, 'swiggy@icici'))!;
  assert.equal(a.id, b.id);
  assert.equal(a.name, 'Swiggy');

  await setMerchantRule(db, a.id, 1);
  await setMerchantRule(db, a.id, 2);
  assert.equal((await getMerchantRule(db, a.id))!.category_id, 2);
  assert.equal((raw.prepare('select count(*) c from rules').get() as any).c, 1);
  const idx = await loadRuleIndex(db);
  assert.equal(idx.categoryFor(a.id, null), 2);
  assert.equal(idx.categoryFor(null, null), null);

  for (let i = 0; i < 3; i++)
    raw.prepare("insert into transactions (amount_paise,direction,source,ts,status,merchant,merchant_id,category_id) values (100,'debit','sms',?,'confirmed','Swiggy',?,5)").run(i + 1, a.id);
  const r = await applyRuleToExisting(db, { merchantId: a.id, categoryId: 2 });
  assert.equal(r.n, 3);
  assert.equal((raw.prepare('select count(*) c from transactions where category_id = 2').get() as any).c, 3);
  await r.undo();
  assert.equal((raw.prepare('select count(*) c from transactions where category_id = 5').get() as any).c, 3);

  const chai = (await ensureMerchant(db, 'Chai Point'))!;
  await mergeMerchant(db, chai.id, a.id);
  assert.equal((await ensureMerchant(db, 'chai point'))!.id, a.id);
});

test('migrations: dismissed status and unique message hash', async () => {
  const { raw, db } = makeDb();
  await migrate(db);
  raw.exec("insert into transactions (amount_paise,direction,source,ts,status,msg_hash) values (1,'debit','manual',1,'dismissed','h')");
  assert.throws(() => raw.exec("insert into transactions (amount_paise,direction,source,ts,msg_hash) values (1,'debit','sms',1,'h')"));
});
