import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/ui/Text';

import type { Account, Category } from '@/db/queries';
import { Button, Chip, Sheet } from '@/ui/kit';
import { useTheme } from '@/ui/theme';
import { type TxnFilter, EMPTY_FILTER } from '@/utils/filters';
import { monthKey, monthRange, shiftMonth } from '@/utils/format';

const DAY = 864e5;
const PRESETS: { label: string; range: () => [number | undefined, number | undefined] }[] = [
  { label: 'Any time', range: () => [undefined, undefined] },
  { label: 'This month', range: () => { const [a, b] = monthRange(monthKey(new Date())); return [a, b]; } },
  { label: 'Last month', range: () => { const [a, b] = monthRange(shiftMonth(monthKey(new Date()), -1)); return [a, b]; } },
  { label: 'Last 90 days', range: () => [Date.now() - 90 * DAY, undefined] },
  { label: 'This year', range: () => [new Date(new Date().getFullYear(), 0, 1).getTime(), undefined] },
];

const toggle = (list: number[] | undefined, id: number) => {
  const cur = list ?? [];
  return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
};

export function FilterSheet({ value, cats, accounts, onApply, onClose }: { value: TxnFilter; cats: Category[]; accounts: Account[]; onApply: (f: TxnFilter) => void; onClose: () => void }) {
  const { colors } = useTheme();
  const [f, setF] = useState<TxnFilter>(value);
  const [min, setMin] = useState(f.minPaise != null ? String(f.minPaise / 100) : '');
  const [max, setMax] = useState(f.maxPaise != null ? String(f.maxPaise / 100) : '');
  const set = (p: Partial<TxnFilter>) => setF((cur) => ({ ...cur, ...p }));
  const label = 'mb-2 mt-3 text-xs uppercase tracking-wider text-muted';
  const input = 'min-h-12 flex-1 rounded-2xl bg-card2 px-4 py-3 text-base text-fg';

  const activePreset = PRESETS.findIndex((p) => { const [a, b] = p.range(); return Math.abs((a ?? 0) - (f.from ?? 0)) < 1000 && Math.abs((b ?? 0) - (f.to ?? 0)) < 1000; });

  return (
    <Sheet title="Filters" onClose={onClose}>
      <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text className={label}>Type</Text>
        <View className="flex-row flex-wrap">
          <Chip label="All" color={colors.accent} selected={!f.direction} onPress={() => set({ direction: undefined })} />
          <Chip label="Spent" color={colors.danger} selected={f.direction === 'debit'} onPress={() => set({ direction: 'debit' })} />
          <Chip label="Received" color={colors.accent} selected={f.direction === 'credit'} onPress={() => set({ direction: 'credit' })} />
        </View>

        <Text className={label}>Date</Text>
        <View className="flex-row flex-wrap">
          {PRESETS.map((p, i) => (
            <Chip key={p.label} label={p.label} color={colors.accent} selected={activePreset === i} onPress={() => { const [from, to] = p.range(); set({ from, to }); }} />
          ))}
        </View>

        <Text className={label}>Category</Text>
        <View className="flex-row flex-wrap">
          {cats.map((c) => <Chip key={c.id} label={c.name} color={c.color} selected={!!f.categoryIds?.includes(c.id)} onPress={() => set({ categoryIds: toggle(f.categoryIds, c.id) })} />)}
          <Chip label="Uncategorised" color={colors.muted} selected={!!f.categoryIds?.includes(0)} onPress={() => set({ categoryIds: toggle(f.categoryIds, 0) })} />
        </View>

        {accounts.length > 0 && (
          <>
            <Text className={label}>Account</Text>
            <View className="flex-row flex-wrap">
              {accounts.map((a) => <Chip key={a.id} label={a.name} color={colors.accent} selected={!!f.accountIds?.includes(a.id)} onPress={() => set({ accountIds: toggle(f.accountIds, a.id) })} />)}
            </View>
          </>
        )}

        <Text className={label}>Amount (₹)</Text>
        <View className="flex-row">
          <TextInput className={`${input} mr-3`} value={min} onChangeText={setMin} keyboardType="decimal-pad" placeholder="Min" placeholderTextColor={colors.muted} />
          <TextInput className={input} value={max} onChangeText={setMax} keyboardType="decimal-pad" placeholder="Max" placeholderTextColor={colors.muted} />
        </View>

        <Text className={label}>Transfers</Text>
        <View className="flex-row flex-wrap">
          {([['show', 'Show'], ['hide', 'Hide'], ['only', 'Only transfers']] as const).map(([k, l]) => (
            <Chip key={k} label={l} color={colors.accent} selected={(f.transfers ?? 'show') === k} onPress={() => set({ transfers: k })} />
          ))}
        </View>
      </ScrollView>
      <View className="mt-4 flex-row">
        <Button className="mr-3" variant="ghost" label="Reset" onPress={() => { onApply({ q: value.q, ...EMPTY_FILTER }); }} />
        <Button
          className="flex-1" label="Apply"
          onPress={() => {
            const lo = parseFloat(min), hi = parseFloat(max);
            onApply({ ...f, minPaise: lo > 0 ? Math.round(lo * 100) : undefined, maxPaise: hi > 0 ? Math.round(hi * 100) : undefined });
          }}
        />
      </View>
    </Sheet>
  );
}
