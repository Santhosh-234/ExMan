import type { SQLiteDatabase } from 'expo-sqlite';

import { type EventName, type Props, sanitize } from '@/telemetry/schema';
import { getSetting, setSetting } from './queries';

// Set at bundle time by CI once the collector exists (repo variable TELEMETRY_URL). Empty = nothing is ever uploaded.
export const ENDPOINT = process.env.EXPO_PUBLIC_TELEMETRY_URL ?? '';
const MAX_UNSENT = 500;
const MAX_SENT = 200;
const BATCH = 100;

export type TelemetryState = { enabled: boolean; noticeSeen: boolean; endpoint: string };

export async function getState(db: SQLiteDatabase): Promise<TelemetryState> {
  return {
    enabled: (await getSetting(db, 'telemetry_enabled')) !== '0', // on by default, opt-out
    noticeSeen: (await getSetting(db, 'telemetry_notice_seen')) === '1',
    endpoint: ENDPOINT,
  };
}

function randomId() {
  try {
    const a = new Uint8Array(16);
    globalThis.crypto?.getRandomValues?.(a);
    if (a.some((x) => x)) return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { /* fall through */ }
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

/** Random, unlinked to the phone, the user or any account. Reset any time. */
export async function installId(db: SQLiteDatabase) {
  let id = await getSetting(db, 'telemetry_install_id');
  if (!id) { id = randomId(); await setSetting(db, 'telemetry_install_id', id); }
  return id;
}
export async function resetInstallId(db: SQLiteDatabase) {
  const id = randomId();
  await setSetting(db, 'telemetry_install_id', id);
  return id;
}

/** Validates against the allow-list, then queues. Never throws and never records when telemetry is off. */
export async function record(db: SQLiteDatabase, name: EventName | string, props: Record<string, unknown>): Promise<boolean> {
  try {
    if ((await getSetting(db, 'telemetry_enabled')) === '0') return false;
    const e = sanitize(name, props);
    if (!e) return false;
    await db.runAsync('INSERT INTO telemetry_events (ts, name, payload) VALUES (?, ?, ?)', Date.now(), e.name, JSON.stringify(e.props));
    await db.runAsync(`DELETE FROM telemetry_events WHERE sent_at IS NULL AND id NOT IN (SELECT id FROM telemetry_events WHERE sent_at IS NULL ORDER BY id DESC LIMIT ${MAX_UNSENT})`);
    await db.runAsync(`DELETE FROM telemetry_events WHERE sent_at IS NOT NULL AND id NOT IN (SELECT id FROM telemetry_events WHERE sent_at IS NOT NULL ORDER BY id DESC LIMIT ${MAX_SENT})`);
    return true;
  } catch {
    return false;
  }
}

export type LoggedEvent = { id: number; ts: number; name: string; props: Props; sent_at: number | null };
export async function listEvents(db: SQLiteDatabase, limit = 100): Promise<LoggedEvent[]> {
  const rows = await db.getAllAsync<{ id: number; ts: number; name: string; payload: string; sent_at: number | null }>('SELECT * FROM telemetry_events ORDER BY id DESC LIMIT ?', limit);
  return rows.map((r) => ({ id: r.id, ts: r.ts, name: r.name, props: JSON.parse(r.payload) as Props, sent_at: r.sent_at }));
}

const post = async (url: string, body: unknown) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    return await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Uploads queued events. Does nothing (no network) unless telemetry is on, the user has seen the first-run
 * notice, and a collector endpoint is configured. Failures just leave events queued.
 */
export async function flush(db: SQLiteDatabase, endpoint = ENDPOINT): Promise<number> {
  const st = await getState(db);
  if (!st.enabled || !st.noticeSeen || !endpoint) return 0;
  const id = await installId(db);
  let sent = 0;
  for (;;) {
    const rows = await db.getAllAsync<{ id: number; ts: number; name: string; payload: string }>(`SELECT id, ts, name, payload FROM telemetry_events WHERE sent_at IS NULL ORDER BY id LIMIT ${BATCH}`);
    if (!rows.length) break;
    try {
      const res = await post(endpoint, { install_id: id, events: rows.map((r) => ({ ts: r.ts, name: r.name, props: JSON.parse(r.payload) })) });
      if (!res.ok) break;
    } catch { break; }
    const now = Date.now();
    await db.runAsync(`UPDATE telemetry_events SET sent_at = ? WHERE id IN (${rows.map(() => '?').join(',')})`, now, ...rows.map((r) => r.id));
    sent += rows.length;
    if (rows.length < BATCH) break;
  }
  return sent;
}

/** Turning telemetry off stops collection, drops anything queued, and asks the collector to forget this install. */
export async function setEnabled(db: SQLiteDatabase, on: boolean, endpoint = ENDPOINT) {
  await setSetting(db, 'telemetry_enabled', on ? '1' : '0');
  if (on) return;
  const id = await installId(db);
  await db.runAsync('DELETE FROM telemetry_events WHERE sent_at IS NULL');
  if (endpoint) { try { await post(`${endpoint.replace(/\/+$/, '')}/delete`, { install_id: id }); } catch { /* best effort */ } }
}

export const markNoticeSeen = (db: SQLiteDatabase) => setSetting(db, 'telemetry_notice_seen', '1');
