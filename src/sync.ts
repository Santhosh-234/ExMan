import type { SQLiteDatabase } from 'expo-sqlite';

import { getSetting } from '@/db/queries';

type Row = {
  id: number; amount_paise: number; direction: string; merchant: string | null; category: string | null;
  bank: string | null; account_last4: string | null; payment_mode: string | null; ts: number; tags: string;
};

/**
 * Push confirmed, unsynced transactions to the user's endpoint. Returns count sent.
 * mode 'firefly': POST {endpoint}/api/v1/transactions per row (Firefly III personal access token).
 * mode 'rest': POST {endpoint} once with {transactions:[...]} and a Bearer token.
 */
export async function syncNow(db: SQLiteDatabase): Promise<number> {
  const endpoint = (await getSetting(db, 'sync_endpoint')).replace(/\/+$/, '');
  const token = await getSetting(db, 'sync_token');
  const mode = (await getSetting(db, 'sync_mode')) || 'rest';
  if (!endpoint) throw new Error('Set a sync endpoint first');

  const rows = await db.getAllAsync<Row>(
    `SELECT t.id, t.amount_paise, t.direction, t.merchant, c.name AS category, t.bank, t.account_last4,
            t.payment_mode, t.ts, t.tags
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.status = 'confirmed' AND t.synced_at IS NULL ORDER BY t.ts`,
  );
  if (!rows.length) return 0;
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` };

  if (mode === 'firefly') {
    for (const r of rows) {
      const debit = r.direction === 'debit';
      const body = {
        transactions: [{
          type: debit ? 'withdrawal' : 'deposit',
          date: new Date(r.ts).toISOString(),
          amount: (r.amount_paise / 100).toFixed(2),
          description: r.merchant ?? 'Unknown',
          ...(debit ? { destination_name: r.merchant ?? 'Unknown' } : { source_name: r.merchant ?? 'Unknown' }),
          category_name: r.category ?? undefined,
          tags: r.tags ? r.tags.split(',').filter(Boolean) : undefined,
        }],
      };
      const res = await fetch(`${endpoint}/api/v1/transactions`, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`Sync failed (${res.status}) after ${rows.indexOf(r)} rows`);
      await db.runAsync('UPDATE transactions SET synced_at = ? WHERE id = ?', Date.now(), r.id);
    }
  } else {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ transactions: rows.map((r) => ({ ...r, amount: r.amount_paise / 100 })) }),
    });
    if (!res.ok) throw new Error(`Sync failed (${res.status})`);
    const now = Date.now();
    await db.runAsync(`UPDATE transactions SET synced_at = ? WHERE id IN (${rows.map(() => '?').join(',')})`, now, ...rows.map((r) => r.id));
  }
  return rows.length;
}
