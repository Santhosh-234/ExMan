import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { type AccountStats, type Category, type Txn, getAccount, getAccountStats, getCategories, mergeAccount, queryTxns, renameAccount, setAccountArchived } from '@/db/queries';
import { notifyIngested, onIngested } from '@/ingest/events';
import { Button, Card, Chip, Sheet } from '@/ui/kit';
import { useSnackbar } from '@/ui/Snackbar';
import { useTheme } from '@/ui/theme';
import { TxnRow } from '@/ui/TxnRow';
import { monthKey, monthRange, rupees } from '@/utils/format';
import { asOf } from '../accounts';

export default function AccountDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const aid = Number(id);
  const db = useSQLiteContext();
  const router = useRouter();
  const snack = useSnackbar();
  const { colors } = useTheme();
  const [a, setA] = useState<AccountStats | null>(null);
  const [others, setOthers] = useState<AccountStats[]>([]);
  const [recent, setRecent] = useState<Txn[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [sheet, setSheet] = useState<null | 'rename' | 'merge'>(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [base, stats, r, c] = await Promise.all([getAccount(db, aid), getAccountStats(db, ...monthRange(monthKey(new Date()))), queryTxns(db, { accountIds: [aid] }, 0), getCategories(db)]);
    const s = stats.find((x) => x.id === aid);
    setA(base && s ? { ...base, spent: s.spent, received: s.received, n: s.n } : base);
    setOthers(stats.filter((x) => x.id !== aid && !x.archived));
    setRecent(r.slice(0, 5)); setCats(c);
  }, [db, aid]);
  useEffect(() => void load(), [load]);
  useEffect(() => onIngested(() => void load()), [load]);
  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);

  if (!a) return <View className="flex-1 bg-base" />;
  const sub = [a.bank, a.last4 ? `…${a.last4}` : null, a.kind].filter(Boolean).join(' · ');

  const toggleArchive = async () => {
    const next = !a.archived;
    await setAccountArchived(db, aid, next);
    notifyIngested();
    snack({ message: next ? `Archived ${a.name}` : `Restored ${a.name}`, onAction: () => void setAccountArchived(db, aid, !next).then(() => { notifyIngested(); load(); }) });
    load();
  };

  return (
    <View className="flex-1 bg-base px-4 pt-14">
      <Pressable onPress={() => router.back()} hitSlop={12} className="mb-2 flex-row items-center" accessibilityRole="button" accessibilityLabel="Back">
        <ChevronLeft color={colors.fg} /><Text className="text-fg">Back</Text>
      </Pressable>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text className="text-3xl font-bold text-fg" accessibilityRole="header">{a.name}</Text>
        <Text className="mb-4 text-sm text-muted">{sub}</Text>

        <Card className="mb-4">
          {a.balance_paise != null ? (
            <>
              <Text className="text-xs text-muted">{a.balance_kind === 'limit' ? 'Available limit' : 'Balance'} as of {asOf(a.balance_ts)}</Text>
              <Text className="text-3xl font-bold text-fg">{rupees(a.balance_paise)}</Text>
            </>
          ) : (
            <Text className="text-muted">No balance seen in messages for this account yet.</Text>
          )}
          <View className="mt-3 flex-row border-t border-line pt-3">
            <View className="flex-1"><Text className="text-xs text-muted">Spent this month</Text><Text className="text-fg">{rupees(a.spent)}</Text></View>
            <View className="flex-1"><Text className="text-xs text-muted">Received</Text><Text className="text-accent">{rupees(a.received)}</Text></View>
          </View>
        </Card>

        <View className="mb-4 flex-row flex-wrap">
          <Button className="mb-2 mr-2" variant="secondary" label="Rename" onPress={() => { setName(a.name); setSheet('rename'); }} />
          <Button className="mb-2 mr-2" variant="secondary" label="Merge into…" disabled={others.length === 0} onPress={() => { setTarget(null); setSheet('merge'); }} />
          <Button className="mb-2" variant="secondary" label={a.archived ? 'Restore' : 'Archive'} onPress={toggleArchive} />
        </View>

        <View className="mb-2 flex-row items-center justify-between">
          <Text className="text-base font-semibold text-fg">Recent</Text>
          <Pressable onPress={() => router.push(`/activity?account=${aid}`)} hitSlop={10} accessibilityRole="button"><Text className="text-accent">View all</Text></Pressable>
        </View>
        {recent.length === 0 ? <Card><Text className="text-muted">No confirmed transactions yet.</Text></Card> : recent.map((t) => <TxnRow key={t.id} t={t} cat={catById.get(t.category_id ?? -1)} onPress={(x) => router.push(`/txn/${x.id}`)} />)}
        <View className="h-10" />
      </ScrollView>

      {sheet === 'rename' && (
        <Sheet title="Rename account" onClose={() => setSheet(null)}>
          <TextInput className="mb-3 min-h-12 rounded-2xl bg-card2 px-4 py-3 text-base text-fg" value={name} onChangeText={setName} autoFocus placeholderTextColor={colors.muted} />
          <Button label="Save" disabled={!name.trim()} onPress={async () => { await renameAccount(db, aid, name.trim()); setSheet(null); notifyIngested(); load(); }} />
        </Sheet>
      )}
      {sheet === 'merge' && (
        <Sheet title={`Merge ${a.name} into…`} onClose={() => setSheet(null)}>
          <Text className="mb-3 text-sm text-muted">All its transactions move to the account you pick, and future messages for it go there too. Use this when one real account shows up twice.</Text>
          <View className="mb-3 flex-row flex-wrap">
            {others.map((o) => <Chip key={o.id} label={o.name} color={colors.accent} selected={target === o.id} onPress={() => setTarget(o.id)} />)}
          </View>
          <Button
            label="Merge" disabled={target == null}
            onPress={async () => {
              const t = others.find((o) => o.id === target)!;
              await mergeAccount(db, aid, t.id);
              setSheet(null); notifyIngested();
              snack({ message: `Merged into ${t.name}` });
              router.replace(`/account/${t.id}`);
            }}
          />
        </Sheet>
      )}
    </View>
  );
}
