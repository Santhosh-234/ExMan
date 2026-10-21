import type { SQLiteDatabase } from 'expo-sqlite';

import { drain, readInbox, type RawMessage } from '../../modules/vibe-listener';
import { type MerchantCache, ensureMerchant } from '@/db/merchantCore';
import { loadRuleIndex } from '@/db/merchants';
import { loadPatternIndex } from '@/db/patterns';
import { detectTransfers } from '@/db/transfers';
import { toParsed } from '@/utils/teach';
import { countParse } from '@/telemetry';
import { CURRENCIES, toPaise } from '@/utils/currency';
import { guessCategory } from '@/utils/categorize';
import { hashMessage } from '@/utils/hash';
import { extractBalance, isDuplicate, parseMessage } from '@/utils/parser';
import { notifyIngested } from './events';

type Near = { amount_paise: number; direction: 'debit' | 'credit'; account_last4: string | null; ts: number };

/** Per-batch caches so a 3,000-message import does lookups once, not per message. */
type Ctx = {
  seen: Set<string>;
  cats: Map<string, number>;
  accts: Map<string, number>;
  merchants: MerchantCache;
  rules: Awaited<ReturnType<typeof loadRuleIndex>>;
  patterns: Awaited<ReturnType<typeof loadPatternIndex>>;
  fx: Map<string, number>; // rupees per 1 unit of each foreign currency
};

/** User-set rates (Settings > Exchange rates) over built-in approximations. */
export async function loadRates(db: SQLiteDatabase) {
  const rates = new Map<string, number>(CURRENCIES.map((c) => [c.code, c.rate]));
  for (const r of await db.getAllAsync<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key LIKE 'fx\\_%' ESCAPE '\\'")) {
    const v = parseFloat(r.value);
    if (v > 0) rates.set(r.key.slice(3), v);
  }
  return rates;
}

async function makeCtx(db: SQLiteDatabase, since: number): Promise<Ctx> {
  const seen = new Set(
    (await db.getAllAsync<{ msg_hash: string }>('SELECT msg_hash FROM transactions WHERE msg_hash IS NOT NULL AND ts >= ?', since))
      .map((r) => r.msg_hash),
  );
  const cats = new Map((await db.getAllAsync<{ id: number; name: string }>('SELECT id, name FROM categories')).map((c) => [c.name, c.id]));
  // an account merged into another resolves to its final target, so re-imports never resurrect it
  const rows = await db.getAllAsync<{ id: number; kind: string; bank: string | null; last4: string | null; merged_into: number | null }>('SELECT id, kind, bank, last4, merged_into FROM accounts');
  const into = new Map(rows.map((a) => [a.id, a.merged_into]));
  const final = (id: number) => { let cur = id; for (let i = 0; i < 10 && into.get(cur); i++) cur = into.get(cur)!; return cur; };
  const accts = new Map(rows.map((a) => [`${a.kind}|${a.bank}|${a.last4}`, final(a.id)]));
  return { seen, cats, accts, merchants: new Map(), rules: await loadRuleIndex(db), patterns: await loadPatternIndex(db), fx: await loadRates(db) };
}

/** Bank + last-4 (+ card vs account) identifies an account; created on first sight. */
async function accountFor(db: SQLiteDatabase, ctx: Ctx, bank: string | null, last4: string | null, mode: string | null) {
  if (!bank || !last4) return null;
  const kind = mode === 'Card' ? 'card' : 'bank';
  const key = `${kind}|${bank}|${last4}`;
  let id = ctx.accts.get(key);
  if (!id) {
    const name = `${bank} ${kind === 'card' ? 'card' : 'a/c'} ${last4}`;
    id = (await db.runAsync('INSERT OR IGNORE INTO accounts (name, kind, bank, last4) VALUES (?, ?, ?, ?)', name, kind, bank, last4)).lastInsertRowId;
    if (!id) id = (await db.getFirstAsync<{ id: number }>('SELECT id FROM accounts WHERE kind = ? AND bank = ? AND last4 = ?', kind, bank, last4))!.id;
    ctx.accts.set(key, id);
  }
  return id;
}

