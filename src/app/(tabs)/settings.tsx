import { useCallback, useState } from 'react';
import { PermissionsAndroid, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { getSetting, setSetting } from '@/db/queries';
import { importHistory } from '@/ingest/run';
import { syncNow } from '@/sync';

import { notificationAccessGranted, openNotificationAccessSettings } from '../../../modules/vibe-listener';

function Row({ label, ok, onPress }: { label: string; ok: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="mb-3 flex-row items-center justify-between rounded-2xl bg-card p-4">
      <Text className="text-base text-white">{label}</Text>
      <Text className={ok ? 'text-accent' : 'text-amber-400'}>{ok ? 'Granted' : 'Tap to enable'}</Text>
    </Pressable>
  );
}

export default function Settings() {
  const [sms, setSms] = useState(false);
  const [notif, setNotif] = useState(false);
  const db = useSQLiteContext();
  const [endpoint, setEndpoint] = useState('');
  const [token, setToken] = useState('');
  const [mode, setMode] = useState('rest');
  const [ffAccount, setFfAccount] = useState('');
  const [status, setStatus] = useState('');
  const [readSms, setReadSms] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  // re-check when returning from the system settings screen
  useFocusEffect(
    useCallback(() => {
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS).then(setSms);
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS).then(setReadSms);
      setNotif(notificationAccessGranted());
      (async () => {
        setEndpoint(await getSetting(db, 'sync_endpoint'));
        setToken(await getSetting(db, 'sync_token'));
        setMode((await getSetting(db, 'sync_mode')) || 'rest');
        setFfAccount(await getSetting(db, 'sync_firefly_account'));
      })();
    }, [db]),
  );

  return (
    <ScrollView className="flex-1 bg-base px-4 pt-16">
      <Text className="mb-6 text-2xl font-semibold text-white">Settings</Text>
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

      <Text className="mb-2 mt-6 text-lg font-semibold text-white">Import past SMS</Text>
      <Text className="mb-3 text-xs text-gray-400">
        Scans bank/card messages already in your inbox (not personal chats) and adds them to the Inbox for review.
      </Text>
      <View className="mb-2 flex-row">
        {[30, 90, 365].map((d) => (
          <Pressable
            key={d}
            className="mr-2 rounded-xl bg-card px-4 py-2"
            onPress={async () => {
              if (!readSms) return setImportMsg('Grant "Read old SMS" first');
              setImportMsg('Importing…');
              try {
                const n = await importHistory(db, d);
                setImportMsg(`Added ${n} transactions to the Inbox`);
              } catch (e) {
                setImportMsg(e instanceof Error ? e.message : 'Import failed');
              }
            }}>
            <Text className="text-white">{d === 365 ? '1 year' : `${d} days`}</Text>
          </Pressable>
        ))}
      </View>
      {importMsg ? <Text className="mb-2 text-gray-300">{importMsg}</Text> : null}

      <Text className="mb-2 mt-6 text-lg font-semibold text-white">Sync (optional)</Text>
      <Text className="mb-3 text-xs text-gray-400">
        Push confirmed transactions to your own server. Data stays on this phone unless you set this up.
      </Text>
      <View className="mb-3 flex-row">
        {(['rest', 'firefly'] as const).map((m) => (
          <Pressable key={m} onPress={() => setMode(m)} className="mr-2 rounded-full px-3 py-1" style={{ backgroundColor: mode === m ? '#10B981' : '#1F2937' }}>
            <Text className="text-xs text-white">{m === 'rest' ? 'Custom REST' : 'Firefly III'}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput className="mb-3 rounded-xl bg-card px-3 py-2 text-white" value={endpoint} onChangeText={setEndpoint} autoCapitalize="none" autoCorrect={false} placeholder="https://your-server/endpoint" placeholderTextColor="#6B7280" />
      {mode === 'firefly' && (
        <TextInput className="mb-3 rounded-xl bg-card px-3 py-2 text-white" value={ffAccount} onChangeText={setFfAccount} placeholder="Firefly asset account name, e.g. Indian Bank" placeholderTextColor="#6B7280" />
      )}
      <TextInput className="mb-3 rounded-xl bg-card px-3 py-2 text-white" value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="Access token" placeholderTextColor="#6B7280" />
      <Pressable
        className="rounded-xl bg-accent px-4 py-3"
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
        }}>
        <Text className="text-center font-semibold text-base">Save & sync now</Text>
      </Pressable>
      {status ? <Text className="mt-3 text-gray-300">{status}</Text> : null}
      <View className="h-8" />
    </ScrollView>
  );
}
