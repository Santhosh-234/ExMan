import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import { setWidget } from '../../modules/vibe-listener';
import { setSetting } from '@/db/queries';
import { computeWidget } from './compute';

let last = 0;

/**
 * Writes the three lines the home-screen widget shows and records what happened (setting `widget_status`, shown in Developer tools),
 * so a widget that stays empty can be diagnosed instead of failing silently. Throttled unless `force`; never throws.
 */
export async function updateWidget(db: SQLiteDatabase, now = Date.now(), force = false, set: typeof setWidget = setWidget): Promise<string> {
  if (Platform.OS !== 'android') return 'not android';
  if (!force && now - last < 60_000) return 'skipped (updated a moment ago)';
  last = now;
  let status: string;
  try {
    const t = await computeWidget(db, now);
    set(t.title, t.amount, t.sub);
    status = `sent: ${t.title} | ${t.amount}${t.sub ? ` | ${t.sub}` : ''}`;
  } catch (e) {
    status = `error: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`.slice(0, 200);
  }
  await setSetting(db, 'widget_status', `${new Date().toLocaleString('en-IN')} · ${status}`).catch(() => {});
  return status;
}
