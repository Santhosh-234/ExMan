import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import { openBills } from '@/db/bills';
import { loadForecast } from '@/db/forecast';
import { getSetting, setSetting } from '@/db/queries';
import { getRecurring } from '@/db/recurring';
import { DEFAULT_PREFS, type ReminderPrefs, planReminders } from './plan';

const CHANNEL = 'reminders';

/** How reminders appear while the app is open: as a normal banner, without sound. */
export function initNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Reminders', description: 'Bills, renewals and low-balance warnings', importance: Notifications.AndroidImportance.DEFAULT }).catch(() => {});
  }
}

export async function getReminderPrefs(db: SQLiteDatabase): Promise<{ enabled: boolean; prefs: ReminderPrefs }> {
  const raw = await getSetting(db, 'reminders');
  let prefs = DEFAULT_PREFS;
  try { prefs = { ...DEFAULT_PREFS, ...JSON.parse((await getSetting(db, 'reminder_kinds')) ?? '{}') }; } catch { /* keep defaults */ }
  return { enabled: raw === '1', prefs };
}
export const setReminderPrefs = async (db: SQLiteDatabase, v: { enabled?: boolean; prefs?: ReminderPrefs }) => {
  if (v.enabled !== undefined) await setSetting(db, 'reminders', v.enabled ? '1' : '0');
  if (v.prefs) await setSetting(db, 'reminder_kinds', JSON.stringify(v.prefs));
};

/** Asks Android for permission (needed on Android 13 and later). */
export async function ensurePermission(): Promise<boolean> {
  const have = await Notifications.getPermissionsAsync();
  if (have.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/**
 * Replaces every scheduled reminder with a fresh plan from what the app knows right now. Cheap enough to run after each ingest and
 * whenever the app comes to the foreground. Does nothing unless reminders are on and permission was given.
 */
export async function syncReminders(db: SQLiteDatabase, now = Date.now()): Promise<number> {
  const { enabled, prefs } = await getReminderPrefs(db);
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!enabled || !(await Notifications.getPermissionsAsync()).granted) return 0;
  const [lock, hide] = await Promise.all([getSetting(db, 'app_lock'), getSetting(db, 'hide_amounts')]);
  const [bills, subs, forecast] = await Promise.all([openBills(db, now), getRecurring(db, now), loadForecast(db, now)]);
  const planned = planReminders({
    now, prefs, private: lock === '1' || hide === '1',
    bills: bills.map((b) => ({ label: b.accountName ?? (b.bank ? `${b.bank} bill` : 'Bill'), paise: b.amount_paise, dueTs: b.due_ts })),
    subs: subs.map((r) => ({ merchant: r.merchant, paise: r.amount, nextTs: r.nextTs, status: r.status })),
    shortfallTs: forecast?.forecast.shortfallTs ?? null,
  });
  for (const p of planned) {
    await Notifications.scheduleNotificationAsync({
      identifier: p.id,
      content: { title: p.title, body: p.body, data: { route: p.route } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.at, channelId: CHANNEL },
    }).catch(() => {});
  }
  return planned.length;
}

/** Shows one right away so the user can see what a reminder looks like. */
export async function sendTestReminder() {
  await Notifications.scheduleNotificationAsync({
    content: { title: 'Reminders are on', body: 'You will see bills, renewals and low-balance warnings here.', data: { route: '/' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 2, channelId: CHANNEL },
  });
}

/** The screen a tapped reminder points to (only app routes are followed). */
export const routeOf = (r: Notifications.NotificationResponse | null): string | null => {
  const route = r?.notification.request.content.data?.route;
  return typeof route === 'string' && route.startsWith('/') ? route : null;
};
export const onReminderTapped = (cb: (route: string) => void) =>
  Notifications.addNotificationResponseReceivedListener((r) => { const route = routeOf(r); if (route) cb(route); });
export const lastReminderTap = () => routeOf(Notifications.getLastNotificationResponse());
