import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/ui/Text';

import { AreaChart } from '@/components/Charts';
import type { ForecastResult } from '@/db/forecast';
import { Card } from '@/ui/kit';
import { rupees, rupeesShort } from '@/utils/format';

const KIND: Record<string, string> = { income: 'In', recurring: 'Payment', bill: 'Bill', sip: 'Investment', loan: 'EMI' };
const dateLabel = (ts: number) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** The next 30 days: where the bank balance is heading, what is coming and the day it could run short. */
export function ForecastCard({ result }: { result: ForecastResult }) {
  const f = result.forecast;
  const [sel, setSel] = useState<number | null>(null);
  const idx = sel ?? f.points.length - 1;
  const p = f.points[idx];
  const short = f.shortfallTs != null;
  return (
    <Card className="mb-4">
      <Text className="text-xs font-semibold uppercase tracking-widest text-muted">Next 30 days</Text>
      <View className="mt-1 flex-row items-end justify-between">
        <View className="flex-1 pr-3">
          <Text className="text-3xl font-bold text-fg" style={{ fontVariant: ['tabular-nums'] }}>{rupees(p.balance)}</Text>
          <Text className="text-xs text-muted">{sel == null ? `by ${dateLabel(p.ts)}` : `on ${dateLabel(p.ts)}`}</Text>
        </View>
        <View className="items-end">
          <Text className="text-xs text-muted">Safe to spend a day</Text>
          <Text className="text-base font-semibold text-fg" style={{ fontVariant: ['tabular-nums'] }}>{rupees(f.safeDaily)}</Text>
        </View>
      </View>
      <View className="mt-3">
        <AreaChart data={f.points.map((x) => ({ label: x.label, value: x.balance }))} selected={sel} onSelect={(i) => setSel(i === f.points.length - 1 ? null : i)} label="Projected balance for the next 30 days" format={rupees} color={short ? '#E5484D' : undefined} />
      </View>
      {short ? (
        <View className="mt-3 rounded-2xl bg-card2 px-3 py-2"><Text className="text-sm font-semibold text-danger">Could run short around {dateLabel(f.shortfallTs!)}</Text></View>
      ) : (
        <Text className="mt-2 text-xs text-muted">Lowest point {rupeesShort(f.low.balance)} on {dateLabel(f.low.ts)}</Text>
      )}
      {f.upcoming.length > 0 && (
        <View className="mt-3 border-t border-line pt-2">
          {f.upcoming.slice(0, 5).map((u, i) => (
            <View key={`${u.ts}${u.label}${i}`} className="flex-row items-center py-1.5">
              <Text className="w-14 text-xs text-muted">{dateLabel(u.ts)}</Text>
              <View className="flex-1 pr-2"><Text className="text-sm text-fg" numberOfLines={1}>{u.label}</Text><Text className="text-xs text-muted">{KIND[u.kind]}</Text></View>
              <Text className={`text-sm font-semibold ${u.paise >= 0 ? 'text-income' : 'text-fg'}`} style={{ fontVariant: ['tabular-nums'] }}>{u.paise >= 0 ? '+' : '−'}{rupeesShort(Math.abs(u.paise))}</Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}
