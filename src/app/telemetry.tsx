import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { Text } from '@/ui/Text';

import { ENDPOINT, type LoggedEvent, type TelemetryState, flush, getState, installId, listEvents, resetInstallId, setEnabled } from '@/db/telemetry';
import { BackButton, Button, Card, PageHeader } from '@/ui/kit';
import { useSnackbar } from '@/ui/Snackbar';
import { useTheme } from '@/ui/theme';

export default function Telemetry() {
  const db = useSQLiteContext();
  const router = useRouter();
  const snack = useSnackbar();
  const { colors } = useTheme();
  const [st, setSt] = useState<TelemetryState | null>(null);
  const [events, setEvents] = useState<LoggedEvent[]>([]);
  const [id, setId] = useState('');

  const load = useCallback(async () => {
    setSt(await getState(db)); setEvents(await listEvents(db, 100)); setId(await installId(db));
  }, [db]);
  useEffect(() => void load(), [load]);
  const queued = events.filter((e) => !e.sent_at).length;

  return (
    <View className="flex-1 bg-base px-4 pt-14">
      <BackButton />
      <PageHeader title="Usage data" subtitle="Anonymous and content-free. Nothing about your money, merchants or messages." />
      <ScrollView showsVerticalScrollIndicator={false}>
        <Card className="mb-4">
          <View className="flex-row items-center">
            <View className="mr-3 flex-1">
              <Text className="text-base font-semibold text-fg">Share anonymous usage data</Text>
              <Text className="mt-1 text-sm text-muted">Helps fix bugs, speed up screens and improve message reading. It never includes amounts, merchants, accounts or message text.</Text>
            </View>
            <Switch
              value={st?.enabled ?? true}
              onValueChange={async (v) => { await setEnabled(db, v); load(); snack({ message: v ? 'Usage data on' : 'Usage data off. Queued data was deleted.' }); }}
              trackColor={{ true: colors.accent, false: colors.surface2 }}
              accessibilityLabel="Share anonymous usage data"
            />
          </View>
          <Text className="mt-3 text-xs text-muted">
            {!st?.enabled ? 'Nothing is recorded or sent.' : ENDPOINT ? `${queued} event${queued === 1 ? '' : 's'} waiting to send.` : 'Recorded on this phone only for now: no server is configured, so nothing is sent.'}
          </Text>
        </Card>

        <Card className="mb-4">
          <Text className="text-base font-semibold text-fg">What is collected</Text>
          <Text className="mt-1 text-sm text-muted">App and Android version · crash types (class name only) · screen load times · which features are used (counts) · import timings · how many messages per bank were read or missed. A message is only shared as a masked template if you tap “Report a gap” and confirm.</Text>
          <Text className="mt-2 text-sm text-muted">Anonymous ID: <Text className="text-fg">{id.slice(0, 8)}…</Text></Text>
          <View className="mt-3 flex-row flex-wrap">
            <Button className="mb-2 mr-2" variant="secondary" label="Reset ID" onPress={async () => { await resetInstallId(db); load(); snack({ message: 'New anonymous ID created' }); }} />
            {ENDPOINT ? <Button className="mb-2" variant="secondary" label="Send now" onPress={async () => { const n = await flush(db); load(); snack({ message: n ? `Sent ${n} events` : 'Nothing sent' }); }} /> : null}
          </View>
        </Card>

        <Text className="mb-2 text-lg font-semibold text-fg" accessibilityRole="header">Exactly what is recorded</Text>
        {events.length === 0 && <Text className="mb-6 text-muted">Nothing recorded yet.</Text>}
        {events.map((e) => (
          <View key={e.id} className="mb-2 rounded-[22px] border border-line bg-card p-3">
            <View className="flex-row justify-between">
              <Text className="text-sm font-semibold text-fg">{e.name}</Text>
              <Text className="text-xs text-muted">{e.sent_at ? 'sent' : 'queued'} · {new Date(e.ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</Text>
            </View>
            <Text className="mt-1 text-xs text-muted">{Object.entries(e.props).map(([k, v]) => `${k}: ${v}`).join(' · ')}</Text>
          </View>
        ))}
        <View className="h-10" />
      </ScrollView>
    </View>
  );
}
