import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { ingest } from '@/ingest/run';

type Txn = { id: number; amount_paise: number; direction: string; merchant: string | null; source: string; bank: string | null; account_last4: string | null; ts: number };
type Miss = { id: number; sender: string; text: string; ts: number };

// ponytail: debug view (raw rows, no swipe/category UI). Replaced by the real Inbox in Step 3.
export default function Inbox() {
  const db = useSQLiteContext();
  const [txns, setTxns] = useState<Txn[]>([]);
  const [misses, setMisses] = useState<Miss[]>([]);

  const load = useCallback(async () => {
    await ingest(db);
    setTxns(await db.getAllAsync<Txn>('SELECT * FROM transactions ORDER BY ts DESC LIMIT 50'));
    setMisses(await db.getAllAsync<Miss>('SELECT * FROM unparsed ORDER BY ts DESC LIMIT 20'));
  }, [db]);
  useFocusEffect(useCallback(() => void load(), [load]));

  return (
    <ScrollView className="flex-1 bg-base px-4 pt-16">
      <View className="mb-4 flex-row items-center justify-between">
        <Text className="text-2xl font-semibold text-white">Inbox</Text>
        <Pressable onPress={load}><Text className="text-accent">Refresh</Text></Pressable>
      </View>
      {txns.length === 0 && <Text className="mb-4 text-gray-400">No transactions captured yet.</Text>}
      {txns.map((t) => (
        <View key={t.id} className="mb-2 rounded-2xl bg-card p-4">
          <Text className={t.direction === 'debit' ? 'text-lg text-red-400' : 'text-lg text-accent'}>
            {t.direction === 'debit' ? '-' : '+'}₹{(t.amount_paise / 100).toFixed(2)}
          </Text>
          <Text className="text-white">{t.merchant ?? 'Unknown'}</Text>
          <Text className="text-xs text-gray-400">
            {t.source} · {t.bank ?? '?'} · a/c {t.account_last4 ?? '?'} · {new Date(t.ts).toLocaleString()}
          </Text>
        </View>
      ))}
      {misses.length > 0 && <Text className="mb-2 mt-4 text-amber-400">Not recognised ({misses.length})</Text>}
      {misses.map((m) => (
        <View key={m.id} className="mb-2 rounded-2xl bg-card p-4">
          <Text className="text-xs text-gray-400">{m.sender} · {new Date(m.ts).toLocaleString()}</Text>
          <Text className="text-white">{m.text}</Text>
        </View>
      ))}
      <View className="h-8" />
    </ScrollView>
  );
}
