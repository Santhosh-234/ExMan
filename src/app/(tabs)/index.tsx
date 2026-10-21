import { useSecurity } from '@/security/store';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ChevronRight, Eye, EyeOff, Inbox, TrendingDown, TrendingUp } from 'lucide-react-native';
import { updateSecurity } from '@/security/store';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { MonthBar } from '@/components/MonthBar';
import { type Category, type CategorySpend, type Txn, countPending, getBudget, getCategories, queryTxns, setBudget, spendByCategory, totalFor } from '@/db/queries';
import { countUnparsed } from '@/db/patterns';
import { acknowledgeAutoTransfers, countAutoTransfers } from '@/db/transfers';
import { notifyIngested, onIngested } from '@/ingest/events';
import { Button, Card, Fab, Skeleton } from '@/ui/kit';
import { useTheme } from '@/ui/theme';
import { TxnRow } from '@/ui/TxnRow';
import { monthKey, monthRange, rupees, shiftMonth } from '@/utils/format';

export default function Home() {
  const { hide } = useSecurity(); // re-render when "hide amounts" changes
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useTheme();
  const now = monthKey(new Date());
  const [month, setMonth] = useState(now);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(0);
  const [autoTransfers, setAutoTransfers] = useState(0);
  const [unparsed, setUnparsed] = useState(0);
  const [spend, setSpend] = useState<CategorySpend[]>([]);
  const [income, setIncome] = useState(0);
  const [prevSpent, setPrevSpent] = useState(0);
  const [budget, setBudgetState] = useState<number | null>(null);
  const [recent, setRecent] = useState<Txn[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const load = useCallback(async () => {
    const [from, to] = monthRange(month);
    const [pf, pt] = monthRange(shiftMonth(month, -1));
    const [p, s, i, ps, b, r, c, at, up] = await Promise.all([
      countPending(db), spendByCategory(db, from, to), totalFor(db, 'credit', from, to), totalFor(db, 'debit', pf, pt), getBudget(db, month),
      queryTxns(db, { from, to, transfers: 'hide' }, 0), getCategories(db), countAutoTransfers(db), countUnparsed(db),
    ]);
    setPending(p); setAutoTransfers(at); setUnparsed(up); setSpend(s); setIncome(i); setPrevSpent(ps); setBudgetState(b); setRecent(r.slice(0, 5)); setCats(c); setLoaded(true);
  }, [db, month]);
  useFocusEffect(useCallback(() => void load(), [load]));
  useEffect(() => onIngested(() => void load()), [load]);

  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const spent = spend.reduce((a, s) => a + s.total, 0);
  const pct = budget ? Math.min(1, spent / budget) : 0;
  const over = budget != null && spent > budget;

  const [from, to] = monthRange(month);
  const today = new Date();
  const daysInMonth = Math.round((to - from) / 864e5);
  const daysLeft = month === now ? daysInMonth - today.getDate() + 1 : 0;
  const safeDaily = budget && daysLeft > 0 && !over ? (budget - spent) / daysLeft : null;
  const delta = prevSpent ? Math.round(((spent - prevSpent) / prevSpent) * 100) : null;
  const top = spend.slice(0, 3);
  const topMax = Math.max(1, ...top.map((s) => s.total));

  return (
    <View className="flex-1 bg-base">
      <ScrollView className="px-4 pt-14" showsVerticalScrollIndicator={false}>
        <View className="mb-4 flex-row items-center justify-between">
          <Text className="text-3xl font-bold text-fg" accessibilityRole="header">Home</Text>
          <Pressable onPress={() => void updateSecurity(db, { hide: !hide })} hitSlop={12} accessibilityRole="button" accessibilityLabel={hide ? 'Show amounts' : 'Hide amounts'}>
            {hide ? <EyeOff color={colors.muted} /> : <Eye color={colors.muted} />}
          </Pressable>
        </View>

        {pending > 0 && (
          <Pressable onPress={() => router.push('/review')} accessibilityRole="button" accessibilityLabel={`${pending} transactions to review`} className="mb-4 flex-row items-center rounded-3xl bg-accent p-4">
            <Inbox color={colors.onaccent} />
            <View className="ml-3 flex-1">
              <Text className="text-base font-semibold text-onaccent">{pending} to review</Text>
              <Text className="text-sm text-onaccent opacity-80">Swipe through them in seconds</Text>
            </View>
            <ChevronRight color={colors.onaccent} />
          </Pressable>
        )}

        {unparsed > 0 && (
          <Pressable onPress={() => router.push('/unrecognised')} accessibilityRole="button" className="mb-4 flex-row items-center rounded-3xl bg-card p-4">
            <View className="flex-1">
              <Text className="text-base font-semibold text-fg">{unparsed} message{unparsed === 1 ? '' : 's'} couldn't be read</Text>
              <Text className="mt-1 text-sm text-muted">Teach ExMan the format once and it reads similar ones from now on.</Text>
            </View>
            <ChevronRight color={colors.muted} />
          </Pressable>
        )}

        {autoTransfers > 0 && (
          <View className="mb-4 rounded-3xl bg-card p-4">
            <Text className="text-base font-semibold text-fg">{autoTransfers} transfer{autoTransfers === 1 ? '' : 's'} detected</Text>
            <Text className="mt-1 text-sm text-muted">Moves between your own accounts and card bill payments are left out of spending and income.</Text>
            <View className="mt-3 flex-row">
              <Button className="mr-3 flex-1" variant="secondary" label="Review" onPress={() => router.push('/activity?transfers=only')} />
              <Button className="flex-1" variant="secondary" label="Looks right" onPress={async () => { await acknowledgeAutoTransfers(db); notifyIngested(); }} />
            </View>
          </View>
        )}

        <MonthBar month={month} onChange={setMonth} max={now} />

        {!loaded ? (
          <Card className="mb-4"><Skeleton style={{ width: 120, height: 14 }} /><Skeleton style={{ width: 200, height: 40, marginTop: 10 }} /><Skeleton style={{ height: 12, marginTop: 20 }} /></Card>
        ) : (
          <Card className="mb-4">
            <Text className="text-xs uppercase tracking-wider text-muted">Spent in {month === now ? 'this month' : 'the month'}</Text>
            <Text className="text-4xl font-bold text-fg" accessibilityLabel={`Spent ${rupees(spent)}`}>{rupees(spent)}</Text>
            {delta != null && (
              <View className="mt-1 flex-row items-center">
                {delta > 0 ? <TrendingUp size={14} color={colors.danger} /> : <TrendingDown size={14} color={colors.accent} />}
                <Text className={`ml-1 text-sm ${delta > 0 ? 'text-danger' : 'text-accent'}`}>{delta === 0 ? 'Same as last month' : `${Math.abs(delta)}% ${delta > 0 ? 'more' : 'less'} than last month`}</Text>
              </View>
            )}

            <View className="mt-4 h-3 overflow-hidden rounded-full bg-card2" accessibilityRole="progressbar" accessibilityValue={budget ? { min: 0, max: 100, now: Math.round(pct * 100) } : undefined}>
              <View style={{ width: `${pct * 100}%`, backgroundColor: over ? colors.danger : colors.accent }} className="h-3 rounded-full" />
            </View>
            {editing ? (
              <View className="mt-3 flex-row items-center">
                <TextInput
                  className="mr-3 min-h-12 flex-1 rounded-2xl bg-card2 px-4 text-base text-fg"
                  value={draft} onChangeText={setDraft} keyboardType="numeric" autoFocus
                  placeholder="Monthly budget in ₹ (blank to clear)" placeholderTextColor={colors.muted}
                />
                <Button label="Save" onPress={async () => {
                  const v = Math.round(parseFloat(draft) * 100);
                  await setBudget(db, month, v > 0 ? v : null);
                  setEditing(false);
                  load();
                }} />
              </View>
            ) : (
              <Pressable onPress={() => { setDraft(budget ? String(budget / 100) : ''); setEditing(true); }} className="mt-3" accessibilityRole="button">
                <Text className={over ? 'text-danger' : 'text-muted'}>
                  {budget ? `${rupees(spent)} of ${rupees(budget)}${over ? ` · over by ${rupees(spent - budget)}` : ` · ${rupees(budget - spent)} left`}` : 'Tap to set a monthly budget'}
                </Text>
                {safeDaily != null && <Text className="mt-1 text-sm text-muted">Safe to spend {rupees(safeDaily)} a day for {daysLeft} more days</Text>}
              </Pressable>
            )}

            <View className="mt-4 flex-row border-t border-line pt-3">
              <View className="flex-1"><Text className="text-xs text-muted">Income</Text><Text className="text-lg font-semibold text-accent">{rupees(income)}</Text></View>
              <View className="flex-1"><Text className="text-xs text-muted">Net</Text><Text className={`text-lg font-semibold ${income - spent < 0 ? 'text-danger' : 'text-fg'}`}>{income - spent < 0 ? '-' : ''}{rupees(Math.abs(income - spent))}</Text></View>
            </View>
          </Card>
        )}

        {top.length > 0 && (
          <Card className="mb-4">
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-base font-semibold text-fg">Top categories</Text>
              <Pressable onPress={() => router.push('/insights')} hitSlop={10} accessibilityRole="button"><Text className="text-accent">See all</Text></Pressable>
            </View>
            {top.map((s) => (
              <View key={String(s.category_id)} className="mb-3">
                <View className="mb-1 flex-row justify-between"><Text className="text-fg">{s.name}</Text><Text className="text-muted">{rupees(s.total)}</Text></View>
                <View className="h-2 overflow-hidden rounded-full bg-card2"><View className="h-2 rounded-full" style={{ width: `${(s.total / topMax) * 100}%`, backgroundColor: s.color }} /></View>
              </View>
            ))}
          </Card>
        )}

        <View className="mb-2 flex-row items-center justify-between">
          <Text className="text-base font-semibold text-fg" accessibilityRole="header">Recent</Text>
          <Pressable onPress={() => router.push('/activity')} hitSlop={10} accessibilityRole="button"><Text className="text-accent">See all</Text></Pressable>
        </View>
        {loaded && recent.length === 0 ? (
          <Card className="mb-4"><Text className="text-muted">Nothing confirmed this month yet. Review new transactions, or tap + to add one.</Text></Card>
        ) : (
          recent.map((t) => <TxnRow key={t.id} t={t} cat={catById.get(t.category_id ?? -1)} onPress={(x) => router.push(`/txn/${x.id}`)} />)
        )}
        <View className="h-28" />
      </ScrollView>
      <Fab onPress={() => router.push('/add')} />
    </View>
  );
}
