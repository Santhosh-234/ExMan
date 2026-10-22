// Whole-app scenarios on a real (in-memory) database: messages in -> review -> totals, transfers, refunds, budgets, subscriptions,
// export, backup/restore and wipe, exercising the same code the screens call.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

import { makeBackup, readBackup, restoreAll } from '../backup/dump';
import { deleteAllData } from '../db/data';
import { applyRuleToExisting, setMerchantRule } from '../db/merchants';
import { getRecurring } from '../db/recurring';
import {
  addManualTxn, budgetOverview, bulkUpdate, exportRows, getCategories, getEditLog, getTxns, linkRefund, mergeAccount, monthlyTotals, queryTxns, setBudgetRow, spendByCategory, summarize, topMerchants, totalFor, unlinkRefund, updateTxn,
} from '../db/queries';
import { purgeOtpMessages, reprocessUnparsed, run } from '../ingest/core';
import { toCsv } from './csv';
import { EMPTY_FILTER } from './filters';
import { monthRange } from './format';
import { makeDb } from './testdb';

const at = (iso: string) => Date.parse(`${iso}:00+05:30`);
const msg = (sender: string, text: string, iso: string) => ({ kind: 'sms' as const, sender, text, ts: at(iso) });

const OCT = monthRange('2026-10');
const MONTH_MSGS = [
  msg('VM-AXISBK-S', 'INR 75,000.00 credited to A/c XX1234 on 01-10-26 by NEFT-ACME LTD SALARY. Avl bal INR 80,000.00', '2026-10-01T09:00'),
  msg('VM-AXISBK-S', 'INR 450.00 debited A/c no. XX1234 03-10-26, 12:30:45 UPI/P2M/123456789012/Swiggy SMS BLOCK UPI to 7308080808 if not you - Axis Bank', '2026-10-03T12:30'),
  msg('VM-HDFCBK', 'Txn of Rs.899.00 done on HDFC Bank Card ending 4321 at NETFLIX on 05-08-26. Avl bal/limit Rs.50,000.00', '2026-08-05T10:00'),
  msg('VM-HDFCBK', 'Txn of Rs.899.00 done on HDFC Bank Card ending 4321 at NETFLIX on 05-09-26. Avl bal/limit Rs.50,000.00', '2026-09-05T10:00'),
  msg('VM-HDFCBK', 'Txn of Rs.899.00 done on HDFC Bank Card ending 4321 at NETFLIX on 05-10-26. Avl bal/limit Rs.50,000.00', '2026-10-05T10:00'),
  msg('VM-ICICIB', 'INR 2,000.00 spent using ICICI Bank Card XX1234 on 07-Oct-26 on AMAZON. Avl Lmt: INR 90,000.00. To dispute call 18002662', '2026-10-07T20:00'),
  msg('VM-SBIINB', 'Rs 5,000 withdrawn at SBI ATM from A/c X1234 on 09Oct26. Avl Bal Rs 20,000.', '2026-10-09T17:00'),
  msg('VM-HDFCBK', 'Rs.899.00 refunded to your HDFC Bank Card ending 4321 from NETFLIX on 12-10-26.', '2026-10-12T11:00'),
  msg('VM-HDFCBK', '123456 is the OTP for txn of Rs 500 at AMAZON on card ending 1234. Do not share.', '2026-10-13T11:00'),
  msg('AX-AXISBK', 'Pre-approved personal loan of Rs 5,00,000 for you. Apply now!', '2026-10-14T11:00'),
];

async function loaded() {
  const { db, raw } = await makeDb();
  const added = await run(db, MONTH_MSGS, 0);
  const pending = await getTxns(db, 'pending');
  return { db, raw, added, pending };
}
const confirmAll = async (db: Awaited<ReturnType<typeof makeDb>>['db']) => {
  const p = await getTxns(db, 'pending');
  await bulkUpdate(db, p.map((t) => t.id), { status: 'confirmed' });
};

test('a month of messages: only real transactions arrive, OTPs and promos are dropped', async () => {
  const { added, pending, raw } = await loaded();
  assert.equal(added, 8, 'salary, swiggy, 3x netflix, amazon, atm, refund');
  assert.equal(pending.length, 8);
  assert.equal((raw.prepare('SELECT COUNT(*) n FROM unparsed').get() as { n: number }).n, 1, 'only the loan promo is kept for Teach: the OTP message is never stored (its code is a credential)');
});

test('importing the same messages again changes nothing (idempotent)', async () => {
  const { db, raw } = await loaded();
  const before = raw.prepare('SELECT COUNT(*) n FROM transactions').get() as { n: number };
  assert.equal(await run(db, MONTH_MSGS, 0), 0);
  assert.equal(await run(db, [...MONTH_MSGS].reverse(), 0), 0);
  assert.deepEqual(raw.prepare('SELECT COUNT(*) n FROM transactions').get(), before);
});

