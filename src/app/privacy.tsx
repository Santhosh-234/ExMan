import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/ui/Text';

import { deleteAllData, purgeRawText, readSummary } from '@/db/data';
import { notifyIngested } from '@/ingest/events';
import { BarChart3 } from 'lucide-react-native';
import { BackButton, Button, Card, Group, NavRow, PageHeader, Sheet } from '@/ui/kit';
import { useSnackbar } from '@/ui/Snackbar';
import { useTheme } from '@/ui/theme';
import { Page } from '@/ui/insets';

export default function Privacy() {
  const db = useSQLiteContext();
  const router = useRouter();
  const snack = useSnackbar();
  const { colors } = useTheme();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof readSummary>>>([]);
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setRows(await readSummary(db)), [db]);
  useEffect(() => void load(), [load]);
  const total = rows.reduce((a, r) => a + r.n, 0);
  const withText = rows.reduce((a, r) => a + r.with_text, 0);

  const purge = async (days: number) => {
    const n = await purgeRawText(db, days);
    load();
    snack({ message: n ? `Removed the original text from ${n} transaction${n === 1 ? '' : 's'}` : 'Nothing older than that to remove' });
  };

  return (
    <Page>
      <BackButton />
      <PageHeader title="Privacy & data" subtitle="What ExMan reads, what it keeps, and how to remove it." />
      <ScrollView showsVerticalScrollIndicator={false}>
        <Card className="mb-4">
          <Text className="text-base font-semibold text-fg">What ExMan reads</Text>
          <Text className="mt-1 text-sm text-muted">Only messages from bank-style sender names (like VM-INDBNK-S) and payment notifications from GPay, PhonePe and Paytm. Personal chats are never read. Everything stays on this phone unless you set up sync.</Text>
          <Text className="mb-1 mt-3 text-xs uppercase tracking-wider text-muted">Stored so far</Text>
          {rows.length === 0 && <Text className="text-muted">Nothing yet.</Text>}
          {rows.map((r, i) => (
            <View key={i} className="mb-1 flex-row justify-between">
              <Text className="text-fg">{r.bank ?? 'Unknown bank'} <Text className="text-xs text-muted">· {r.source}</Text></Text>
              <Text className="text-muted">{r.n}</Text>
            </View>
          ))}
        </Card>

        <Group><NavRow first icon={BarChart3} label="Usage data" detail="See what is recorded" onPress={() => router.push('/telemetry')} /></Group>

        <Card className="mb-4">
          <Text className="text-base font-semibold text-fg">Original messages</Text>
          <Text className="mt-1 text-sm text-muted">ExMan keeps each transaction's original message ({withText} of {total} right now) so you can check it, correct it, and so improvements can re-read it. It is never uploaded. You can remove old ones; the transactions themselves stay.</Text>
          <View className="mt-3 flex-row flex-wrap">
            {[30, 90, 365].map((d) => <Button key={d} className="mb-2 mr-2" variant="secondary" label={`Older than ${d === 365 ? '1 year' : `${d} days`}`} onPress={() => purge(d)} />)}
          </View>
        </Card>

        <Card className="mb-10">
          <Text className="text-base font-semibold text-fg">Delete all data</Text>
          <Text className="mt-1 text-sm text-muted">Removes every transaction, merchant, rule, taught format, budget and account except Cash. Categories you didn't create and your settings stay. This cannot be undone.</Text>
          <Button className="mt-3" variant="danger" label="Delete everything…" onPress={() => { setTyped(''); setConfirm(true); }} />
        </Card>
      </ScrollView>

      {confirm && (
        <Sheet title="Delete all data?" onClose={() => setConfirm(false)}>
          <Text className="mb-3 text-sm text-muted">Type DELETE to confirm.</Text>
          <TextInput className="mb-3 min-h-12 rounded-2xl bg-card2 px-4 py-3 text-base text-fg" value={typed} onChangeText={setTyped} autoCapitalize="characters" autoFocus placeholder="DELETE" placeholderTextColor={colors.muted} />
          <Button variant="danger" label={busy ? 'Deleting…' : 'Delete everything'} disabled={typed !== 'DELETE' || busy} onPress={async () => {
            setBusy(true);
            await deleteAllData(db);
            setBusy(false); setConfirm(false); notifyIngested(); load();
            snack({ message: 'All data deleted' });
          }} />
        </Sheet>
      )}
    </Page>
  );
}
