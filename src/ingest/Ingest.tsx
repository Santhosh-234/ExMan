import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { useSecurity } from '@/security/store';
import { AppState } from 'react-native';

import { onRaw } from '../../modules/vibe-listener';
import { backfillBills } from '@/db/bills';
import { syncHoldings } from '@/db/holdings';
import { backfillKinds } from '@/db/kinds';
import { backfillTransfers } from '@/db/transfers';
import { checkApk } from '@/updates/apk';
import { emitParserStats, initTelemetry, maybeFlush, trackAppOpen } from '@/telemetry';
import { notifyIngested } from './events';
import { refreshFormats } from './formats';
import { initNotifications, syncReminders } from '@/notify';
import { updateWidget } from '@/widget';
import { backfillAccounts, backfillMerchants, ingest, purgeOtpMessages, refreshForeignRates } from './run';

/** Mount once under SQLiteProvider: drains on launch, on foreground, and on live events. */
export function Ingest() {
  const db = useSQLiteContext();
  const sec = useSecurity();
  // changing "hide amounts" or the app lock must reach the widget and the scheduled reminders at once, not at the next message
  useEffect(() => {
    if (!sec.loaded) return;
    void updateWidget(db, Date.now(), true).catch(() => {});
    void syncReminders(db).catch(() => {});
  }, [db, sec.loaded, sec.hide, sec.lock]);
  useEffect(() => {
    initTelemetry(db);
    trackAppOpen();
    void maybeFlush();
    void checkApk(db).then(() => notifyIngested()).catch(() => {});
    initNotifications();
    // after every read: refresh the numbers the widget shows and the reminders scheduled on this phone (both swallow their own errors)
    // (also on their own at launch and on every return to the app, so a slow network step above can never keep them stale)
    const afterIngest = (force = false) => { void updateWidget(db, Date.now(), force).catch(() => {}); void syncReminders(db).catch(() => {}); };
    const early = setTimeout(() => afterIngest(true), 1500);
    const run = () => void ingest(db).then(() => refreshForeignRates(db)).then(() => refreshFormats(db)).then(() => afterIngest()).catch((e) => console.warn('ingest failed', e));
    void backfillAccounts(db).then(() => purgeOtpMessages(db)).then(() => backfillMerchants(db)).then(() => backfillKinds(db)).then(() => syncHoldings(db)).then(() => backfillBills(db)).then(() => backfillTransfers(db)).then(() => notifyIngested()).catch((e) => console.warn('backfill failed', e)).finally(run);
    const sub = onRaw(run);
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') { run(); afterIngest(true); void maybeFlush(); void checkApk(db).catch(() => {}); }
      else if (s === 'background') emitParserStats();
    });
    return () => {
      clearTimeout(early);
      sub.remove();
      app.remove();
    };
  }, [db]);
  return null;
}
