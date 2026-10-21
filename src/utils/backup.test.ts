import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { decryptBytes, encryptBytes, utf8Decode, utf8Encode } from '../backup/crypto';
import { makeBackup, readBackup, restoreAll } from '../backup/dump';
import { migrate } from '../db/schema';
import { csvCell, toCsv } from './csv';

const rnd = (n: number) => new Uint8Array(randomBytes(n));

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

test('utf8 helpers round-trip including rupee signs, emoji and Indic text', () => {
  for (const s of ['plain', '₹1,250.50', 'Chai ☕ Point', 'स्विगी', '𝄞 surrogate pair']) assert.equal(utf8Decode(utf8Encode(s)), s);
});

test('encryption round-trips; wrong password, tampering and foreign files are rejected', async () => {
  const plain = utf8Encode('{"hello":"₹ world"}');
  const file = await encryptBytes(plain, 'correct horse', rnd);
  assert.equal(utf8Decode(await decryptBytes(file, 'correct horse')), '{"hello":"₹ world"}');
  await assert.rejects(decryptBytes(file, 'wrong password'), /Wrong password/);
  const flipped = Uint8Array.from(file); flipped[flipped.length - 5] ^= 1;
  await assert.rejects(decryptBytes(flipped, 'correct horse'), /Wrong password|damaged/);
  const hdr = Uint8Array.from(file); hdr[10] ^= 1; // header is authenticated too
  await assert.rejects(decryptBytes(hdr, 'correct horse'), /Wrong password|damaged|Unsupported/);
  await assert.rejects(decryptBytes(utf8Encode('not a backup at all, definitely just text'), 'x'), /not an ExMan backup/);
  await assert.rejects(encryptBytes(plain, 'abc', rnd), /at least 6/);
  // two encryptions of the same data differ (fresh salt and nonce)
  assert.notDeepEqual(await encryptBytes(plain, 'correct horse', rnd), file);
});

test('full backup and restore brings every table back and keeps device-only settings', async () => {
  const a = makeDb();
  await migrate(a.db);
  a.raw.exec("insert into accounts (id,name,kind,bank,last4) values (20,'Axis card','card','AXIS','3333')");
  a.raw.exec("insert into merchants (id,key,name) values (5,'swiggy','Swiggy')");
  a.raw.exec("insert into categories (name,icon,color,is_custom) values ('Pets','tag','#fff',1)");
  a.raw.prepare("insert into transactions (id,amount_paise,direction,source,ts,status,merchant,merchant_id,account_id,raw_text,msg_hash,tags,currency,foreign_minor) values (1,45000,'debit','sms',1000,'confirmed','Swiggy ☕',5,20,'Rs 450 debited ₹','h1','a,b','USD',500)").run();
  a.raw.exec("insert into budgets (category_id,month,limit_paise) values (null,'2026-10',5000000)");
  a.raw.exec("insert into rules (kind,merchant_id,category_id,enabled,created_at) values ('merchant',5,1,1,1)");
  a.raw.exec("insert into settings (key,value) values ('theme','light'),('telemetry_install_id','OLD-DEVICE'),('onboarded','1')");

  const file = await makeBackup(a.db, 'secret123', rnd);
  const text = Buffer.from(file).toString('latin1');
  assert.ok(!text.includes('Swiggy') && !text.includes('Axis'), 'ciphertext must not leak content');

  const b = makeDb();
  await migrate(b.db);
  b.raw.exec("insert into settings (key,value) values ('telemetry_install_id','NEW-DEVICE'),('theme','dark')");
  b.raw.exec("insert into accounts (name,kind) values ('Stale','bank')");
  const dump = await readBackup(file, 'secret123');
  assert.deepEqual(await restoreAll(b.db, dump), { transactions: 1 });

  const q = (s: string) => b.raw.prepare(s).all() as any[];
  assert.deepEqual({ ...q("select merchant, tags, currency, foreign_minor, raw_text from transactions")[0] }, { merchant: 'Swiggy ☕', tags: 'a,b', currency: 'USD', foreign_minor: 500, raw_text: 'Rs 450 debited ₹' });
  assert.deepEqual(q('select name from accounts order by id').map((r) => r.name), ['Cash', 'Axis card']); // 'Stale' gone, Cash restored from backup
  assert.equal(q("select count(*) c from categories where name = 'Pets'")[0].c, 1);
  assert.equal(q('select count(*) c from rules')[0].c, 1);
  const s = Object.fromEntries(q('select key, value from settings').map((r) => [r.key, r.value]));
  assert.equal(s.theme, 'light'); // user preference restored
  assert.equal(s.telemetry_install_id, 'NEW-DEVICE'); // device identity untouched
  assert.equal(s.onboarded, undefined); // not exported, not invented
});

test('restore refuses files from a newer app and malformed dumps', async () => {
  const { db } = makeDb();
  await migrate(db);
  await assert.rejects(restoreAll(db, { format: 1, schema: 999, created: 1, tables: {} } as any), /newer version/);
  await assert.rejects(restoreAll(db, { format: 2 } as any), /Not a valid/);
  await assert.rejects(restoreAll(db, { format: 1, schema: 1, created: 1, tables: {} } as any), /missing/);
});

test('csv: quoting, formula neutralisation, types and original amounts', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('+91 98765'), "'+91 98765");
  assert.equal(csvCell('-450'), '-450'); // real negative numbers stay numeric
  assert.equal(csvCell(null), '');
  const base = { ts: new Date(2026, 9, 21, 9, 5).getTime(), direction: 'debit' as const, is_transfer: 0, refund_of: null, amount_paise: 114312, currency: 'USD', foreign_minor: 1299, merchant: 'OpenAI, Inc', category: 'Shopping', account: 'Axis card', bank: 'AXIS', account_last4: '3333', payment_mode: 'Card', source: 'sms', tags: 'work,ai', notes: null, status: 'confirmed', transfer_reason: null };
  const csv = toCsv([base, { ...base, direction: 'credit', is_transfer: 1, transfer_reason: 'card payment received', currency: null, foreign_minor: null, amount_paise: 500000 }]);
  const lines = csv.replace('﻿', '').trim().split('\r\n');
  assert.equal(lines[0].split(',').length, 16);
  assert.equal(lines[1], '2026-10-21,09:05,Spent,1143.12,USD 12.99,"OpenAI, Inc",Shopping,Axis card,AXIS,3333,Card,sms,work; ai,,confirmed,');
  assert.match(lines[2], /,Transfer,5000\.00,/);
});

import { shouldLockOnReturn } from '../security/lock';

test('app lock timing: locks only when enabled and away long enough', () => {
  assert.equal(shouldLockOnReturn(false, 0, 999_999, 0), false); // lock off
  assert.equal(shouldLockOnReturn(true, null, 5, 0), false); // never left
  assert.equal(shouldLockOnReturn(true, 1000, 1000, 0), true); // "immediately": any return
  assert.equal(shouldLockOnReturn(true, 1000, 30_000, 60_000), false); // 29 s away, 1 min setting
  assert.equal(shouldLockOnReturn(true, 1000, 61_000, 60_000), true);
});
