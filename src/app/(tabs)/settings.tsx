import { useCallback, useEffect, useState } from 'react';
import { Linking, PermissionsAndroid, Pressable, ScrollView, Switch, View } from 'react-native';
import { Text, TextInput } from '@/ui/Text';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Updates from 'expo-updates';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { countUnparsed } from '@/db/patterns';
import { getSetting, setSetting } from '@/db/queries';
import { importHistory } from '@/ingest/run';
import { syncNow } from '@/sync';
import { TIMEOUTS } from '@/security/lock';
import { updateSecurity, useSecurity } from '@/security/store';
import { track } from '@/telemetry';
import { apkCheckEnabled, checkApk } from '@/updates/apk';
import { type ApkUpdate, isTrustedApkUrl } from '@/utils/apkUpdate';
import { bucketMessages, bucketMs } from '@/telemetry/schema';
import { Bell, DatabaseBackup, Landmark, ListChecks, MessageSquare, MessageSquareWarning, PiggyBank, Repeat, ShieldCheck, Store, Tags, Coins, Wallet, Smartphone } from 'lucide-react-native';
import { Button, Card, Chip, Group, NavRow } from '@/ui/kit';
import { type Mode, useTheme } from '@/ui/theme';

import { notificationAccessGranted, openNotificationAccessSettings } from '../../../modules/vibe-listener';
import { PageScroll } from '@/ui/insets';

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View className="mb-6">
      <Text className="mb-1 text-lg font-semibold text-fg" accessibilityRole="header">{title}</Text>
      {hint ? <Text className="mb-3 text-xs text-muted">{hint}</Text> : <View className="mb-2" />}
      {children}
    </View>
  );
}

function Row({ icon, label, ok, first, onPress }: { icon: typeof Bell; label: string; ok: boolean; first?: boolean; onPress: () => void }) {
  return <NavRow icon={icon} label={label} first={first} detail={ok ? 'Granted' : 'Off'} tone={ok ? undefined : 'warn'} onPress={onPress} />;
}

function SecuritySection() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const sec = useSecurity();
  const [msg, setMsg] = useState('');

  const toggleLock = async (on: boolean) => {
    setMsg('');
    if (!on) return void (await updateSecurity(db, { lock: false }));
    try {
      const level = await LocalAuthentication.getEnrolledLevelAsync();
      if (level === LocalAuthentication.SecurityLevel.NONE) return setMsg('Set a screen lock (PIN, pattern or fingerprint) in Android Settings first, then turn this on.');
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Confirm to turn on the ExMan lock', disableDeviceFallback: false });
      if (r.success) await updateSecurity(db, { lock: true });
      else setMsg('Not turned on: could not verify it is you.');
    } catch {
      setMsg('Authentication is not available on this phone.');
    }
  };

  const Row = ({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) => (
    <View className="mb-3 flex-row items-center rounded-[22px] border border-line bg-card p-4">
      <View className="mr-3 flex-1">
        <Text className="text-base text-fg">{label}</Text>
        {hint ? <Text className="mt-0.5 text-xs text-muted">{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent, false: colors.surface2 }} accessibilityLabel={label} />
    </View>
  );

  return (
    <Section title="Security" hint="Keep your money data private on this phone.">
      <Row label="Lock ExMan" hint="Ask for your fingerprint, face or phone PIN when opening the app." value={sec.lock} onChange={toggleLock} />
      {sec.lock && (
        <View className="mb-3 flex-row flex-wrap">
          {Object.entries(TIMEOUTS).map(([label, ms]) => <Chip key={label} label={label === 'immediately' ? 'Lock immediately' : `After ${label}`} color={colors.accent} selected={sec.timeoutMs === ms} onPress={() => void updateSecurity(db, { timeoutMs: ms })} />)}
        </View>
      )}
      <Row label="Hide amounts" hint="Shows •••• instead of rupee amounts. The eye on Home flips it quickly." value={sec.hide} onChange={(v) => void updateSecurity(db, { hide: v })} />
      <Row label="Block screenshots and hide in recent apps" hint="Blanks the app preview in the recent apps list and stops screenshots. Independent of the lock." value={sec.capture} onChange={(v) => void updateSecurity(db, { capture: v })} />
      {msg ? <Text className="text-sm text-warn">{msg}</Text> : null}
    </Section>
  );
}

