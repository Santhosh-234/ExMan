import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { deleteAllData, purgeRawText, readSummary } from '../db/data';
import { migrate } from '../db/schema';

test('purge removes old raw text only; delete-all keeps categories, Cash and settings', async () => {
  const raw = new DatabaseSync(':memory:');
  const db: any = {
    execAsync: async (s: string) => raw.exec(s),
    getFirstAsync: async (s: string, ...p: any[]) => (s.includes('user_version') ? { user_version: 0 } : raw.prepare(s).get(...p)),
    getAllAsync: async (s: string, ...p: any[]) => raw.prepare(s).all(...p),
    runAsync: async (s: string, ...p: any[]) => { const r = raw.prepare(s).run(...p); return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes }; },
    withExclusiveTransactionAsync: async (fn: any) => fn(db),
  };
  await migrate(db);
  const now = Date.now();
  const ins = raw.prepare("insert into transactions (amount_paise,direction,source,ts,status,bank,raw_text,msg_hash) values (100,'debit','sms',?,'confirmed','HDFC',?,?)");
  ins.run(now - 200 * 864e5, 'old message', 'a');
  ins.run(now - 1 * 864e5, 'new message', 'b');
  raw.prepare("insert into unparsed (sender,text,ts) values ('X','old unparsed',?),('X','new unparsed',?)").run(now - 200 * 864e5, now);

  assert.equal(await purgeRawText(db, 90), 1);
  assert.deepEqual(raw.prepare('select raw_text from transactions order by ts').all().map((r: any) => r.raw_text), [null, 'new message']);
  assert.equal((raw.prepare('select count(*) c from unparsed').get() as any).c, 1);
  const sum = await readSummary(db);
  assert.deepEqual([sum[0].bank, sum[0].n, sum[0].with_text], ['HDFC', 2, 1]);

  raw.exec("insert into accounts (name,kind,bank,last4) values ('HDFC a/c','bank','HDFC','1')");
  raw.exec("insert into categories (name,icon,color,is_custom) values ('Pets','tag','#fff',1)");
  raw.exec("insert into settings (key,value) values ('theme','dark')");
  await deleteAllData(db);
  const c = (t: string) => (raw.prepare(`select count(*) c from ${t}`).get() as any).c;
  assert.deepEqual([c('transactions'), c('unparsed'), c('merchants'), c('rules')], [0, 0, 0, 0]);
  assert.deepEqual(raw.prepare('select name from accounts').all().map((r: any) => r.name), ['Cash']);
  assert.equal(c("categories where is_custom = 1"), 0);
  assert.ok(c('categories') >= 9);
  assert.equal((raw.prepare("select value from settings where key='theme'").get() as any).value, 'dark');
});
