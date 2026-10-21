import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { addCategory, deleteCategory, getCategories, setCategoryArchived, updateCategory } from '../db/queries';
import { migrate } from '../db/schema';

test('custom categories: add, clash, rename, archive, delete (built-ins protected)', async () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db: any = {
    execAsync: async (s: string) => raw.exec(s),
    getFirstAsync: async (s: string, ...p: any[]) => (s.includes('user_version') ? { user_version: 0 } : raw.prepare(s).get(...p)),
    getAllAsync: async (s: string, ...p: any[]) => raw.prepare(s).all(...p),
    runAsync: async (s: string, ...p: any[]) => { const r = raw.prepare(s).run(...p); return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes }; },
    withExclusiveTransactionAsync: async (fn: any) => fn(db),
  };
  await migrate(db);
  raw.exec('PRAGMA foreign_keys = ON');

  const id = await addCategory(db, 'Pets', '#F59E0B');
  await assert.rejects(addCategory(db, 'pets', '#000000'), /already exists/); // case-insensitive clash
  await assert.rejects(addCategory(db, 'Food & Dining', '#000000'), /already exists/); // clash with built-in
  await updateCategory(db, id, { name: 'Pet care', color: '#10B981' });
  await assert.rejects(updateCategory(db, id, { name: 'Groceries' }), /already exists/);

  raw.prepare("insert into transactions (amount_paise,direction,source,ts,status,category_id) values (100,'debit','manual',1,'confirmed',?)").run(id);
  await setCategoryArchived(db, id, true);
  assert.equal((await getCategories(db)).find((c) => c.id === id)!.archived, 1);
  // archived categories sort last but stay available to old transactions
  assert.equal((await getCategories(db)).at(-1)!.id, id);

  await deleteCategory(db, id);
  assert.equal((raw.prepare('select category_id from transactions').get() as any).category_id, null);
  const builtIn = (await getCategories(db)).find((c) => !c.is_custom)!;
  await assert.rejects(deleteCategory(db, builtIn.id), /Built-in/);
});
