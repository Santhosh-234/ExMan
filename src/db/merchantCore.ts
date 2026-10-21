import type { SQLiteDatabase } from 'expo-sqlite';

import { normalizeMerchant } from '@/utils/merchants';

export type Merchant = { id: number; key: string; name: string };
export type MerchantCache = Map<string, Merchant>; // normalized key -> final merchant

async function finalMerchant(db: SQLiteDatabase, id: number): Promise<Merchant> {
  let cur = id;
  for (let i = 0; i < 10; i++) {
    const m = await db.getFirstAsync<Merchant & { merged_into: number | null }>('SELECT id, key, name, merged_into FROM merchants WHERE id = ?', cur);
    if (!m) throw new Error('merchant missing');
    if (!m.merged_into) return { id: m.id, key: m.key, name: m.name };
    cur = m.merged_into;
  }
  throw new Error('merchant merge loop');
}

/** Finds or creates the merchant for a raw payee string, following merges. Null if the string has no usable name. */
export async function ensureMerchant(db: SQLiteDatabase, raw: string | null, cache?: MerchantCache): Promise<Merchant | null> {
  const n = raw ? normalizeMerchant(raw) : null;
  if (!n) return null;
  const hit = cache?.get(n.key);
  if (hit) return hit;
  await db.runAsync('INSERT OR IGNORE INTO merchants (key, name) VALUES (?, ?)', n.key, n.name);
  const row = await db.getFirstAsync<{ id: number }>('SELECT id FROM merchants WHERE key = ?', n.key);
  const m = await finalMerchant(db, row!.id);
  cache?.set(n.key, m);
  return m;
}