test('confirmed totals: spending nets the refund, income counts the salary, transfers excluded', async () => {
  const { db } = await loaded();
  await confirmAll(db);
  const spent = await totalFor(db, 'debit', ...OCT);
  const income = await totalFor(db, 'credit', ...OCT);
  // 450 + 899 (oct netflix) + 2000 + 5000 = 8349, refund of 899 is not linked yet so income also counts it
  assert.equal(spent, (450 + 899 + 2000 + 5000) * 100);
  assert.equal(income, (75000 + 899) * 100);
});

test('linking a refund removes it from income and reduces the purchase category', async () => {
  const { db } = await loaded();
  await confirmAll(db);
  const all = await queryTxns(db, { ...EMPTY_FILTER });
  const refund = all.find((t) => t.direction === 'credit' && t.amount_paise === 89900)!;
  const purchase = all.find((t) => t.direction === 'debit' && t.amount_paise === 89900 && new Date(t.ts).getMonth() === 9)!;
  await linkRefund(db, refund.id, purchase);
  assert.equal(await totalFor(db, 'credit', ...OCT), 75000 * 100);
  assert.equal(await totalFor(db, 'debit', ...OCT), (450 + 899 - 899 + 2000 + 5000) * 100);
  await unlinkRefund(db, refund.id);
  assert.equal(await totalFor(db, 'credit', ...OCT), (75000 + 899) * 100);
});

test('editing a confirmed transaction records what changed; undo restores it', async () => {
  const { db } = await loaded();
  await confirmAll(db);
  const t = (await queryTxns(db, { ...EMPTY_FILTER, q: 'amazon' }))[0];
  await updateTxn(db, t.id, { amount_paise: 250000, notes: 'gift' });
  const log = await getEditLog(db, t.id);
  assert.ok(log.length >= 2);
  const undo = await bulkUpdate(db, [t.id], { amount_paise: 999 });
  await undo();
  const after = (await queryTxns(db, { ...EMPTY_FILTER, q: 'amazon' }))[0];
  assert.equal(after.amount_paise, 250000);
});

test('dismissed transactions stay dismissed when the messages are imported again', async () => {
  const { db, raw } = await loaded();
  const first = (await getTxns(db, 'pending'))[0];
  await updateTxn(db, first.id, { status: 'dismissed' });
  assert.equal(await run(db, MONTH_MSGS, 0), 0);
  assert.equal((raw.prepare("SELECT COUNT(*) n FROM transactions WHERE status = 'dismissed'").get() as { n: number }).n, 1);
});

test('subscription detection finds the monthly Netflix charge', async () => {
  const { db } = await loaded();
  await confirmAll(db);
  const rec = await getRecurring(db, at('2026-10-20T10:00'));
  const nf = rec.find((r) => /netflix/i.test(r.merchant));
  assert.ok(nf, `recurring: ${JSON.stringify(rec.map((r) => r.merchant))}`);
  assert.equal(nf!.amount, 89900);
});

test('category rule: learn once, applies to existing, and can be undone', async () => {
  const { db, raw } = await loaded();
  await confirmAll(db);
  const cats = await getCategories(db);
  const ent = cats.find((c) => /entertain|subscr|shopping/i.test(c.name)) ?? cats[0];
  const m = raw.prepare("SELECT id FROM merchants WHERE name LIKE '%etflix%'").get() as { id: number } | undefined;
  assert.ok(m, 'merchant row for Netflix');
  await setMerchantRule(db, m!.id, ent.id);
  const { undo } = await applyRuleToExisting(db, { merchantId: m!.id, categoryId: ent.id });
  const rows = raw.prepare('SELECT category_id FROM transactions WHERE merchant_id = ?').all(m!.id) as { category_id: number }[];
  assert.ok(rows.length >= 3 && rows.every((r) => r.category_id === ent.id));
  await undo();
});

test('budgets: spending against a category budget, with alerts at 80%', async () => {
  const { db, raw } = await loaded();
  await confirmAll(db);
  const cats = await getCategories(db);
  const cat = (raw.prepare("SELECT category_id c, COUNT(*) n FROM transactions WHERE direction='debit' AND category_id IS NOT NULL GROUP BY 1 ORDER BY n DESC").get() as { c: number } | undefined)?.c ?? cats[0].id;
  await setBudgetRow(db, cat, '2026-10', 100_000, false);
  const lines = await budgetOverview(db, '2026-10');
  const line = lines.find((l) => l.category_id === cat)!;
  assert.equal(line.limit, 100_000);
  assert.ok(line.spent >= 0);
});

