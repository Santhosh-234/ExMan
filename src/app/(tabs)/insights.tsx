import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';

import { Bars, Pie } from '@/components/Charts';
import { MonthBar } from '@/components/MonthBar';
import { type CategorySpend, monthlyTotals, spendByCategory, topMerchants } from '@/db/queries';
import { Chip } from '@/ui/kit';
import { useTheme } from '@/ui/theme';
import { monthKey, monthLabel, monthRange, rupees, shiftMonth } from '@/utils/format';

export default function Insights() {
  const db = useSQLiteContext();
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const nowKey = monthKey(new Date());
  const [month, setMonth] = useState(nowKey);
  const [spend, setSpend] = useState<CategorySpend[]>([]);
  const [filter, setFilter] = useState<number | null | 'all'>('all');
  const [series, setSeries] = useState<{ label: string; value: number }[]>([]);
  const [income, setIncome] = useState<{ label: string; value: number }[]>([]);
  const [merchants, setMerchants] = useState<{ merchant: string; total: number; n: number }[]>([]);

  const load = useCallback(async () => {
    const now = monthKey(new Date());
    const months = [5, 4, 3, 2, 1, 0].map((i) => shiftMonth(now, -i));
    const lab = (m: string) => monthLabel(m).split(' ')[0];
    const rows = await monthlyTotals(db, monthRange(months[0])[0], monthRange(now)[1]);
    const sum = (m: string, dir: string) => rows.find((r) => r.month === m && r.direction === dir)?.total ?? 0;
    setSeries(months.map((m) => ({ label: lab(m), value: sum(m, 'debit') })));
    setIncome(months.map((m) => ({ label: lab(m), value: sum(m, 'credit') })));
    setSpend(await spendByCategory(db, ...monthRange(month)));
    setMerchants(await topMerchants(db, monthRange(months[0])[0], monthRange(now)[1], 8));
  }, [db, month]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const cw = width - 64;
  return (
    <ScrollView className="flex-1 bg-base px-4 pt-14">
      <Text className="mb-4 text-3xl font-bold text-fg" accessibilityRole="header">Insights</Text>
      <MonthBar month={month} onChange={setMonth} max={nowKey} />
      <View className="mb-4 rounded-2xl bg-card p-4">
        <Text className="mb-3 text-base font-semibold text-fg">By category</Text>
        <View className="mb-2 flex-row flex-wrap">
          <Chip label="All" selected={filter === 'all'} color={colors.accent} onPress={() => setFilter('all')} />
          {spend.map((s) => <Chip key={String(s.category_id)} label={s.name} color={s.color} selected={filter === s.category_id} onPress={() => setFilter(s.category_id)} />)}
        </View>
        {spend.length === 0 ? (
          <Text className="text-muted">Nothing confirmed this month.</Text>
        ) : (
          <View className="items-center">
            <Pie data={(filter === 'all' ? spend : spend.filter((s) => s.category_id === filter)).map((s) => ({ label: s.name, value: s.total, color: s.color }))} />
            <View className="mt-3 w-full">
              {(filter === 'all' ? spend : spend.filter((s) => s.category_id === filter)).map((s) => (
                <View key={String(s.category_id)} className="mb-1.5 flex-row items-center justify-between">
                  <View className="flex-row items-center"><View className="mr-2 h-3 w-3 rounded-full" style={{ backgroundColor: s.color }} /><Text className="text-fg">{s.name}</Text></View>
                  <Text className="text-muted">{rupees(s.total)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
      <View className="mb-4 rounded-2xl bg-card p-4">
        <Text className="mb-3 text-base font-semibold text-fg">Spending, last 6 months</Text>
        <Bars data={series} width={cw} />
      </View>
      <View className="mb-4 rounded-2xl bg-card p-4">
        <Text className="mb-3 text-base font-semibold text-fg">Income, last 6 months</Text>
        <Bars data={income} width={cw} />
      </View>
      <View className="mb-4 rounded-2xl bg-card p-4">
        <Text className="mb-3 text-base font-semibold text-fg">Top merchants (6 months)</Text>
        {merchants.length === 0 && <Text className="text-muted">Nothing confirmed yet.</Text>}
        {merchants.map((m) => (
          <View key={m.merchant} className="mb-2 flex-row justify-between">
            <Text className="text-fg">{m.merchant} <Text className="text-xs text-muted">×{m.n}</Text></Text>
            <Text className="text-muted">{rupees(m.total)}</Text>
          </View>
        ))}
      </View>
      <View className="h-8" />
    </ScrollView>
  );
}