/** Shows which build/update is running and lets the user pull a pending update without waiting for restarts. */
function AppUpdates() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(true);
  const [apkBusy, setApkBusy] = useState(false);
  const [apkMsg, setApkMsg] = useState('');
  const [apkUpdate, setApkUpdate] = useState<ApkUpdate | null>(null);
  useEffect(() => void apkCheckEnabled(db).then(setAuto), [db]);
  const checkNow = async () => {
    setApkBusy(true); setApkMsg('');
    const r = await checkApk(db, true);
    setApkUpdate(r.update);
    setApkMsg(r.error ? r.error : r.update ? `${r.update.name} is available.` : 'You have the newest APK (normal updates above cover everything else).');
    setApkBusy(false);
  };
  const running = Updates.isEmbeddedLaunch ? 'built-in version (no update applied)' : `update ${Updates.updateId?.slice(0, 8) ?? '?'} · ${Updates.createdAt?.toLocaleString('en-IN') ?? ''}`;
  const check = async () => {
    if (!Updates.isEnabled) return setMsg('Updates are disabled in this build.');
    setBusy(true);
    setMsg('Checking…');
    try {
      const r = await Updates.checkForUpdateAsync();
      if (!r.isAvailable) {
        setMsg('You have the latest update.');
      } else {
        setMsg('Downloading update…');
        await Updates.fetchUpdateAsync();
        setMsg('Restarting…');
        await Updates.reloadAsync();
      }
    } catch (e) {
      setMsg(`Update check failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="App updates" hint="Updates download in the background; tap below to get the newest one now.">
      <Card className="mb-3">
        <Text className="text-sm text-muted">Running: <Text className="text-fg">{running}</Text></Text>
        <Text className="mt-1 text-sm text-muted">Channel: <Text className="text-fg">{Updates.channel ?? 'none'}</Text> · Runtime: <Text className="text-fg">{Updates.runtimeVersion?.slice(0, 8) ?? 'n/a'}</Text></Text>
      </Card>
      <Button label={busy ? 'Working…' : 'Check for updates'} variant="secondary" disabled={busy} onPress={check} />
      {msg ? <Text className="mt-2 text-sm text-muted">{msg}</Text> : null}

      <Card className="mt-4">
        <View className="flex-row items-center">
          <View className="mr-3 flex-1">
            <Text className="text-base font-semibold text-fg">New app versions (APK)</Text>
            <Text className="mt-1 text-sm text-muted">Some changes need a fresh install file. ExMan can look at this project's public releases on GitHub once a day and tell you when one is out. Nothing about you or your data is sent.</Text>
          </View>
          <Switch value={auto} onValueChange={async (v) => { setAuto(v); await setSetting(db, 'apk_check', v ? '1' : '0'); }} trackColor={{ true: colors.accent, false: colors.surface2 }} accessibilityLabel="Check for new app versions automatically" />
        </View>
        <Button className="mt-3" variant="secondary" label={apkBusy ? 'Checking…' : 'Check for a new APK now'} disabled={apkBusy} onPress={checkNow} />
        {apkMsg ? <Text className="mt-2 text-sm text-muted">{apkMsg}</Text> : null}
        {apkUpdate && isTrustedApkUrl(apkUpdate.url) ? <Button className="mt-2" label={`Download ${apkUpdate.name}${apkUpdate.sizeMb ? ` (${apkUpdate.sizeMb} MB)` : ''}`} onPress={() => void Linking.openURL(apkUpdate.url)} /> : null}
      </Card>
    </Section>
  );
}

export default function Settings() {
  const [sms, setSms] = useState(false);
  const [notif, setNotif] = useState(false);
  const db = useSQLiteContext();
  const router = useRouter();
  const { mode: themeMode, setMode: setThemeMode, colors } = useTheme();
  const [endpoint, setEndpoint] = useState('');
  const [token, setToken] = useState('');
  const [mode, setMode] = useState('rest');
  const [ffAccount, setFfAccount] = useState('');
  const [status, setStatus] = useState('');
  const [readSms, setReadSms] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [unparsed, setUnparsed] = useState(0);
  // re-check when returning from the system settings screen
  useFocusEffect(
    useCallback(() => {
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS).then(setSms);
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS).then(setReadSms);
      setNotif(notificationAccessGranted());
      void countUnparsed(db).then(setUnparsed);
      (async () => {
        setEndpoint(await getSetting(db, 'sync_endpoint'));
        setToken(await getSetting(db, 'sync_token'));
        setMode((await getSetting(db, 'sync_mode')) || 'rest');
        setFfAccount(await getSetting(db, 'sync_firefly_account'));
      })();
    }, [db]),
  );

  return (
    <PageScroll tab keyboardShouldPersistTaps="handled">
      <Text className="mb-6 text-3xl font-bold text-fg" accessibilityRole="header">Settings</Text>

      <Section title="Appearance" hint="System follows your phone's light/dark setting.">
        <View className="flex-row">
          {([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']] as [Mode, string][]).map(([m, label]) => (
            <Chip key={m} label={label} color={colors.accent} selected={themeMode === m} onPress={() => { setThemeMode(m); track('feature_used', { feature: 'theme_changed' }); }} />
          ))}
        </View>
      </Section>

      <Section title="Accounts" hint="Banks, cards and cash found from your messages.">
        <Group>
          <NavRow first icon={Landmark} label="Manage accounts" onPress={() => router.push('/accounts')} />
          <NavRow icon={ListChecks} label="Books check" onPress={() => router.push('/ledger')} />
        </Group>
      </Section>

      <Section title="Categorisation" hint="How ExMan groups payees and picks categories.">
        <Group>
          {([['/merchants', 'Merchants', Store, ''], ['/rules', 'Rules', ListChecks, ''], ['/budgets', 'Budgets', PiggyBank, ''], ['/subscriptions', 'Subscriptions', Repeat, ''], ['/categories', 'Categories', Tags, ''], ['/rates', 'Exchange rates', Coins, ''], ['/unrecognised', 'Unrecognised messages', MessageSquareWarning, unparsed ? `${unparsed} to teach` : '']] as const).map(([href, label, icon, detail], i) => (
            <NavRow key={href} first={i === 0} icon={icon} label={label} detail={detail || undefined} tone={detail ? 'warn' : undefined} onPress={() => router.push(href)} />
          ))}
        </Group>
      </Section>

      <SecuritySection />

      <Section title="Backup & export" hint="Encrypted backup you can restore on a new phone, and CSV for spreadsheets.">
        <Group><NavRow first icon={DatabaseBackup} label="Backup, restore and export" onPress={() => router.push('/backup')} /></Group>
      </Section>

      <Section title="Privacy & data" hint="What ExMan reads, how long originals are kept, and a full wipe.">
        <Group><NavRow first icon={ShieldCheck} label="Privacy & data" onPress={() => router.push('/privacy')} /></Group>
      </Section>

      <AppUpdates />

      <Section title="Permissions" hint="Notification access greyed out on Android 13+? Open App info, tap ⋮, choose “Allow restricted settings”, then try again.">
      <Group>
      <Row
        first
        icon={MessageSquare}
        label="Read bank SMS"
        ok={sms}
        onPress={async () =>
          setSms((await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS)) === 'granted')
        }
      />
      <Row
        icon={MessageSquare}
        label="Read old SMS (for import)"
        ok={readSms}
        onPress={async () =>
          setReadSms((await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS)) === 'granted')
        }
      />
      <Row icon={Smartphone} label="UPI app notifications" ok={notif} onPress={openNotificationAccessSettings} />
      </Group>
      </Section>

      <Section title="Import past SMS" hint="Scans bank/card messages already in your inbox (not personal chats) and adds them to the Inbox for review.">
      <View className="mb-2 flex-row">
        {[30, 90, 365].map((d) => (
          <Button
            key={d}
            variant="secondary"
            className="mr-2"
            label={d === 365 ? '1 year' : `${d} days`}
            onPress={async () => {
              if (!readSms) return setImportMsg('Grant "Read old SMS" first');
              setImportMsg('Importing…');
              try {
                const t0 = Date.now();
                const n = await importHistory(db, d, (done, total) => setImportMsg(`Importing… ${done}/${total}`));
                track('import_completed', { days: d, messages: bucketMessages(n), ms: bucketMs(Date.now() - t0) });
                track('feature_used', { feature: 'history_import' });
                setImportMsg(`Added ${n} transactions to the Inbox`);
              } catch (e) {
                setImportMsg(e instanceof Error ? e.message : 'Import failed');
              }
            }}
          />
        ))}
      </View>
      {importMsg ? <Text className="mb-2 text-muted">{importMsg}</Text> : null}
      </Section>

      <Section title="Sync (optional)" hint="Push confirmed transactions to your own server. Data stays on this phone unless you set this up.">
      <View className="mb-3 flex-row">
        {(['rest', 'firefly'] as const).map((m) => (
          <Chip key={m} label={m === 'rest' ? 'Custom REST' : 'Firefly III'} color={colors.accent} selected={mode === m} onPress={() => setMode(m)} />
        ))}
      </View>
      <TextInput className="mb-3 min-h-12 rounded-2xl bg-card px-4 py-3 text-base text-fg" value={endpoint} onChangeText={setEndpoint} autoCapitalize="none" autoCorrect={false} placeholder="https://your-server/endpoint" placeholderTextColor={colors.muted} />
      {mode === 'firefly' && (
        <TextInput className="mb-3 min-h-12 rounded-2xl bg-card px-4 py-3 text-base text-fg" value={ffAccount} onChangeText={setFfAccount} placeholder="Firefly asset account name, e.g. Indian Bank" placeholderTextColor={colors.muted} />
      )}
      <TextInput className="mb-3 min-h-12 rounded-2xl bg-card px-4 py-3 text-base text-fg" value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="Access token" placeholderTextColor={colors.muted} />
      <Button
        label="Save & sync now"
        onPress={async () => {
          try {
            await setSetting(db, 'sync_endpoint', endpoint.trim());
            await setSetting(db, 'sync_token', token.trim());
            await setSetting(db, 'sync_mode', mode);
            await setSetting(db, 'sync_firefly_account', ffAccount.trim());
            setStatus('Syncing…');
            const n = await syncNow(db);
            setStatus(n ? `Synced ${n} transactions` : 'Nothing to sync');
          } catch (e) {
            setStatus(e instanceof Error ? e.message : 'Sync failed');
          }
        }}
      />
      {status ? <Text className="mt-3 text-muted">{status}</Text> : null}
      </Section>
      <Pressable onPress={() => router.push('/dev')} accessibilityRole="button" className="mt-8"><Text className="text-muted">Developer tools</Text></Pressable>
      <View className="h-8" />
    </PageScroll>
  );
}
