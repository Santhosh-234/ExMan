import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ChevronRight, Inbox } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Pie } from '@/components/Charts';
import { MonthBar } from '@/components/MonthBar';
import { type CategorySpend, countPending, getBudget, setBudget, spendByCategory, totalFor } from '@/db/queries';
import { onIngested } from '@/ingest/events';
import { Button, Card, Chip, Skeleton } from '@/ui/kit';
import { useTheme } from '@/ui/theme';
import { monthKey, monthRange, rupees, shiftMonth } from '@/utils/format';

export default function Home() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useTheme();
  const now = monthKey(new Date());
  const [month, setMonth] = useState(now);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(0);
  const [spend, setSpend] = useState<CategorySpend[]>([]);
  const [income, setIncome] = useState(0);
  const [prevSpent, setPrevSpent] = useState(0);
  const [budget, setBudgetState] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState<number | null | 'all'>('all');

  const load = useCallback(async () => {
    const [from, to] = monthRange(month);
    const [pf, pt] = monthRange(shiftMonth(month, -1));
    const [p, s, i, ps, b] = await Promise.all([
      countPending(db), spendByCategory(db, from, to), totalFor(db, 'credit', from, to), totalFor(db, 'debit', pf, pt), getBudget(db, month),
    ]);
    setPending(p); setSpend(s); setIncome(i); setPrevSpent(ps); setBudgetState(b); setLoaded(true);
  }, [db, month]);
  useFocusEffect(useCallback(() => void load(), [load]));
  useEffect(() => onIngested(() => void load()), [load]);

  const shown = filter === 'all' ? spend : spend.filter((s) => s.category_id === filter);
  const spent = spend.reduce((a, s) => a + s.total, 0);
  const pct = budget ? Math.min(1, spent / budget) : 0;
  const over = budget != null && spent > budget;

  const [from, to] = monthRange(month);
  const today = new Date();
  const daysInMonth = Math.round((to - from) / 864e5);
  const elapsedDays = month === now ? today.getDate() : daysInMonth;
  const daysLeft = month === now ? daysInMonth - today.getDate() + 1 : 0;
  const insights: string[] = [];
  if (spend[0]) insights.push(`Biggest spend: ${spend[0].name} (${rupees(spend[0].total)}, ${Math.round((spend[0].total / spent) * 100)}%)`);
  if (spent) insights.push(`Average ${rupees(spent / elapsedDays)} per day`);
  if (prevSpent) {
    const d = Math.round(((spent - prevSpent) / prevSpent) * 100);
    insights.push(d === 0 ? 'Same as last month' : `${Math.abs(d)}% ${d > 0 ? 'more' : 'less'} than last month`);
  }
  if (budget && month === now && spent && (spent / elapsedDays) * daysInMonth > budget)
    insights.push(`At this pace you'll reach ${rupees((spent / elapsedDays) * daysInMonth)}, over budget`);

  const safeDaily = budget && daysLeft > 0 && !over ? (budget - spent) / daysLeft : null;

  return (
    <ScrollView className="flex-1 bg-base px-4 pt-14" showsVerticalScrollIndicator={false}>
      <Text className="mb-4 text-3xl font-bold text-fg" accessibilityRole="header">Home</Text>

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

      <MonthBar month={month} onChange={setMonth} max={now} />

      {!loaded ? (
        <Card className="mb-4"><Skeleton style={{ width: 120, height: 14 }} /><Skeleton style={{ width: 200, height: 34, marginTop: 10 }} /><Skeleton style={{ height: 12, marginTop: 20 }} /></Card>
      ) : (
        <Card className="mb-4">
          <View className="flex-row justify-between">
            <View>
              <Text className="text-xs text-muted">Spent</Text>
              <Text className="text-3xl font-bold text-fg">{rupees(spent)}</Text>
            </View>
            <View className="items-end">
              <Text className="text-xs text-muted">Income</Text>
              <Text className="text-2xl font-semibold text-accent">{rupees(income)}</Text>
            </View>
          </View>
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
        </Card>
      )}

      <Card className="mb-4">
        <Text className="mb-3 text-base font-semibold text-fg">By category</Text>
        <View className="mb-2 flex-row flex-wrap">
          <Chip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} color={colors.accent} />
          {spend.map((s) => <Chip key={String(s.category_id)} label={s.name} color={s.color} selected={filter === s.category_id} onPress={() => setFilter(s.category_id)} />)}
        </View>
        {spend.length === 0 ? (
          <Text className="text-muted">Nothing confirmed this month yet. Review new transactions to see them here.</Text>
        ) : (
          <View className="items-center">
            <Pie data={shown.map((s) => ({ label: s.name, value: s.total, color: s.color }))} />
            <View className="mt-3 w-full">
              {shown.map((s) => (
                <View key={String(s.category_id)} className="mb-1.5 flex-row items-center justify-between">
                  <View className="flex-row items-center">
                    <View className="mr-2 h-3 w-3 rounded-full" style={{ backgroundColor: s.color }} />
                    <Text className="text-fg">{s.name}</Text>
                  </View>
                  <Text className="text-muted">{rupees(s.total)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </Card>

      {insights.length > 0 && (
        <Card className="mb-4">
          <Text className="mb-2 text-base font-semibold text-fg">Insights</Text>
          {insights.map((i) => <Text key={i} className="mb-1 text-muted">• {i}</Text>)}
        </Card>
      )}
      <View className="h-8" />
    </ScrollView>
  );
}
