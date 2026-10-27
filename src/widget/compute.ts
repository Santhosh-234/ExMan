import type { SQLiteDatabase } from 'expo-sqlite';

import { loadForecast } from '@/db/forecast';
import { getSetting, totalFor } from '@/db/queries';
import { monthKey, monthRange } from '@/utils/format';
import { widgetLines } from './lines';

export type WidgetTexts = { title: string; amount: string; sub: string; private: boolean };

/** What the widget should say right now, from the database. No native code, so it is tested; the privacy rule lives in `widgetLines`. */
export async function computeWidget(db: SQLiteDatabase, now = Date.now()): Promise<WidgetTexts> {
  const [lock, hide] = await Promise.all([getSetting(db, 'app_lock'), getSetting(db, 'hide_amounts')]);
  const priv = lock === '1' || hide === '1';
  if (priv) return { ...widgetLines({ private: true, safeDaily: null, spentThisMonth: 0, next: null }), private: true };
  const [from, to] = monthRange(monthKey(new Date(now)));
  const [forecast, spent] = await Promise.all([loadForecast(db, now), totalFor(db, 'debit', from, to)]);
  const next = forecast?.forecast.upcoming.find((u) => u.paise < 0 && (u.kind === 'bill' || u.kind === 'recurring')) ?? null;
  return { ...widgetLines({ private: false, safeDaily: forecast?.forecast.safeDaily ?? null, spentThisMonth: spent, next: next ? { label: next.label, paise: -next.paise, ts: next.ts } : null }), private: false };
}
