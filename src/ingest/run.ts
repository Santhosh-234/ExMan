import type { SQLiteDatabase } from 'expo-sqlite';

import { drain } from '../../modules/vibe-listener';
import { guessCategory } from '@/utils/categorize';
import { isDuplicate, parseMessage } from '@/utils/parser';

type Row = { amount_paise: number; direction: 'debit' | 'credit'; account_last4: string | null; ts: number };

/** Drain native queue -> parse -> skip cross-channel duplicates -> insert as 'pending'. Returns rows added. */
export async function ingest(db: SQLiteDatabase): Promise<number> {
  let added = 0;
  for (const m of drain()) {
    const t = parseMessage(m.text, { sender: m.sender, ts: m.ts });
    if (!t) {
      // privacy: only keep messages that mention an amount; OTPs/chats are dropped
      if (/(?:rs\.?|inr|₹)\s?\d/i.test(m.text))
        await db.runAsync('INSERT INTO unparsed (sender, text, ts) VALUES (?, ?, ?)', m.sender, m.text, m.ts);
      continue;
    }
    const near = await db.getAllAsync<Row>(
      'SELECT amount_paise, direction, account_last4, ts FROM transactions WHERE amount_paise = ? AND ts BETWEEN ? AND ?',
      t.amountPaise, t.ts - 60_000, t.ts + 60_000,
    );
    const dup = near.some((r) =>
      isDuplicate(t, { amountPaise: r.amount_paise, direction: r.direction, account: r.account_last4, ts: r.ts }),
    );
    if (dup) continue;
    const guess = guessCategory(t.merchant, t.direction);
    const cat = guess ? await db.getFirstAsync<{ id: number }>('SELECT id FROM categories WHERE name = ?', guess) : null;
    await db.runAsync(
      `INSERT INTO transactions (amount_paise, direction, merchant, category_id, source, bank, account_last4, payment_mode, ts, raw_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      t.amountPaise, t.direction, t.merchant, cat?.id ?? null, t.source, t.bank, t.account, t.mode, t.ts, m.text,
    );
    added++;
  }
  return added;
}
