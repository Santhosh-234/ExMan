import type { SQLiteDatabase } from 'expo-sqlite';

import { getSetting } from '@/db/queries';

type Row = {
  id: number; amount_paise: number; direction: string; merchant: string | null; category: string | null;
  bank: string | null; account_last4: string | null; payment_mode: string | null; ts: number; tags: string; firefly_name: string | null; currency: string | null; foreign_minor: number | null;
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
  if (mode === 'firefly' && !account && !(await db.getFirstAsync("SELECT 1 FROM accounts WHERE firefly_name IS NOT NULL AND firefly_name != ''"))) throw new Error('Set the Firefly asset account name first');

  const rows = await db.getAllAsync<Row>(
    `SELECT t.id, t.amount_paise, t.direction, t.merchant, c.name AS category, t.bank, t.account_last4,
            t.payment_mode, t.ts, t.tags, a.firefly_name, t.currency, t.foreign_minor
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN accounts a ON a.id = t.account_id
     WHERE t.status = 'confirmed' AND t.is_transfer = 0 AND t.kind NOT IN ('investment','loan') AND t.synced_at IS NULL ORDER BY t.ts`,
  );
  if (!rows.length) return 0;
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` };

  if (mode === 'firefly') {
    for (const r of rows) {
      const debit = r.direction === 'debit';
      const other = r.merchant ?? 'Unknown';
      // each ExMan account maps to its own Firefly asset account; the Settings name is the fallback
      const asset = (r.firefly_name ?? '').trim() || account;
      if (!asset) throw new Error(`No Firefly account set for ${r.bank ?? 'an account'} ${r.account_last4 ?? ''}. Set one on the account's page or a default in Settings.`);
      const body = {
        error_if_duplicate_hash: false,
        transactions: [{
          type: debit ? 'withdrawal' : 'deposit',
          date: new Date(r.ts).toISOString(),
          amount: (r.amount_paise / 100).toFixed(2),
          currency_code: 'INR',
          // keep the original foreign amount so Firefly shows what was actually charged
          ...(r.currency && r.foreign_minor ? { foreign_currency_code: r.currency, foreign_amount: (r.foreign_minor / (r.currency === 'JPY' ? 1 : 100)).toFixed(r.currency === 'JPY' ? 0 : 2) } : {}),
          description: other,
          // Firefly needs an existing asset account on the money side; the merchant side is auto-created
          ...(debit ? { source_name: asset, destination_name: other } : { source_name: other, destination_name: asset }),
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
