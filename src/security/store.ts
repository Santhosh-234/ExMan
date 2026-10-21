import type { SQLiteDatabase } from 'expo-sqlite';
import { useSyncExternalStore } from 'react';

import { getSetting, setSetting } from '@/db/queries';
import { maskState } from '@/utils/mask';

export type Security = { loaded: boolean; lock: boolean; timeoutMs: number; hide: boolean; capture: boolean };

let state: Security = { loaded: false, lock: false, timeoutMs: 0, hide: false, capture: false };
const subs = new Set<() => void>();
const set = (s: Security) => { state = s; maskState.hidden = s.hide; subs.forEach((f) => f()); };

export async function loadSecurity(db: SQLiteDatabase) {
  const [lock, timeout, hide, capture] = await Promise.all(['app_lock', 'app_lock_timeout_ms', 'hide_amounts', 'block_capture'].map((k) => getSetting(db, k)));
  set({ loaded: true, lock: lock === '1', timeoutMs: Number(timeout) || 0, hide: hide === '1', capture: capture === '1' });
}

export async function updateSecurity(db: SQLiteDatabase, patch: Partial<Omit<Security, 'loaded'>>) {
  const next = { ...state, ...patch };
  if (patch.lock !== undefined) await setSetting(db, 'app_lock', patch.lock ? '1' : '0');
  if (patch.timeoutMs !== undefined) await setSetting(db, 'app_lock_timeout_ms', String(patch.timeoutMs));
  if (patch.hide !== undefined) await setSetting(db, 'hide_amounts', patch.hide ? '1' : '0');
  if (patch.capture !== undefined) await setSetting(db, 'block_capture', patch.capture ? '1' : '0');
  set(next);
}

/** Subscribing screens re-render when hide-amounts or lock settings change. */
export function useSecurity(): Security {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => void subs.delete(cb); }, () => state, () => state);
}