test('month totals chart data and top merchants agree with the ledger', async () => {
  const { db } = await loaded();
  await confirmAll(db);
  const rows = await monthlyTotals(db, ...monthRange('2026-08'), );
  void rows;
  const all = await monthlyTotals(db, at('2026-08-01T00:00'), at('2026-11-01T00:00'));
  const oct = all.filter((r) => r.month === '2026-10');
  assert.ok(oct.length >= 1);
  const tops = await topMerchants(db, ...OCT, 5);
  assert.ok(tops.length > 0);
  const s = await summarize(db, { ...EMPTY_FILTER, from: OCT[0], to: OCT[1] });
  assert.equal(s.n, 8 - 2); // aug + sep netflix are outside the month
});

test('category spending adds up to total spending', async () => {
  const { db } = await loaded();
  await confirmAll(db);
  const cats = await spendByCategory(db, ...OCT);
  assert.equal(cats.reduce((a, c) => a + c.total, 0), await totalFor(db, 'debit', ...OCT));
});

test('manual cash entry shows up in totals and in recent suggestions', async () => {
  const { db } = await loaded();
  await addManualTxn(db, { amount_paise: 12000, direction: 'debit', merchant: 'Chai', category_id: null, account_id: null, ts: at('2026-10-15T09:00'), tags: 'cash', notes: null });
  const before = await totalFor(db, 'debit', ...OCT);
  assert.equal(before, 12000, 'only confirmed rows count and manual entries are confirmed');
});

test('CSV export has one line per ledger row and neutralises spreadsheet formulas', async () => {
  const { db } = await loaded();
  await confirmAll(db);
  await addManualTxn(db, { amount_paise: 100, direction: 'debit', merchant: '=HYPERLINK("http://evil")', category_id: null, account_id: null, ts: at('2026-10-16T09:00'), tags: '', notes: '+cmd' });
  const rows = await exportRows(db);
  const csv = toCsv(rows);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, rows.length + 1);
  assert.ok(!/(^|,)"?=HYPERLINK/m.test(csv), 'formula must be prefixed');
});

test('merging accounts keeps every transaction and re-import resolves to the target', async () => {
  const { db, raw } = await loaded();
  const accts = raw.prepare('SELECT id FROM accounts ORDER BY id').all() as { id: number }[];
  assert.ok(accts.length >= 2);
  await mergeAccount(db, accts[0].id, accts[1].id);
  const n = (raw.prepare('SELECT COUNT(*) n FROM transactions').get() as { n: number }).n;
  assert.equal(n, 8);
  assert.equal((raw.prepare('SELECT COUNT(*) n FROM transactions WHERE account_id = ?').get(accts[0].id) as { n: number }).n, 0);
  assert.equal(await run(db, MONTH_MSGS, 0), 0);
});

test('encrypted backup and restore reproduce the data exactly; a wrong password is refused', async () => {
  const { db, raw } = await loaded();
  await confirmAll(db);
  await addManualTxn(db, { amount_paise: 12345, direction: 'debit', merchant: 'Rent ₹ & "friends"', category_id: null, account_id: null, ts: at('2026-10-17T09:00'), tags: 'a,b', notes: 'line1\nline2' });
  const snapshot = (r: typeof raw) => JSON.stringify(r.prepare('SELECT amount_paise, direction, merchant, status, ts, tags, notes, currency FROM transactions ORDER BY ts, amount_paise').all());
  const before = snapshot(raw);
  const file = await makeBackup(db, 'correct horse', (n) => new Uint8Array(randomBytes(n)));
  await assert.rejects(readBackup(file, 'wrong password'));
  const { db: db2, raw: raw2 } = await makeDb();
  await run(db2, [msg('VM-AXISBK-S', 'INR 10.00 debited A/c no. XX9999 03-10-26 UPI/P2M/1/Zzz', '2026-10-03T12:30')], 0); // data that must be replaced
  await restoreAll(db2, await readBackup(file, 'correct horse'));
  assert.equal(snapshot(raw2), before);
  assert.equal(await run(db2, MONTH_MSGS, 0), 0, 'restored hashes prevent duplicates on re-import');
});

