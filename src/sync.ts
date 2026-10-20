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
  const account = (await getSetting(db, 'sync_firefly_account')).trim();
  if (!endpoint) throw new Error('Set a sync endpoint first');
  if (mode === 'firefly' && !account) throw new Error('Set the Firefly asset account name first');

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
      const other = r.merchant ?? 'Unknown';
      const body = {
        error_if_duplicate_hash: false,
        transactions: [{
          type: debit ? 'withdrawal' : 'deposit',
          date: new Date(r.ts).toISOString(),
          amount: (r.amount_paise / 100).toFixed(2),
          currency_code: 'INR',
          description: other,
          // Firefly needs an existing asset account on the money side; the merchant side is auto-created
          ...(debit ? { source_name: account, destination_name: other } : { source_name: other, destination_name: account }),
          category_name: r.category ?? undefined,
          tags: r.tags ? r.tags.split(',').filter(Boolean) : undefined,
          external_id: `exman-${r.id}`,
          notes: [r.bank, r.account_last4 && `a/c ${r.account_last4}`, r.payment_mode].filter(Boolean).join(' · ') || undefined,
        }],
      };
      const res = await fetch(`${endpoint}/api/v1/transactions`, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 200);
        // already pushed earlier (e.g. app reinstalled): treat as synced
        if (res.status === 422 && /duplicate/i.test(detail)) {
          await db.runAsync('UPDATE transactions SET synced_at = ? WHERE id = ?', Date.now(), r.id);
          continue;
        }
        throw new Error(`Firefly rejected a row (${res.status}): ${detail}`);
      }
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
