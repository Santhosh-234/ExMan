import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { flush, record } from '@/db/telemetry';
import { takeCounters } from './counters';
import { type EventName } from './schema';

let db: SQLiteDatabase | null = null;
export const initTelemetry = (d: SQLiteDatabase) => { db = d; };

/** Fire-and-forget. Safe to call from anywhere; does nothing before init or when telemetry is off. */
export function track(name: EventName, props: Record<string, unknown>) {
  if (db) void record(db, name, props);
}

export { countParse } from './counters';
export function emitParserStats() {
  for (const [bank, c] of takeCounters()) track('parser_stats', { bank, ...c });
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
