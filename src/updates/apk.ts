import * as Updates from 'expo-updates';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getSetting, setSetting } from '@/db/queries';
import { type ApkUpdate, type Release, RELEASES_URL, cacheStillValid, newerApk } from '@/utils/apkUpdate';

const DAY = 864e5;
export const apkCheckEnabled = async (db: SQLiteDatabase) => (await getSetting(db, 'apk_check')) !== '0'; // on by default

/** The last result of a check, with no network. Returns null when none is known or the user dismissed that version. */
export async function cachedApkUpdate(db: SQLiteDatabase): Promise<ApkUpdate | null> {
  try {
    const raw = await getSetting(db, 'apk_available');
    const u = raw ? (JSON.parse(raw) as ApkUpdate & { forRuntime?: string }) : null;
    if (!u || !cacheStillValid(u, Updates.runtimeVersion) || (await getSetting(db, 'apk_dismissed')) === u.tag) return null; // found for an older build: this one was installed since
    return u;
  } catch { return null; }
}
export const dismissApkUpdate = (db: SQLiteDatabase, tag: string) => setSetting(db, 'apk_dismissed', tag);

/**
 * Asks GitHub's public releases list whether a newer APK exists (one small request, no identifiers sent).
 * Automatic checks run at most daily and only when the switch is on; `force` is the button in Settings.
 */
export async function checkApk(db: SQLiteDatabase, force = false): Promise<{ update: ApkUpdate | null; error?: string }> {
  if (!force) {
    if (!(await apkCheckEnabled(db))) return { update: await cachedApkUpdate(db) };
    const last = Number(await getSetting(db, 'apk_last_check')) || 0;
    const sameBuild = (await getSetting(db, 'apk_last_runtime')) === Updates.runtimeVersion; // a new install checks again straight away
    if (sameBuild && Date.now() - last < DAY) return { update: await cachedApkUpdate(db) };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' }, signal: ctl.signal });
    if (!res.ok) return { update: await cachedApkUpdate(db), error: res.status === 404 ? 'No public releases found.' : `GitHub answered ${res.status}.` };
    const update = newerApk((await res.json()) as Release[], Updates.runtimeVersion);
    await setSetting(db, 'apk_last_check', String(Date.now()));
    await setSetting(db, 'apk_last_runtime', Updates.runtimeVersion ?? '');
    await setSetting(db, 'apk_available', update ? JSON.stringify({ ...update, forRuntime: Updates.runtimeVersion }) : '');
    return { update: update && (await getSetting(db, 'apk_dismissed')) === update.tag && !force ? null : update };
  } catch (e) {
    return { update: await cachedApkUpdate(db), error: e instanceof Error && e.name === 'AbortError' ? 'The check timed out.' : 'Could not reach GitHub.' };
  } finally { clearTimeout(timer); }
}
