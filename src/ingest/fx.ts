import type { SQLiteDatabase } from 'expo-sqlite';

import { type FetchRate, ONLINE_CODES, localDay, makeFetchRate, paiseAt } from '@/utils/fx';
import { notifyIngested } from './events';

export type FxRefresh = { updated: number; fetched: number; failed: number; skipped: number };

/**
 * Replaces the approximate rupee amount of foreign spends with the amount at that day's published exchange rate.
 *  - only rows still on the built-in approximation are touched (never your own rate, never an amount you typed);
 *  - rows already pushed to a sync server keep their amount, so the server does not get a second, different copy;
 *  - one request per distinct (day, currency), cached, at most `limit` per run; it gives up after three failures in a row (offline).
 * Safe to run any time and as often as you like.
 */
export async function refreshForeignRates(db: SQLiteDatabase, opts: { fetchRate?: FetchRate; limit?: number; force?: boolean } = {}): Promise<FxRefresh> {
  const out: FxRefresh = { updated: 0, fetched: 0, failed: 0, skipped: 0 };
  if (!opts.force && (await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'fx_online'"))?.value === '0') return out;
  // offline or the service is down: do not retry on every app foreground
  const wait = Number((await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'fx_retry_after'"))?.value) || 0;
  if (!opts.force && Date.now() < wait) return out;
  const fetchRate = opts.fetchRate ?? makeFetchRate();
  const userSet = new Set((await db.getAllAsync<{ key: string }>("SELECT key FROM settings WHERE key LIKE 'fx\\_%' ESCAPE '\\' AND key != 'fx_online'")).map((r) => r.key.slice(3)));

  const rows = await db.getAllAsync<{ id: number; currency: string; foreign_minor: number; ts: number }>(
    "SELECT id, currency, foreign_minor, ts FROM transactions WHERE currency IS NOT NULL AND foreign_minor IS NOT NULL AND (fx_source IS NULL OR fx_source = 'default') AND synced_at IS NULL AND status != 'dismissed' ORDER BY ts DESC LIMIT 500",
  );
  const todo = rows.filter((r) => ONLINE_CODES.includes(r.currency) && !userSet.has(r.currency));
  out.skipped = rows.length - todo.length;

  const rates = new Map<string, number | null>();
  const key = (day: string, code: string) => `${day}|${code}`;
  let budget = opts.limit ?? 40;
  let strikes = 0;
  for (const r of todo) {
    const day = localDay(r.ts);
    const k = key(day, r.currency);
    if (!rates.has(k)) {
      const cached = (await db.getFirstAsync<{ rate: number }>('SELECT rate FROM fx_rates WHERE day = ? AND code = ?', day, r.currency))?.rate;
      if (cached) rates.set(k, cached);
      else if (budget <= 0 || strikes >= 3) rates.set(k, null);
      else {
        budget--;
        const rate = await fetchRate(day, r.currency).catch(() => null);
        if (rate) {
          strikes = 0; out.fetched++;
          await db.runAsync('INSERT OR REPLACE INTO fx_rates (day, code, rate, fetched_at) VALUES (?, ?, ?, ?)', day, r.currency, rate, Date.now());
        } else { strikes++; out.failed++; }
        rates.set(k, rate ?? null);
      }
    }
    const rate = rates.get(k);
    if (!rate) continue;
    await db.runAsync("UPDATE transactions SET amount_paise = ?, fx_rate = ?, fx_source = 'online', updated_at = ? WHERE id = ?", paiseAt(r.foreign_minor, r.currency, rate), rate, Date.now(), r.id);
    out.updated++;
  }
  if (out.failed && !out.fetched) await db.runAsync("INSERT INTO settings (key, value) VALUES ('fx_retry_after', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(Date.now() + 30 * 60_000));
  else if (out.fetched) await db.runAsync("DELETE FROM settings WHERE key = 'fx_retry_after'");
  if (out.updated) notifyIngested();
  return out;
}
