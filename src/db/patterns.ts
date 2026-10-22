import { looksLikeTransaction } from '@/utils/transactional';
import type { SQLiteDatabase } from 'expo-sqlite';

import { type Pattern, type Taught, applyPattern, senderKey } from '@/utils/teach';

export type PatternRow = Pattern & { id: number; sender_key: string; example: string; enabled: number; hits: number; created_at: number };

export async function savePattern(db: SQLiteDatabase, sender: string, p: Pattern, example: string) {
  return (
    await db.runAsync(
      'INSERT INTO patterns (sender_key, direction, amount_re, merchant_re, account_re, example, enabled, hits, created_at, currency) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)',
      senderKey(sender), p.direction, p.amount_re, p.merchant_re, p.account_re, example, Date.now(), p.currency ?? 'INR',
    )
  ).lastInsertRowId;
}

export const listPatterns = (db: SQLiteDatabase) => db.getAllAsync<PatternRow>('SELECT * FROM patterns ORDER BY created_at DESC');
export const setPatternEnabled = (db: SQLiteDatabase, id: number, enabled: boolean) => db.runAsync('UPDATE patterns SET enabled = ? WHERE id = ?', enabled ? 1 : 0, id);
export const deletePattern = (db: SQLiteDatabase, id: number) => db.runAsync('DELETE FROM patterns WHERE id = ?', id);

/** Taught patterns grouped by sender, loaded once per ingest batch. Most-used first. */
export async function loadPatternIndex(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<PatternRow>('SELECT * FROM patterns WHERE enabled = 1 ORDER BY hits DESC, id DESC');
  const by = new Map<string, PatternRow[]>();
  for (const r of rows) by.set(r.sender_key, [...(by.get(r.sender_key) ?? []), r]);
  const hits = new Map<number, number>();
  return {
    match(sender: string, text: string): Taught | null {
      for (const p of by.get(senderKey(sender)) ?? []) {
        let t: Taught | null = null;
        try { t = applyPattern(text, p); } catch { /* a bad stored regex must never break ingest */ }
        if (t) { hits.set(p.id, (hits.get(p.id) ?? 0) + 1); return t; }
      }
      return null;
    },
    async flush(db2: SQLiteDatabase) {
      for (const [id, n] of hits) await db2.runAsync('UPDATE patterns SET hits = hits + ? WHERE id = ?', n, id);
      hits.clear();
    },
  };
}

export type Unparsed = { id: number; sender: string; text: string; ts: number };
/** Unrecognised messages, newest first. By default only ones that look like money movements; offers and reminders stay stored but hidden. */
export async function listUnparsed(db: SQLiteDatabase, limit = 100, showAll = false) {
  const rows = await db.getAllAsync<Unparsed>('SELECT id, sender, text, ts FROM unparsed ORDER BY ts DESC');
  return (showAll ? rows : rows.filter((r) => looksLikeTransaction(r.text))).slice(0, limit);
}
export const getUnparsed = (db: SQLiteDatabase, id: number) => db.getFirstAsync<Unparsed>('SELECT id, sender, text, ts FROM unparsed WHERE id = ?', id);
export const deleteUnparsed = (db: SQLiteDatabase, id: number) => db.runAsync('DELETE FROM unparsed WHERE id = ?', id);
/** How many stored unrecognised messages look like transactions, and how many are hidden promos/reminders. */
export async function countUnparsedSplit(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<{ text: string }>('SELECT text FROM unparsed');
  const likely = rows.filter((r) => looksLikeTransaction(r.text)).length;
  return { likely, hidden: rows.length - likely };
}
export const countUnparsed = async (db: SQLiteDatabase) => (await countUnparsedSplit(db)).likely;
