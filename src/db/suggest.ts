import type { SQLiteDatabase } from 'expo-sqlite';

import { guessCategory } from '@/utils/categorize';
import { type Example, type Model, evaluate, trainModel } from '@/utils/suggest';

type Row = { merchant: string | null; direction: 'debit' | 'credit'; payment_mode: string | null; amount_paise: number; category_id: number; ts: number };

/** What the user has confirmed: the only history the model learns from (pending guesses would teach it its own mistakes). */
export async function loadHistory(db: SQLiteDatabase): Promise<(Example & { ts: number })[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT merchant, direction, payment_mode, amount_paise, category_id, ts FROM transactions
     WHERE status = 'confirmed' AND category_id IS NOT NULL AND is_transfer = 0 AND merchant IS NOT NULL
     ORDER BY ts DESC LIMIT 20000`,
  );
  return rows.map((r) => ({ merchant: r.merchant, direction: r.direction, mode: r.payment_mode, amountPaise: r.amount_paise, category: r.category_id, ts: r.ts }));
}

export async function loadModel(db: SQLiteDatabase): Promise<Model> {
  return trainModel(await loadHistory(db));
}

/** Learned category vs the built-in keyword guess, on the newest 20% of the user's own history. */
export async function categoryReport(db: SQLiteDatabase) {
  const history = await loadHistory(db);
  const names = new Map((await db.getAllAsync<{ id: number; name: string }>('SELECT id, name FROM categories')).map((c) => [c.name, c.id]));
  const base = (e: Example) => { const g = guessCategory(e.merchant, e.direction); return g ? names.get(g) ?? null : null; };
  return { history: history.length, ...evaluate(history, base) };
}
