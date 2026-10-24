import type { SQLiteDatabase } from 'expo-sqlite';

import { ENDPOINT } from '@/db/telemetry';
import { getSetting, setSetting } from '@/db/queries';
import { validateLibrary } from '@/utils/formats';

// The library is served by the same project server as usage data, from `<base>/formats`. Only GET, no identifier is sent.
export const FORMATS_URL = ENDPOINT ? `${ENDPOINT.replace(/\/+$/, '')}/formats` : '';
const DAY = 864e5;

export type SyncResult = { status: 'unavailable' | 'off' | 'skipped' | 'unchanged' | 'updated' | 'invalid' | 'error'; count: number; version: number };

export async function formatsStatus(db: SQLiteDatabase) {
  return {
    available: !!FORMATS_URL,
    auto: (await getSetting(db, 'formats_auto')) !== '0',
    version: Number((await getSetting(db, 'formats_version')) ?? 0),
    count: (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM library_formats'))!.n,
    checkedAt: Number((await getSetting(db, 'formats_checked_at')) ?? 0) || null,
  };
}

/**
 * Downloads the format library at most once a day (or when asked) and replaces the local copy. Anything that fails validation is
 * ignored, so a bad file on the server can never break reading messages: the previous library stays.
 */
export async function syncFormats(db: SQLiteDatabase, opts: { force?: boolean; fetchFn?: typeof fetch; now?: number; url?: string } = {}): Promise<SyncResult> {
  const url = opts.url ?? FORMATS_URL;
  const had = await formatsStatus(db);
  const base = { count: had.count, version: had.version };
  if (!url) return { status: 'unavailable', ...base };
  if (!had.auto && !opts.force) return { status: 'off', ...base };
  const now = opts.now ?? Date.now();
  if (!opts.force && had.checkedAt && now - had.checkedAt < DAY) return { status: 'skipped', ...base };
  await setSetting(db, 'formats_checked_at', String(now));
  const etag = opts.force ? null : await getSetting(db, 'formats_etag');
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), 8000);
  try {
    const res = await (opts.fetchFn ?? fetch)(url, { headers: etag ? { 'If-None-Match': etag } : {}, signal: ctl?.signal });
    if (res.status === 304) return { status: 'unchanged', ...base };
    if (!res.ok) return { status: 'error', ...base };
    const lib = validateLibrary(await res.json());
    if (!lib) return { status: 'invalid', ...base };
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync('DELETE FROM library_formats');
      for (const f of lib.formats) {
        await tx.runAsync('INSERT INTO library_formats (lib_id, sender_key, direction, amount_re, merchant_re, account_re, currency) VALUES (?, ?, ?, ?, ?, ?, ?)', f.id, f.sender_key, f.direction, f.amount_re, f.merchant_re, f.account_re, f.currency);
      }
    });
    await setSetting(db, 'formats_version', String(lib.version));
    const tag = res.headers?.get?.('etag');
    if (tag) await setSetting(db, 'formats_etag', tag);
    return { status: 'updated', count: lib.formats.length, version: lib.version };
  } catch {
    return { status: 'error', ...base };
  } finally {
    clearTimeout(timer);
  }
}