/** Keeps only the newest balance/limit seen for an account. */
async function recordBalance(db: SQLiteDatabase, accountId: number, b: NonNullable<ReturnType<typeof extractBalance>>, ts: number) {
  await db.runAsync(
    'UPDATE accounts SET balance_paise = ?, balance_kind = ?, balance_ts = ? WHERE id = ? AND (balance_ts IS NULL OR balance_ts < ?)',
    b.paise, b.kind, ts, accountId, ts,
  );
}

/** Parse one raw message and store it. Returns true if a new transaction row was added. */
async function store(db: SQLiteDatabase, ctx: Ctx, m: RawMessage): Promise<boolean> {
  const hash = hashMessage(m.ts, m.text);
  if (ctx.seen.has(hash)) return false;
  ctx.seen.add(hash);

  // built-in parser first, then formats the user taught (Teach ExMan)
  let t = parseMessage(m.text, { sender: m.sender, ts: m.ts });
  if (!t) {
    const taught = ctx.patterns.match(m.sender, m.text);
    if (taught) { t = toParsed(m.text, m.sender, m.ts, taught); countParse(t.bank, 'taught'); }
  } else countParse(t.bank, 'parsed');
  if (!t) {
    // privacy: only keep messages that mention an amount; OTPs/chats are dropped
    if (/(?:rs\.?|inr|₹)\s?\d/i.test(m.text)) {
      countParse(null, 'unrecognised');
      await db.runAsync('INSERT OR IGNORE INTO unparsed (sender, text, ts) VALUES (?, ?, ?)', m.sender, m.text, m.ts);
    }
    return false;
  }
  if (t.currency && t.foreignMinor) t = { ...t, amountPaise: toPaise(t.foreignMinor, t.currency, ctx.fx.get(t.currency) ?? 1) };
  // same payment seen via SMS and a UPI-app notification (indexed on amount_paise, ts)
  const near = await db.getAllAsync<Near>(
    'SELECT amount_paise, direction, account_last4, ts FROM transactions WHERE amount_paise = ? AND ts BETWEEN ? AND ?',
    t.amountPaise, t.ts - 60_000, t.ts + 60_000,
  );
  if (near.some((r) => isDuplicate(t, { amountPaise: r.amount_paise, direction: r.direction, account: r.account_last4, ts: r.ts }))) return false;

  // user rules first (merchant, then keyword), then the built-in keyword guesses
  const merchant = await ensureMerchant(db, t.merchant, ctx.merchants);
  const ruleCat = ctx.rules.categoryFor(merchant?.id ?? null, t.merchant);
  const guess = guessCategory(merchant?.name ?? t.merchant, t.direction);
  const accountId = await accountFor(db, ctx, t.bank, t.account, t.mode);
  const res = await db.runAsync(
    `INSERT OR IGNORE INTO transactions
       (amount_paise, direction, merchant, category_id, account_id, source, bank, account_last4, payment_mode, ts, raw_text, msg_hash, merchant_id, currency, foreign_minor)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    t.amountPaise, t.direction, merchant?.name ?? t.merchant, ruleCat ?? ((guess && ctx.cats.get(guess)) || null), accountId,
    t.source, t.bank, t.account, t.mode, t.ts, m.text, hash, merchant?.id ?? null, t.currency ?? null, t.foreignMinor ?? null,
  );
  if (!res.changes) return false;
  if (accountId && t.balance) await recordBalance(db, accountId, t.balance, t.ts);
  await detectTransfers(db, [res.lastInsertRowId]);
  return true;
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

/** Rows saved before msg_hash existed get one, so re-importing them can't duplicate. Cheap no-op afterwards. */
async function backfillHashes(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<{ id: number; ts: number; raw_text: string | null }>(
    'SELECT id, ts, raw_text FROM transactions WHERE msg_hash IS NULL AND raw_text IS NOT NULL',
  );
  if (!rows.length) return;
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const r of rows) await tx.runAsync('UPDATE OR IGNORE transactions SET msg_hash = ? WHERE id = ?', hashMessage(r.ts, r.raw_text!), r.id);
  });
}

async function run(db: SQLiteDatabase, msgs: RawMessage[], since: number, onProgress?: (done: number, total: number) => void) {
  if (!msgs.length) return 0;
  await backfillHashes(db);
  const ctx = await makeCtx(db, since);
  let added = 0;
  // one transaction for the whole batch: a single disk sync instead of one per insert
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (let i = 0; i < msgs.length; i++) {
      if (await store(tx, ctx, msgs[i])) added++;
      if (i % 100 === 99) {
        onProgress?.(i + 1, msgs.length);
        await yieldToUi();
      }
    }
  });
  await ctx.patterns.flush(db);
  onProgress?.(msgs.length, msgs.length);
  if (added) notifyIngested();
  return added;
}

/** Drain native queue -> parse -> skip duplicates -> insert as 'pending'. Returns rows added. */
export function ingest(db: SQLiteDatabase): Promise<number> {
  const msgs = drain();
  return run(db, msgs, msgs.length ? Math.min(...msgs.map((m) => m.ts)) - 120_000 : 0);
}

/** One-off import of existing SMS from the last `days` days. Safe to re-run. Returns rows added. */
export function importHistory(db: SQLiteDatabase, days: number, onProgress?: (done: number, total: number) => void): Promise<number> {
  const since = Date.now() - days * 864e5;
  return run(db, readInbox(since), since - 120_000, onProgress);
}

/**
 * One-time upgrade for rows saved before accounts/balances existed: link transactions to accounts by
 * (bank, last4) and pick up the newest balance quoted in each account's messages.
 */
export async function backfillAccounts(db: SQLiteDatabase) {
  const done = await db.getFirstAsync("SELECT 1 FROM settings WHERE key = 'accounts_backfilled_v1'");
  if (done) return;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await makeCtx(tx, 0);
    const rows = await tx.getAllAsync<{ id: number; bank: string | null; account_last4: string | null; payment_mode: string | null; ts: number; raw_text: string | null; account_id: number | null }>(
      'SELECT id, bank, account_last4, payment_mode, ts, raw_text, account_id FROM transactions ORDER BY ts ASC',
    );
    for (const r of rows) {
      let acct = r.account_id;
      if (!acct) {
        acct = await accountFor(tx, ctx, r.bank, r.account_last4, r.payment_mode);
        if (acct) await tx.runAsync('UPDATE transactions SET account_id = ? WHERE id = ?', acct, r.id);
      }
      const bal = acct && r.raw_text ? extractBalance(r.raw_text) : null;
      if (acct && bal) await recordBalance(tx, acct, bal, r.ts);
    }
    await tx.runAsync("INSERT INTO settings (key, value) VALUES ('accounts_backfilled_v1', '1')");
  });
}

/** Groups transactions that have a merchant name but no merchant link under canonical merchants. Cheap no-op when none. */
export async function backfillMerchants(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<{ id: number; merchant: string }>('SELECT id, merchant FROM transactions WHERE merchant IS NOT NULL AND merchant_id IS NULL');
  if (!rows.length) return;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const cache: MerchantCache = new Map();
    for (const r of rows) {
      const m = await ensureMerchant(tx, r.merchant, cache);
      if (m) await tx.runAsync('UPDATE transactions SET merchant_id = ?, merchant = ? WHERE id = ?', m.id, m.name, r.id);
    }
  });
}

/**
 * After the user teaches a format: re-run every stored unrecognised message through ingest.
 * Messages that now parse become pending transactions and leave the unrecognised list.
 */
export async function reprocessUnparsed(db: SQLiteDatabase): Promise<number> {
  const rows = await db.getAllAsync<{ id: number; sender: string; text: string; ts: number }>('SELECT id, sender, text, ts FROM unparsed ORDER BY ts ASC');
  let added = 0;
  await backfillHashes(db);
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await makeCtx(tx, 0);
    for (const r of rows) {
      if (await store(tx, ctx, { kind: 'sms', sender: r.sender, text: r.text, ts: r.ts })) {
        await tx.runAsync('DELETE FROM unparsed WHERE id = ?', r.id);
        added++;
      }
    }
    await ctx.patterns.flush(tx);
  });
  if (added) notifyIngested();
  return added;
}
