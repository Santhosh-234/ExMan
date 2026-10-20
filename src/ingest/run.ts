import type { SQLiteDatabase } from 'expo-sqlite';

import { drain, readInbox, type RawMessage } from '../../modules/vibe-listener';
import { guessCategory } from '@/utils/categorize';
import { hashMessage } from '@/utils/hash';
import { isDuplicate, parseMessage } from '@/utils/parser';
import { notifyIngested } from './events';

type Near = { amount_paise: number; direction: 'debit' | 'credit'; account_last4: string | null; ts: number };

/** Per-batch caches so a 3,000-message import does lookups once, not per message. */
type Ctx = {
  seen: Set<string>;
  cats: Map<string, number>;
  accts: Map<string, number>;
};

async function makeCtx(db: SQLiteDatabase, since: number): Promise<Ctx> {
  const seen = new Set(
    (await db.getAllAsync<{ msg_hash: string }>('SELECT msg_hash FROM transactions WHERE msg_hash IS NOT NULL AND ts >= ?', since))
      .map((r) => r.msg_hash),
  );
  const cats = new Map((await db.getAllAsync<{ id: number; name: string }>('SELECT id, name FROM categories')).map((c) => [c.name, c.id]));
  const accts = new Map(
    (await db.getAllAsync<{ id: number; kind: string; bank: string | null; last4: string | null }>('SELECT id, kind, bank, last4 FROM accounts'))
      .map((a) => [`${a.kind}|${a.bank}|${a.last4}`, a.id]),
  );
  return { seen, cats, accts };
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

/** Parse one raw message and store it. Returns true if a new transaction row was added. */
async function store(db: SQLiteDatabase, ctx: Ctx, m: RawMessage): Promise<boolean> {
  const hash = hashMessage(m.ts, m.text);
  if (ctx.seen.has(hash)) return false;
  ctx.seen.add(hash);

  const t = parseMessage(m.text, { sender: m.sender, ts: m.ts });
  if (!t) {
    // privacy: only keep messages that mention an amount; OTPs/chats are dropped
    if (/(?:rs\.?|inr|₹)\s?\d/i.test(m.text))
      await db.runAsync('INSERT OR IGNORE INTO unparsed (sender, text, ts) VALUES (?, ?, ?)', m.sender, m.text, m.ts);
    return false;
  }
  // same payment seen via SMS and a UPI-app notification (indexed on amount_paise, ts)
  const near = await db.getAllAsync<Near>(
    'SELECT amount_paise, direction, account_last4, ts FROM transactions WHERE amount_paise = ? AND ts BETWEEN ? AND ?',
    t.amountPaise, t.ts - 60_000, t.ts + 60_000,
  );
  if (near.some((r) => isDuplicate(t, { amountPaise: r.amount_paise, direction: r.direction, account: r.account_last4, ts: r.ts }))) return false;

  const guess = guessCategory(t.merchant, t.direction);
  const accountId = await accountFor(db, ctx, t.bank, t.account, t.mode);
  await db.runAsync(
    `INSERT OR IGNORE INTO transactions
       (amount_paise, direction, merchant, category_id, account_id, source, bank, account_last4, payment_mode, ts, raw_text, msg_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    t.amountPaise, t.direction, t.merchant, (guess && ctx.cats.get(guess)) || null, accountId,
    t.source, t.bank, t.account, t.mode, t.ts, m.text, hash,
  );
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
