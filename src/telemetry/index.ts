import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { flush, record } from '@/db/telemetry';
import { type EventName } from './schema';

let db: SQLiteDatabase | null = null;
export const initTelemetry = (d: SQLiteDatabase) => { db = d; };

/** Fire-and-forget. Safe to call from anywhere; does nothing before init or when telemetry is off. */
export function track(name: EventName, props: Record<string, unknown>) {
  if (db) void record(db, name, props);
}

// parser outcomes are counted in memory and emitted as one event per bank (never per message)
const counters = new Map<string, { parsed: number; unrecognised: number; taught: number }>();
export function countParse(bank: string | null, kind: 'parsed' | 'unrecognised' | 'taught') {
  const k = bank ?? 'none';
  const c = counters.get(k) ?? { parsed: 0, unrecognised: 0, taught: 0 };
  c[kind]++;
  counters.set(k, c);
}
export function emitParserStats() {
  for (const [bank, c] of counters) track('parser_stats', { bank, ...c });
  counters.clear();
}

export function trackAppOpen() {
  track('app_open', {
    version: Constants.expoConfig?.version ?? '0.0.0',
    runtime: (Updates.runtimeVersion ?? '').slice(0, 8),
    update: Updates.isEmbeddedLaunch ? 'embedded' : 'ota',
    os_version: Number(Platform.Version) || 0,
  });
}

let lastFlush = 0;
/** At most every 6 hours. */
export async function maybeFlush() {
  if (!db || Date.now() - lastFlush < 6 * 3600_000) return;
  lastFlush = Date.now();
  await flush(db).catch(() => 0);
}

/** Records only the error's class name (never its message or stack, which could contain data). */
export function installErrorReporting(currentScreen: () => string) {
  const g = globalThis as unknown as { ErrorUtils?: { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void } };
  const prev = g.ErrorUtils?.getGlobalHandler();
  g.ErrorUtils?.setGlobalHandler((e, fatal) => {
    const code = e instanceof Error ? e.name.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 60) : 'unknown';
    track('error', { kind: 'js_error', screen: currentScreen(), code });
    prev?.(e, fatal);
  });
}
