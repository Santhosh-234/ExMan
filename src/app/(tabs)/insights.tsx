import { useSecurity } from '@/security/store';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Text } from '@/ui/Text';

import { Bars, Pie } from '@/components/Charts';
import { MonthBar } from '@/components/MonthBar';
import { type CategorySpend, monthlyTotals, spendByCategory, topMerchants, totalFor } from '@/db/queries';
import { onIngested } from '@/ingest/events';
import { Card, Chip } from '@/ui/kit';
import { useTheme } from '@/ui/theme';
import { monthKey, monthLabel, monthRange, rupees, shiftMonth } from '@/utils/format';
import { buildCallouts } from '@/utils/insights';
import { getRecurring, monthlyTotal } from '@/db/recurring';
import { useRouter } from 'expo-router';

export default function Insights() {
  useSecurity(); // re-render when "hide amounts" changes
  const db = useSQLiteContext();
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const nowKey = monthKey(new Date());
  const [month, setMonth] = useState(nowKey);
  const [range, setRange] = useState<6 | 12>(6);
  const [spend, setSpend] = useState<CategorySpend[]>([]);
  const [callouts, setCallouts] = useState<string[]>([]);
  const router = useRouter();
  const [subs, setSubs] = useState<{ n: number; monthly: number }>({ n: 0, monthly: 0 });
  const [filter, setFilter] = useState<number | null | 'all'>('all');
  const [series, setSeries] = useState<{ label: string; value: number }[]>([]);
  const [income, setIncome] = useState<{ label: string; value: number }[]>([]);
  const [saved, setSaved] = useState<{ label: string; value: number }[]>([]);
  const [merchants, setMerchants] = useState<{ merchant: string; total: number; n: number }[]>([]);

  const load = useCallback(async () => {
    const months = Array.from({ length: range }, (_, i) => shiftMonth(nowKey, -(range - 1 - i)));
    const lab = (m: string) => monthLabel(m).split(' ')[0];
    const rows = await monthlyTotals(db, monthRange(months[0])[0], monthRange(nowKey)[1]);
    const sum = (m: string, dir: string) => rows.find((r) => r.month === m && r.direction === dir)?.total ?? 0;
    setSeries(months.map((m) => ({ label: lab(m), value: sum(m, 'debit') })));
    setIncome(months.map((m) => ({ label: lab(m), value: sum(m, 'credit') })));
    setSaved(months.map((m) => ({ label: lab(m), value: Math.max(0, sum(m, 'credit') - sum(m, 'debit')) })));
    setMerchants(await topMerchants(db, monthRange(months[0])[0], monthRange(nowKey)[1], 8));

    // the selected month, plus the three months before it for "vs your average"
    const cur = await spendByCategory(db, ...monthRange(month));
    setSpend(cur);
    const history = await Promise.all([1, 2, 3].map((i) => spendByCategory(db, ...monthRange(shiftMonth(month, -i)))));
    const [spent, prevSpent, inc] = await Promise.all([
      totalFor(db, 'debit', ...monthRange(month)), totalFor(db, 'debit', ...monthRange(shiftMonth(month, -1))), totalFor(db, 'credit', ...monthRange(month)),
    ]);
    const rec = (await getRecurring(db)).filter((r) => r.status !== 'ended');
    setSubs({ n: rec.length, monthly: monthlyTotal(rec) });
    setCallouts(buildCallouts({ spend: cur, history, spent, prevSpent, income: inc }));
  }, [db, month, range, nowKey]);
  useFocusEffect(useCallback(() => void load(), [load]));
  useEffect(() => onIngested(() => void load()), [load]);

  const shown = useMemo(() => (filter === 'all' ? spend : spend.filter((s) => s.category_id === filter)), [spend, filter]);
  const cw = width - 64;
  const rangeLabel = range === 6 ? '6 months' : '12 months';

  return (
    <ScrollView className="flex-1 bg-base px-4 pt-14" showsVerticalScrollIndicator={false}>
      <Text className="mb-4 text-3xl font-bold text-fg" accessibilityRole="header">Insights</Text>
      <MonthBar month={month} onChange={setMonth} max={nowKey} />

      {subs.n > 0 && (
        <Pressable onPress={() => router.push('/subscriptions')} accessibilityRole="button" className="mb-4">
          <Card>
            <Text className="text-base font-semibold text-fg">Subscriptions</Text>
            <Text className="mt-1 text-fg">About {rupees(subs.monthly)} a month across {subs.n} recurring payment{subs.n === 1 ? '' : 's'}</Text>
            <Text className="mt-1 text-accent">See them all ›</Text>
          </Card>
        </Pressable>
      )}

      {callouts.length > 0 && (
        <Card className="mb-4">
          <Text className="mb-2 text-base font-semibold text-fg">This month</Text>
          {callouts.map((c) => <Text key={c} className="mb-1.5 text-fg">• {c}</Text>)}
        </Card>
      )}

      <Card className="mb-4">
        <Text className="mb-3 text-base font-semibold text-fg">By category</Text>
        <View className="mb-2 flex-row flex-wrap">
          <Chip label="All" selected={filter === 'all'} color={colors.accent} onPress={() => setFilter('all')} />
          {spend.map((s) => <Chip key={String(s.category_id)} label={s.name} color={s.color} selected={filter === s.category_id} onPress={() => setFilter(s.category_id)} />)}
        </View>
        {spend.length === 0 ? (
          <Text className="text-muted">Nothing confirmed this month.</Text>
        ) : (
          <View className="items-center">
            <Pie data={shown.map((s) => ({ label: s.name, value: s.total, color: s.color }))} label={`Spending in ${monthLabel(month)}`} />
            <View className="mt-3 w-full">
              {shown.map((s) => (
                <View key={String(s.category_id)} className="mb-1.5 flex-row items-center justify-between">
                  <View className="flex-row items-center"><View className="mr-2 h-3 w-3 rounded-full" style={{ backgroundColor: s.color }} /><Text className="text-fg">{s.name}</Text></View>
                  <Text className="text-muted">{rupees(s.total)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </Card>

      <View className="mb-2 flex-row items-center justify-between">
        <Text className="text-lg font-semibold text-fg" accessibilityRole="header">Trends</Text>
        <View className="flex-row">
          <Chip label="6M" selected={range === 6} color={colors.accent} onPress={() => setRange(6)} />
          <Chip label="12M" selected={range === 12} color={colors.accent} onPress={() => setRange(12)} />
        </View>
      </View>
      <Card className="mb-4">
        <Text className="mb-3 text-base font-semibold text-fg">Spending, last {rangeLabel}</Text>
        <Bars data={series} width={cw} label={`Spending, last ${rangeLabel}`} />
      </Card>
      <Card className="mb-4">
        <Text className="mb-3 text-base font-semibold text-fg">Income, last {rangeLabel}</Text>
        <Bars data={income} width={cw} label={`Income, last ${rangeLabel}`} />
      </Card>
      <Card className="mb-4">
        <Text className="mb-1 text-base font-semibold text-fg">Saved, last {rangeLabel}</Text>
        <Text className="mb-3 text-xs text-muted">Income minus spending, per month (never below zero).</Text>
        <Bars data={saved} width={cw} label={`Saved, last ${rangeLabel}`} />
      </Card>
      <Card className="mb-4">
        <Text className="mb-3 text-base font-semibold text-fg">Top merchants ({rangeLabel})</Text>
        {merchants.length === 0 && <Text className="text-muted">Nothing confirmed yet.</Text>}
        {merchants.map((m) => (
          <View key={m.merchant} className="mb-2 flex-row justify-between">
            <Text className="text-fg">{m.merchant} <Text className="text-xs text-muted">×{m.n}</Text></Text>
            <Text className="text-muted">{rupees(m.total)}</Text>
          </View>
        ))}
      </Card>
      <View className="h-8" />
    </ScrollView>
  );
}
