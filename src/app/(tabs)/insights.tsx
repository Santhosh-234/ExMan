import { useSecurity } from '@/security/store';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '@/ui/Text';

import { Bars, Pie } from '@/components/Charts';
import { MonthBar } from '@/components/MonthBar';
import { type CategorySpend, monthlyTotals, spendByCategory, topMerchants, totalFor } from '@/db/queries';
import { onIngested } from '@/ingest/events';
import { Lightbulb, Repeat } from 'lucide-react-native';
import { AnimatedBar, FadeIn, Pressy } from '@/ui/anim';
import { Card, Chip, SectionLabel } from '@/ui/kit';
import { useTheme } from '@/ui/theme';
import { monthKey, monthLabel, monthRange, rupees, shiftMonth } from '@/utils/format';
import { buildCallouts } from '@/utils/insights';
import { getRecurring, monthlyTotal } from '@/db/recurring';
import { useRouter } from 'expo-router';

export default function Insights() {
  useSecurity(); // re-render when "hide amounts" changes
  const db = useSQLiteContext();
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
  const rangeLabel = range === 6 ? '6 months' : '12 months';

  return (
    <ScrollView className="flex-1 bg-base px-4 pt-14" showsVerticalScrollIndicator={false}>
      <Text className="mb-4 text-3xl font-bold text-fg" accessibilityRole="header">Insights</Text>
      <MonthBar month={month} onChange={setMonth} max={nowKey} />

      {subs.n > 0 && (
        <Pressy onPress={() => router.push('/subscriptions')} accessibilityRole="button" className="mb-4" innerClassName="flex-row items-center rounded-[26px] border border-line bg-card p-4">
          <View className="mr-3 h-11 w-11 items-center justify-center rounded-full bg-card2"><Repeat size={20} color={colors.accent} /></View>
          <View className="flex-1">
            <Text className="text-base font-semibold text-fg">Subscriptions</Text>
            <Text className="mt-0.5 text-sm text-muted">About {rupees(subs.monthly)} a month across {subs.n} recurring payment{subs.n === 1 ? '' : 's'}</Text>
          </View>
          <Text className="text-lg text-muted">›</Text>
        </Pressy>
      )}

      {callouts.length > 0 && (
        <Card className="mb-4">
          <Text className="mb-2 text-base font-semibold text-fg">This month</Text>
          {callouts.map((c) => (
            <View key={c} className="mb-2 flex-row items-start">
              <View className="mr-3 mt-0.5 h-7 w-7 items-center justify-center rounded-full bg-card2"><Lightbulb size={14} color={colors.accent} /></View>
              <Text className="flex-1 text-fg">{c}</Text>
            </View>
          ))}
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
            <Pie data={shown.map((s) => ({ label: s.name, value: s.total, color: s.color }))} label={`Spending in ${monthLabel(month)}`} center={{ title: filter === 'all' ? 'Spent' : shown[0]?.name ?? '', value: rupees(shown.reduce((a, s) => a + s.total, 0)) }} />
            <View className="mt-4 w-full">
              {shown.map((s) => {
                const sum = shown.reduce((a, x) => a + x.total, 0) || 1;
                return (
                  <View key={String(s.category_id)} className="mb-3">
                    <View className="mb-1 flex-row items-center justify-between">
                      <View className="flex-row items-center"><View className="mr-2 h-3 w-3 rounded-full" style={{ backgroundColor: s.color }} /><Text className="text-fg">{s.name}</Text></View>
                      <Text className="text-muted" style={{ fontVariant: ['tabular-nums'] }}>{rupees(s.total)} · {Math.round((s.total / sum) * 100)}%</Text>
                    </View>
                    <AnimatedBar pct={s.total / sum} color={s.color} height={6} />
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </Card>

      <SectionLabel right={
        <View className="flex-row">
          <Chip label="6M" selected={range === 6} color={colors.accent} onPress={() => setRange(6)} />
          <Chip label="12M" selected={range === 12} color={colors.accent} onPress={() => setRange(12)} />
        </View>
      }>Trends</SectionLabel>
      <Card className="mb-4">
        <Text className="mb-3 text-base font-semibold text-fg">Spending, last {rangeLabel}</Text>
        <Bars data={series} label={`Spending, last ${rangeLabel}`} />
      </Card>
      <Card className="mb-4">
        <Text className="mb-3 text-base font-semibold text-fg">Income, last {rangeLabel}</Text>
        <Bars data={income} label={`Income, last ${rangeLabel}`} />
      </Card>
      <Card className="mb-4">
        <Text className="mb-1 text-base font-semibold text-fg">Saved, last {rangeLabel}</Text>
        <Text className="mb-3 text-xs text-muted">Income minus spending, per month (never below zero).</Text>
        <Bars data={saved} label={`Saved, last ${rangeLabel}`} />
      </Card>
      <Card className="mb-4">
        <Text className="mb-3 text-base font-semibold text-fg">Top merchants ({rangeLabel})</Text>
        {merchants.length === 0 && <Text className="text-muted">Nothing confirmed yet.</Text>}
        {merchants.map((m) => (
          <View key={m.merchant} className="mb-3">
            <View className="mb-1 flex-row justify-between">
              <Text className="flex-1 pr-2 text-fg" numberOfLines={1}>{m.merchant} <Text className="text-xs text-muted">×{m.n}</Text></Text>
              <Text className="text-muted" style={{ fontVariant: ['tabular-nums'] }}>{rupees(m.total)}</Text>
            </View>
            <AnimatedBar pct={m.total / Math.max(1, merchants[0]?.total ?? 1)} color={colors.accent} height={5} />
          </View>
        ))}
      </Card>
      <View className="h-8" />
    </ScrollView>
  );
}
