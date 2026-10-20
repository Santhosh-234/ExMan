import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';

import { Bars } from '@/components/Charts';
import { topMerchants, totalFor } from '@/db/queries';
import { monthKey, monthLabel, monthRange, rupees, shiftMonth } from '@/utils/format';

export default function Analytics() {
  const db = useSQLiteContext();
  const { width } = useWindowDimensions();
  const [series, setSeries] = useState<{ label: string; value: number }[]>([]);
  const [income, setIncome] = useState<{ label: string; value: number }[]>([]);
  const [merchants, setMerchants] = useState<{ merchant: string; total: number; n: number }[]>([]);

  const load = useCallback(async () => {
    const now = monthKey(new Date());
    const months = [5, 4, 3, 2, 1, 0].map((i) => shiftMonth(now, -i));
    const lab = (m: string) => monthLabel(m).split(' ')[0];
    setSeries(await Promise.all(months.map(async (m) => ({ label: lab(m), value: await totalFor(db, 'debit', ...monthRange(m)) }))));
    setIncome(await Promise.all(months.map(async (m) => ({ label: lab(m), value: await totalFor(db, 'credit', ...monthRange(m)) }))));
    setMerchants(await topMerchants(db, monthRange(months[0])[0], monthRange(now)[1], 8));
  }, [db]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const cw = width - 64;
  return (
    <ScrollView className="flex-1 bg-base px-4 pt-16">
      <Text className="mb-4 text-2xl font-semibold text-white">Analytics</Text>
      <View className="mb-4 rounded-2xl bg-card p-4">
        <Text className="mb-3 text-base font-semibold text-white">Spending, last 6 months</Text>
        <Bars data={series} width={cw} />
      </View>
      <View className="mb-4 rounded-2xl bg-card p-4">
        <Text className="mb-3 text-base font-semibold text-white">Income, last 6 months</Text>
        <Bars data={income} width={cw} />
      </View>
      <View className="mb-4 rounded-2xl bg-card p-4">
        <Text className="mb-3 text-base font-semibold text-white">Top merchants (6 months)</Text>
        {merchants.length === 0 && <Text className="text-gray-400">Nothing confirmed yet.</Text>}
        {merchants.map((m) => (
          <View key={m.merchant} className="mb-2 flex-row justify-between">
            <Text className="text-white">{m.merchant} <Text className="text-xs text-gray-400">×{m.n}</Text></Text>
            <Text className="text-gray-300">{rupees(m.total)}</Text>
          </View>
        ))}
      </View>
      <View className="h-8" />
    </ScrollView>
  );
}
