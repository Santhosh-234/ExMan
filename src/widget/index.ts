import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import { setWidget } from '../../modules/vibe-listener';
import { loadForecast } from '@/db/forecast';
import { getSetting } from '@/db/queries';
import { totalFor } from '@/db/queries';
import { widgetLines } from './lines';
import { monthKey, monthRange } from '@/utils/format';

let last = 0;

/** Writes the three lines the home-screen widget shows. Throttled; never throws (a widget must not break the app). */
export async function updateWidget(db: SQLiteDatabase, now = Date.now(), force = false): Promise<void> {
  if (Platform.OS !== 'android' || (!force && now - last < 60_000)) return;
  last = now;
  try {
    const [lock, hide] = await Promise.all([getSetting(db, 'app_lock'), getSetting(db, 'hide_amounts')]);
    const [from, to] = monthRange(monthKey(new Date(now)));
    const [forecast, spent] = await Promise.all([loadForecast(db, now), totalFor(db, 'debit', from, to)]);
    const next = forecast?.forecast.upcoming.find((u) => u.paise < 0 && (u.kind === 'bill' || u.kind === 'recurring')) ?? null;
    const l = widgetLines({ private: lock === '1' || hide === '1', safeDaily: forecast?.forecast.safeDaily ?? null, spentThisMonth: spent, next: next ? { label: next.label, paise: -next.paise, ts: next.ts } : null });
    setWidget(l.title, l.amount, l.sub);
  } catch { /* leave the widget as it was */ }
}
