import { useCallback, useState } from 'react';
import { PermissionsAndroid, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as Updates from 'expo-updates';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { countUnparsed } from '@/db/patterns';
import { getSetting, setSetting } from '@/db/queries';
import { importHistory } from '@/ingest/run';
import { syncNow } from '@/sync';
import { track } from '@/telemetry';
import { bucketMessages, bucketMs } from '@/telemetry/schema';
import { Button, Card, Chip } from '@/ui/kit';
import { type Mode, useTheme } from '@/ui/theme';

import { notificationAccessGranted, openNotificationAccessSettings } from '../../../modules/vibe-listener';

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View className="mb-6">
      <Text className="mb-1 text-lg font-semibold text-fg" accessibilityRole="header">{title}</Text>
      {hint ? <Text className="mb-3 text-xs text-muted">{hint}</Text> : <View className="mb-2" />}
      {children}
    </View>
  );
}

function Row({ label, ok, onPress }: { label: string; ok: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" className="mb-3 min-h-14 flex-row items-center justify-between rounded-2xl bg-card p-4">
      <Text className="text-base text-fg">{label}</Text>
      <Text className={ok ? 'text-accent' : 'text-warn'}>{ok ? 'Granted' : 'Tap to enable'}</Text>
    </Pressable>
  );
}

/** Shows which build/update is running and lets the user pull a pending update without waiting for restarts. */
function AppUpdates() {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
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
    <ScrollView className="flex-1 bg-base px-4 pt-14">
      <Text className="mb-6 text-3xl font-bold text-fg" accessibilityRole="header">Settings</Text>

      <Section title="Appearance" hint="System follows your phone's light/dark setting.">
        <View className="flex-row">
          {([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']] as [Mode, string][]).map(([m, label]) => (
            <Chip key={m} label={label} color={colors.accent} selected={themeMode === m} onPress={() => { setThemeMode(m); track('feature_used', { feature: 'theme_changed' }); }} />
          ))}
        </View>
      </Section>

      <Section title="Accounts" hint="Banks, cards and cash found from your messages.">
        <Pressable onPress={() => router.push('/accounts')} accessibilityRole="button" className="min-h-14 flex-row items-center justify-between rounded-2xl bg-card p-4">
          <Text className="text-base text-fg">Manage accounts</Text>
          <Text className="text-accent">Open</Text>
        </Pressable>
      </Section>

      <Section title="Categorisation" hint="How ExMan groups payees and picks categories.">
        {([['/merchants', 'Merchants', ''], ['/rules', 'Rules', ''], ['/categories', 'Categories', ''], ['/rates', 'Exchange rates', ''], ['/unrecognised', 'Unrecognised messages', unparsed ? String(unparsed) : '']] as const).map(([href, label, badge]) => (
          <Pressable key={href} onPress={() => router.push(href)} accessibilityRole="button" className="mb-3 min-h-14 flex-row items-center justify-between rounded-2xl bg-card p-4">
            <Text className="text-base text-fg">{label}</Text>
            <Text className={badge ? 'text-warn' : 'text-accent'}>{badge ? `${badge} to teach` : 'Open'}</Text>
          </Pressable>
        ))}
      </Section>

      <Section title="Privacy & data" hint="What ExMan reads, how long originals are kept, and a full wipe.">
        <Pressable onPress={() => router.push('/privacy')} accessibilityRole="button" className="min-h-14 flex-row items-center justify-between rounded-2xl bg-card p-4">
          <Text className="text-base text-fg">Privacy & data</Text>
          <Text className="text-accent">Open</Text>
        </Pressable>
      </Section>

      <AppUpdates />

      <Text className="mb-1 text-lg font-semibold text-fg" accessibilityRole="header">Permissions</Text>
      <Text className="mb-3 text-xs text-muted">Notification access greyed out on Android 13+? Open App info, tap ⋮, choose “Allow restricted settings”, then try again.</Text>
      <Row
        label="Read bank SMS"
        ok={sms}
        onPress={async () =>
          setSms((await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS)) === 'granted')
        }
      />
      <Row
        label="Read old SMS (for import)"
        ok={readSms}
        onPress={async () =>
          setReadSms((await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS)) === 'granted')
        }
      />
      <Row label="UPI app notifications" ok={notif} onPress={openNotificationAccessSettings} />

      <Text className="mb-1 mt-4 text-lg font-semibold text-fg" accessibilityRole="header">Import past SMS</Text>
      <Text className="mb-3 text-xs text-muted">
        Scans bank/card messages already in your inbox (not personal chats) and adds them to the Inbox for review.
      </Text>
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

      <Text className="mb-1 mt-6 text-lg font-semibold text-fg" accessibilityRole="header">Sync (optional)</Text>
      <Text className="mb-3 text-xs text-muted">
        Push confirmed transactions to your own server. Data stays on this phone unless you set this up.
      </Text>
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
      <Pressable onPress={() => router.push('/dev')} className="mt-8"><Text className="text-muted">Developer tools</Text></Pressable>
      <View className="h-8" />
    </ScrollView>
  );
}