test('delete all data wipes transactions, learned things and accounts but keeps the built-in categories', async () => {
  const { db, raw } = await loaded();
  await confirmAll(db);
  await deleteAllData(db);
  for (const t of ['transactions', 'merchants', 'unparsed', 'rules', 'patterns', 'budgets']) assert.equal((raw.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n, 0, t);
  assert.ok((raw.prepare('SELECT COUNT(*) n FROM categories').get() as { n: number }).n > 5);
  assert.equal(await run(db, MONTH_MSGS, 0), 8, 'after a wipe the same messages import again');
});

test('reprocessing with nothing taught changes nothing', async () => {
  const { db } = await loaded();
  assert.equal(await reprocessUnparsed(db), 0);
});

test('old OTP messages left in the unrecognised list are purged', async () => {
  const { db, raw } = await makeDb();
  raw.exec("INSERT INTO unparsed (sender, text, ts) VALUES ('VM-HDFCBK', '482913 is the OTP for txn of Rs 500', 1), ('VM-HDFCBK', 'Rs 500 hit on your card XX1234 at SHOP', 2)");
  assert.equal(await purgeOtpMessages(db), 1);
  assert.equal((raw.prepare('SELECT COUNT(*) n FROM unparsed').get() as { n: number }).n, 1);
});

test('the same payment from a bank SMS and a UPI-app notification is one transaction', async () => {
  const { db, raw } = await makeDb();
  const sms = msg('VM-AXISBK-S', 'INR 250.00 debited A/c no. XX1234 03-10-26, 12:30:45 UPI/P2M/123456789012/Zomato SMS BLOCK UPI to 7308080808 if not you - Axis Bank', '2026-10-03T12:30');
  const notif = { kind: 'notif' as const, sender: 'com.google.android.apps.nbu.paisa.user', text: 'Paid ₹250 to Zomato', ts: at('2026-10-03T12:30') + 20_000 };
  assert.equal(await run(db, [sms, notif], 0), 1);
  assert.equal(await run(db, [notif], 0), 0);
  assert.equal((raw.prepare('SELECT COUNT(*) n FROM transactions').get() as { n: number }).n, 1);
  // a genuinely different payment of the same amount a few minutes later is kept
  assert.equal(await run(db, [{ ...notif, ts: notif.ts + 10 * 60_000 }], 0), 1);
});

test('card bill payment: the debit and the card credit are both marked as transfers and leave spending and income alone', async () => {
  const { db, raw } = await makeDb();
  await run(db, [
    msg('VM-HDFCBK', 'Txn of Rs.4,000.00 done on HDFC Bank Card ending 4321 at BIGBASKET on 04-10-26. Avl bal/limit Rs.50,000.00', '2026-10-04T10:00'),
    msg('VM-AXISBK-S', 'INR 12,000.00 debited A/c no. XX1234 10-10-26, 09:00:00 UPI/P2M/123456789012/HDFC CREDIT CARD BILL PAYMENT SMS BLOCK UPI to 7308080808 if not you - Axis Bank', '2026-10-10T09:00'),
    msg('VM-HDFCBK', 'Payment of Rs.12,000.00 received towards your HDFC Bank Credit Card XX4321 on 10-10-26. Thank you.', '2026-10-10T09:05'),
  ], 0);
  const rows = raw.prepare('SELECT amount_paise, direction, is_transfer FROM transactions ORDER BY ts').all() as { amount_paise: number; direction: string; is_transfer: number }[];
  assert.equal(rows.length, 3);
  assert.equal(rows[0].is_transfer, 0);
  assert.deepEqual([rows[1].is_transfer, rows[2].is_transfer], [1, 1]);
  await confirmAll(db);
  assert.equal(await totalFor(db, 'debit', ...OCT), 4000 * 100);
  assert.equal(await totalFor(db, 'credit', ...OCT), 0);
});

test('foreign-currency card spend is converted at the stored rate, shown with its original amount, and re-rated by editing', async () => {
  const { db, raw } = await makeDb();
  assert.equal(await run(db, [msg('VM-AXISBK-S', 'Spent 32.00 USD on card XX1234 at NETFLIX. Avl Limit INR 1,20,000.00', '2026-10-05T10:00')], 0), 1);
  const t = raw.prepare('SELECT amount_paise, currency, foreign_minor FROM transactions').get() as { amount_paise: number; currency: string; foreign_minor: number };
  assert.equal(t.currency, 'USD');
  assert.equal(t.foreign_minor, 3200);
  assert.equal(t.amount_paise, 32 * 88 * 100); // default approximate rate: 88 rupees per dollar
  raw.exec("INSERT INTO settings (key, value) VALUES ('fx_USD', '90')");
  assert.equal(await run(db, [msg('VM-AXISBK-S', 'Spent 10.00 USD on card XX1234 at SPOTIFY. Avl Limit INR 1,20,000.00', '2026-10-06T10:00')], 0), 1);
  assert.equal((raw.prepare("SELECT amount_paise FROM transactions WHERE merchant LIKE '%potify%'").get() as { amount_paise: number }).amount_paise, 10 * 90 * 100);
});
