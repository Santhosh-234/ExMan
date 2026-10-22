import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { MessageSquareWarning } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { Text } from '@/ui/Text';

import { type PatternRow, type Unparsed, countUnparsedSplit, deletePattern, deleteUnparsed, listPatterns, listUnparsed, setPatternEnabled } from '@/db/patterns';
import { onIngested } from '@/ingest/events';
import { track } from '@/telemetry';
import { maskMessage } from '@/telemetry/mask';
import { senderKey } from '@/utils/teach';
import { Button, Card, EmptyState, Sheet, BackButton } from '@/ui/kit';
import { useSnackbar } from '@/ui/Snackbar';
import { useTheme } from '@/ui/theme';

export default function Unrecognised() {
  const db = useSQLiteContext();
  const router = useRouter();
  const snack = useSnackbar();
  const { colors } = useTheme();
  const [msgs, setMsgs] = useState<Unparsed[] | null>(null);
  const [patterns, setPatterns] = useState<PatternRow[]>([]);
  const [reporting, setReporting] = useState<Unparsed | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [hidden, setHidden] = useState(0);

  const load = useCallback(async () => { setMsgs(await listUnparsed(db, 100, showAll)); setPatterns(await listPatterns(db)); setHidden((await countUnparsedSplit(db)).hidden); }, [db, showAll]);
  useEffect(() => void load(), [load]);
  useEffect(() => onIngested(() => void load()), [load]);

  const dismiss = async (m: Unparsed) => {
    await deleteUnparsed(db, m.id);
    load();
    snack({ message: 'Message removed', onAction: async () => { await db.runAsync('INSERT OR IGNORE INTO unparsed (id, sender, text, ts) VALUES (?, ?, ?, ?)', m.id, m.sender, m.text, m.ts); load(); } });
  };

  return (
    <View className="flex-1 bg-base px-4 pt-14">
      <BackButton />
      <Text className="text-3xl font-bold text-fg" accessibilityRole="header">Unrecognised messages</Text>
      <Text className="mb-3 text-xs text-muted">Messages that mention an amount but that ExMan could not read. Teach it the format once and it will read similar messages from now on.</Text>

      <ScrollView showsVerticalScrollIndicator={false}>
        {msgs && msgs.length === 0 && (
          <EmptyState icon={<MessageSquareWarning size={44} color={colors.muted} />} title="Nothing to teach" body="Every money message so far was understood." />
        )}
        {(hidden > 0 || showAll) && (
          <Pressable onPress={() => setShowAll((v) => !v)} accessibilityRole="button" className="mb-3 min-h-9 justify-center">
            <Text className="text-accent">{showAll ? 'Hide offers, reminders and other non-transactions' : `Show ${hidden} hidden message${hidden === 1 ? '' : 's'} (offers, reminders)`}</Text>
          </Pressable>
        )}
        {(msgs ?? []).map((m) => (
          <Card key={m.id} className="mb-3">
            <Text className="text-xs text-muted">{m.sender} · {new Date(m.ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</Text>
            <Text className="mt-1 text-fg" numberOfLines={6}>{m.text}</Text>
            <View className="mt-3 flex-row">
              <Button className="mr-3 flex-1" label="Teach" onPress={() => router.push(`/teach/${m.id}`)} />
              <Button className="flex-1" variant="secondary" label="Not a transaction" onPress={() => dismiss(m)} />
            </View>
            <Pressable onPress={() => setReporting(m)} accessibilityRole="button" className="mt-2 min-h-9 justify-center"><Text className="text-accent">Report this format to improve ExMan</Text></Pressable>
          </Card>
        ))}

        {patterns.length > 0 && (
          <>
            <Text className="mb-2 mt-4 text-lg font-semibold text-fg" accessibilityRole="header">Taught formats</Text>
            {patterns.map((p) => (
              <Card key={p.id} className="mb-3">
                <View className="flex-row items-center">
                  <View className="flex-1">
                    <Text className="text-xs text-muted">{p.sender_key.toUpperCase()} · {p.direction === 'debit' ? 'Spent' : 'Received'} · used {p.hits}×</Text>
                    <Text className="mt-1 text-sm text-fg" numberOfLines={3}>{p.example}</Text>
                  </View>
                  <Switch value={!!p.enabled} onValueChange={async (v) => { await setPatternEnabled(db, p.id, v); load(); }} trackColor={{ true: colors.accent, false: colors.surface2 }} accessibilityLabel="Format enabled" />
                </View>
                <Pressable onPress={async () => { await deletePattern(db, p.id); load(); snack({ message: 'Format deleted. Transactions already read are kept.' }); }} accessibilityRole="button" className="mt-2 min-h-9 justify-center">
                  <Text className="text-danger">Delete format</Text>
                </Pressable>
              </Card>
            ))}
          </>
        )}
        <View className="h-10" />
      </ScrollView>

      {reporting && (
        <Sheet title="Report this format" onClose={() => setReporting(null)}>
          <Text className="mb-2 text-sm text-muted">Only this masked outline would be shared: numbers, names, UPI IDs and links are removed. Your original message never leaves the phone.</Text>
          <Text className="mb-3 rounded-2xl bg-card2 p-3 text-sm text-fg" selectable>{maskMessage(reporting.text)}</Text>
          <Text className="mb-3 text-xs text-muted">Sender: {senderKey(reporting.sender)}</Text>
          <Button label="Share this outline" onPress={() => {
            const m = reporting; setReporting(null);
            // recorded under the same allow-list and opt-out rules as all usage data; nothing is sent if that is off
            track('gap_report', { sender_key: senderKey(m.sender).replace(/[^a-z0-9]/g, '').slice(0, 12).padEnd(3, 'x'), template: maskMessage(m.text) });
            snack({ message: 'Thanks. Queued to share (only if usage data is on).' });
          }} />
        </Sheet>
      )}
    </View>
  );
}
