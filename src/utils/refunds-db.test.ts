import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { linkRefund, monthlyTotals, refundCandidates, spendByCategory, summarize, topMerchants, totalFor, unlinkRefund } from '../db/queries';
import { migrate } from '../db/schema';

test('a linked refund nets against the purchase category and is not income', async () => {
  const raw = new DatabaseSync(':memory:');
  const db: any = {
    execAsync: async (s: string) => raw.exec(s),
    getFirstAsync: async (s: string, ...p: any[]) => (s.includes('user_version') ? { user_version: 0 } : raw.prepare(s).get(...p)),
    getAllAsync: async (s: string, ...p: any[]) => raw.prepare(s).all(...p),
    runAsync: async (s: string, ...p: any[]) => { const r = raw.prepare(s).run(...p); return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes }; },
    withExclusiveTransactionAsync: async (fn: any) => fn(db),
  };
  await migrate(db);
  const T = new Date(2026, 9, 15, 12).getTime();
  const [from, to] = [new Date(2026, 9, 1).getTime(), new Date(2026, 10, 1).getTime()];
  const ins = raw.prepare("insert into transactions (amount_paise,direction,source,ts,status,merchant,category_id) values (?,?,'sms',?,'confirmed',?,?)");
  const buy = Number(ins.run(100_000, 'debit', T, 'Myntra', 4).lastInsertRowid);
  ins.run(50_000, 'debit', T, 'Swiggy', 1);
  const refund = Number(ins.run(30_000, 'credit', T + 3 * 864e5, 'Myntra refund', null).lastInsertRowid);
  ins.run(200_000, 'credit', T, 'Salary', 8);

  // before linking: the credit counts as income and the purchase stays fully spent
  assert.equal(await totalFor(db, 'debit', from, to), 150_000);
  assert.equal(await totalFor(db, 'credit', from, to), 230_000);

  const cands = await refundCandidates(db, { id: refund, amount_paise: 30_000, ts: T + 3 * 864e5, merchant_id: null });
  assert.ok(cands.some((c) => c.id === buy));
  assert.ok(!cands.some((c) => c.merchant === 'Salary')); // credits are never candidates

  const purchase = (await db.getFirstAsync('select * from transactions where id = ?', buy))!;
  await linkRefund(db, refund, purchase);
  assert.equal(await totalFor(db, 'debit', from, to), 120_000); // 150k - 30k
  assert.equal(await totalFor(db, 'credit', from, to), 200_000); // refund no longer income
  const byCat = await spendByCategory(db, from, to);
  assert.deepEqual(byCat.map((c) => [c.category_id, c.total]).sort(), [[1, 50_000], [4, 70_000]]);
  const m = await monthlyTotals(db, from, to);
  assert.equal(m.find((r) => r.direction === 'debit')!.total, 120_000);
  assert.equal(m.find((r) => r.direction === 'credit')!.total, 200_000);
  assert.equal((await topMerchants(db, from, to)).find((r) => r.merchant === 'Myntra')!.total, 70_000);
  const s = await summarize(db, {});
  assert.deepEqual([s.spent, s.received], [120_000, 200_000]);

  await unlinkRefund(db, refund);
  assert.equal(await totalFor(db, 'debit', from, to), 150_000);
  assert.equal(await totalFor(db, 'credit', from, to), 230_000);
});
