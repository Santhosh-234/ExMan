import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Pie } from '@/components/Charts';
import { MonthBar } from '@/components/MonthBar';
import { type CategorySpend, getBudget, setBudget, spendByCategory, totalFor } from '@/db/queries';
import { monthKey, monthRange, rupees, shiftMonth } from '@/utils/format';

export default function Dashboard() {
  const db = useSQLiteContext();
  const now = monthKey(new Date());
  const [month, setMonth] = useState(now);
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
    setSpend(await spendByCategory(db, from, to));
    setIncome(await totalFor(db, 'credit', from, to));
    setPrevSpent(await totalFor(db, 'debit', pf, pt));
    setBudgetState(await getBudget(db, month));
  }, [db, month]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const shown = filter === 'all' ? spend : spend.filter((s) => s.category_id === filter);
  const spent = spend.reduce((a, s) => a + s.total, 0);
  const pct = budget ? Math.min(1, spent / budget) : 0;
  const over = budget != null && spent > budget;

  // insights
  const [from, to] = monthRange(month);
  const elapsedDays = month === now ? new Date().getDate() : Math.round((to - from) / 864e5);
  const insights: string[] = [];
  if (spend[0]) insights.push(`Biggest spend: ${spend[0].name} (${rupees(spend[0].total)}, ${Math.round((spend[0].total / spent) * 100)}%)`);
  if (spent) insights.push(`Average ${rupees(spent / elapsedDays)} per day`);
  if (prevSpent) {
    const d = Math.round(((spent - prevSpent) / prevSpent) * 100);
    insights.push(d === 0 ? 'Same as last month' : `${Math.abs(d)}% ${d > 0 ? 'more' : 'less'} than last month`);
  }
  if (budget && month === now && spent) {
    const projected = (spent / elapsedDays) * new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    if (projected > budget) insights.push(`At this pace you'll reach ${rupees(projected)}, over budget`);
  }

  return (
    <ScrollView className="flex-1 bg-base px-4 pt-16">
      <Text className="mb-4 text-2xl font-semibold text-white">Dashboard</Text>
      <MonthBar month={month} onChange={setMonth} max={now} />

      <View className="mb-4 rounded-2xl bg-card p-4">
        <View className="flex-row justify-between">
          <View>
            <Text className="text-xs text-gray-400">Spent</Text>
            <Text className="text-2xl font-semibold text-white">{rupees(spent)}</Text>
          </View>
          <View className="items-end">
            <Text className="text-xs text-gray-400">Income</Text>
            <Text className="text-2xl font-semibold text-accent">{rupees(income)}</Text>
          </View>
        </View>
        <View className="mt-4 h-3 overflow-hidden rounded-full bg-base">
          <View style={{ width: `${pct * 100}%`, backgroundColor: over ? '#F43F5E' : '#10B981' }} className="h-3 rounded-full" />
        </View>
        {editing ? (
          <View className="mt-3 flex-row items-center">
            <TextInput
              className="flex-1 rounded-xl bg-base px-3 py-2 text-white"
              value={draft} onChangeText={setDraft} keyboardType="numeric" autoFocus
              placeholder="Monthly budget in ₹ (blank to clear)" placeholderTextColor="#6B7280"
            />
            <Pressable
              className="ml-3"
              onPress={async () => {
                const v = Math.round(parseFloat(draft) * 100);
                await setBudget(db, month, v > 0 ? v : null);
                setEditing(false);
                load();
              }}>
              <Text className="text-accent">Save</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => { setDraft(budget ? String(budget / 100) : ''); setEditing(true); }} className="mt-3">
            <Text className={over ? 'text-red-400' : 'text-gray-400'}>
              {budget ? `${rupees(spent)} of ${rupees(budget)}${over ? ` · over by ${rupees(spent - budget)}` : ` · ${rupees(budget - spent)} left`}` : 'Tap to set a monthly budget'}
            </Text>
          </Pressable>
        )}
      </View>

      <View className="mb-4 rounded-2xl bg-card p-4">
        <Text className="mb-3 text-base font-semibold text-white">By category</Text>
        <View className="mb-3 flex-row flex-wrap">
          <Pressable onPress={() => setFilter('all')} className="mb-2 mr-2 rounded-full px-3 py-1" style={{ backgroundColor: filter === 'all' ? '#10B981' : '#1F2937' }}>
            <Text className="text-xs text-white">All</Text>
          </Pressable>
          {spend.map((s) => (
            <Pressable key={String(s.category_id)} onPress={() => setFilter(s.category_id)} className="mb-2 mr-2 rounded-full px-3 py-1" style={{ backgroundColor: filter === s.category_id ? s.color : '#1F2937' }}>
              <Text className="text-xs text-white">{s.name}</Text>
            </Pressable>
          ))}
        </View>
        {spend.length === 0 ? (
          <Text className="text-gray-400">No confirmed spending this month. Confirm items in the Inbox.</Text>
        ) : (
          <View className="items-center">
            <Pie data={shown.map((s) => ({ label: s.name, value: s.total, color: s.color }))} />
            <View className="mt-3 w-full">
              {shown.map((s) => (
                <View key={String(s.category_id)} className="mb-1 flex-row items-center justify-between">
                  <View className="flex-row items-center">
                    <View className="mr-2 h-3 w-3 rounded-full" style={{ backgroundColor: s.color }} />
                    <Text className="text-white">{s.name}</Text>
                  </View>
                  <Text className="text-gray-300">{rupees(s.total)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>

      {insights.length > 0 && (
        <View className="mb-4 rounded-2xl bg-card p-4">
          <Text className="mb-2 text-base font-semibold text-white">Insights</Text>
          {insights.map((i) => <Text key={i} className="mb-1 text-gray-300">• {i}</Text>)}
        </View>
      )}
      <View className="h-8" />
    </ScrollView>
  );
}
