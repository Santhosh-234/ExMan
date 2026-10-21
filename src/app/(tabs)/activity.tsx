import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ListOrdered } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';

import { type Category, type Txn, getCategories, getTxns } from '@/db/queries';
import { onIngested } from '@/ingest/events';
import { Amount, EmptyState, Screen } from '@/ui/kit';
import { useTheme } from '@/ui/theme';
import { rupees } from '@/utils/format';

type Item = { kind: 'day'; key: string; label: string; total: number } | { kind: 'txn'; key: string; t: Txn };

const dayLabel = (ts: number) => {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(today.getTime() - 864e5);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
};

// Phase 2 ledger: day-grouped, virtualised. Search, filters and bulk edit arrive in phase 3.
export default function Activity() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const [txns, setTxns] = useState<Txn[]>([]);
  const [cats, setCats] = useState<Category[]>([]);

  const load = useCallback(async () => {
    setCats(await getCategories(db));
    setTxns(await getTxns(db, 'confirmed'));
  }, [db]);
  useFocusEffect(useCallback(() => void load(), [load]));
  useEffect(() => onIngested(() => void load()), [load]);

  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    let cur: { label: string; total: number; idx: number } | null = null;
    for (const t of txns) {
      const label = dayLabel(t.ts);
      if (!cur || cur.label !== label) {
        cur = { label, total: 0, idx: out.length };
        out.push({ kind: 'day', key: `d${t.ts}`, label, total: 0 });
      }
      if (t.direction === 'debit') {
        cur.total += t.amount_paise;
        (out[cur.idx] as Extract<Item, { kind: 'day' }>).total = cur.total;
      }
      out.push({ kind: 'txn', key: `t${t.id}`, t });
    }
    return out;
  }, [txns]);

  return (
    <Screen title="Activity">
      <FlatList
        data={items}
        keyExtractor={(i) => i.key}
        ListEmptyComponent={<EmptyState icon={<ListOrdered size={44} color={colors.muted} />} title="No confirmed transactions yet" body="Review new transactions on Home and they will appear here." />}
        initialNumToRender={14}
        windowSize={9}
        removeClippedSubviews
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) =>
          item.kind === 'day' ? (
            <View className="mb-1 mt-4 flex-row justify-between">
              <Text className="text-sm font-semibold text-muted">{item.label}</Text>
              {item.total > 0 && <Text className="text-sm text-muted">{rupees(item.total)} spent</Text>}
            </View>
          ) : (
            <View className="mb-2 flex-row items-center rounded-2xl bg-card p-3">
              <View className="mr-3 h-10 w-10 rounded-full" style={{ backgroundColor: catById.get(item.t.category_id ?? -1)?.color ?? colors.surface2 }} />
              <View className="flex-1">
                <Text className="text-base text-fg" numberOfLines={1}>{item.t.merchant ?? 'Unknown'}</Text>
                <Text className="text-xs text-muted" numberOfLines={1}>
                  {catById.get(item.t.category_id ?? -1)?.name ?? 'Uncategorised'} · {item.t.bank ?? ''} {item.t.account_last4 ? `…${item.t.account_last4}` : ''}
                </Text>
              </View>
              <Amount paise={item.t.amount_paise} direction={item.t.direction} className="text-base" />
            </View>
          )
        }
      />
    </Screen>
  );
}
