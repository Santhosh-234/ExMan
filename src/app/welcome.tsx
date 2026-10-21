import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Linking, PermissionsAndroid, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { setEnabled, markNoticeSeen, getState } from '@/db/telemetry';
import { setSetting } from '@/db/queries';
import { importHistory } from '@/ingest/run';
import { track } from '@/telemetry';
import { bucketMessages, bucketMs } from '@/telemetry/schema';
import { Button, Card } from '@/ui/kit';
import { useTheme } from '@/ui/theme';

import { notificationAccessGranted, openNotificationAccessSettings } from '../../modules/vibe-listener';

const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <View className="mb-6">
    <Text className="mb-2 text-lg font-semibold text-fg" accessibilityRole="header">{n}. {title}</Text>
    {children}
  </View>
);

const Perm = ({ label, ok, onPress }: { label: string; ok: boolean; onPress: () => void }) => (
  <Pressable onPress={onPress} accessibilityRole="button" className="mb-2 min-h-14 flex-row items-center justify-between rounded-2xl bg-card p-4">
    <Text className="flex-1 text-base text-fg">{label}</Text>
    <Text className={ok ? 'text-accent' : 'text-warn'}>{ok ? 'Granted' : 'Tap to allow'}</Text>
  </Pressable>
);

/** First-run walkthrough: what ExMan does, why each permission is needed, optional import, and the usage-data notice. */
export default function Welcome() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useTheme();
  const [sms, setSms] = useState(false);
  const [notif, setNotif] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [telemetry, setTelemetry] = useState(true);

  useFocusEffect(useCallback(() => {
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS).then(setSms);
    setNotif(notificationAccessGranted());
    void getState(db).then((s) => setTelemetry(s.enabled));
  }, [db]));

  const finish = async () => {
    await setEnabled(db, telemetry);
    await markNoticeSeen(db); // events are never uploaded before this point
    await setSetting(db, 'onboarded', '1');
    router.replace('/');
  };

  return (
    <ScrollView className="flex-1 bg-base px-4 pt-16" showsVerticalScrollIndicator={false}>
      <Text className="text-3xl font-bold text-fg" accessibilityRole="header">Welcome to ExMan</Text>
      <Text className="mb-6 mt-2 text-base text-muted">Your money, tracked for you, seen only by you. ExMan reads the bank and UPI alerts already on your phone, so you never type an expense. Everything stays on this phone.</Text>

      <Step n={1} title="Let ExMan see your alerts">
        <Perm
          label="Read bank SMS (new and past)"
          ok={sms}
          onPress={async () => {
            const r = await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.RECEIVE_SMS, PermissionsAndroid.PERMISSIONS.READ_SMS]);
            setSms(r['android.permission.READ_SMS'] === 'granted');
          }}
        />
        <Text className="mb-3 px-1 text-xs text-muted">Only messages from bank-style sender names are used. Personal chats are never read.</Text>
        <Perm label="UPI app notifications (GPay, PhonePe, Paytm)" ok={notif} onPress={openNotificationAccessSettings} />
        <Card className="mb-2">
          <Text className="text-sm text-muted">If the notification switch is greyed out (Android 13 and later): open ExMan's App info, tap the ⋮ menu, choose “Allow restricted settings”, then try again.</Text>
          <Button className="mt-3" variant="secondary" label="Open App info" onPress={() => void Linking.openSettings()} />
        </Card>
      </Step>

      <Step n={2} title="Bring in past messages (optional)">
        <View className="flex-row flex-wrap">
          {[30, 90, 365].map((d) => (
            <Button key={d} className="mb-2 mr-2" variant="secondary" label={d === 365 ? 'Last year' : `Last ${d} days`} onPress={async () => {
              if (!sms) return setImportMsg('Allow reading SMS first (step 1).');
              setImportMsg('Importing…');
              try {
                const t0 = Date.now();
                const n = await importHistory(db, d, (a, b) => setImportMsg(`Importing… ${a}/${b}`));
                track('import_completed', { days: d, messages: bucketMessages(n), ms: bucketMs(Date.now() - t0) });
                setImportMsg(`Added ${n} transactions. You'll review them on Home.`);
              } catch (e) { setImportMsg(e instanceof Error ? e.message : 'Import failed'); }
            }} />
          ))}
        </View>
        {importMsg ? <Text className="text-sm text-muted">{importMsg}</Text> : null}
      </Step>

      <Step n={3} title="Help improve ExMan">
        <Card>
          <View className="flex-row items-center">
            <View className="mr-3 flex-1">
              <Text className="text-base font-semibold text-fg">Share anonymous usage data</Text>
              <Text className="mt-1 text-sm text-muted">On by default. Crash types, screen speeds and feature counts, with a random ID. Never amounts, merchants, accounts or message text. You can turn it off here or any time in Settings.</Text>
            </View>
            <Switch value={telemetry} onValueChange={setTelemetry} trackColor={{ true: colors.accent, false: colors.surface2 }} accessibilityLabel="Share anonymous usage data" />
          </View>
          <Pressable onPress={() => router.push('/telemetry')} accessibilityRole="button" className="mt-2 min-h-9 justify-center"><Text className="text-accent">See exactly what is sent</Text></Pressable>
        </Card>
      </Step>

      <Button label="Get started" onPress={finish} className="mb-12" />
    </ScrollView>
  );
}
