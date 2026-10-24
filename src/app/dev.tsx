import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/ui/Text';

import { getTxns, monthlyTotals, spendByCategory } from '@/db/queries';
import { loadDemo, removeDemo } from '@/db/demo';
import { notifyIngested } from '@/ingest/events';
import { Button } from '@/ui/kit';
import { hashMessage } from '@/utils/hash';
import { PageScroll } from '@/ui/insets';

/** Seeded rows, plus the merchants they created that nothing else uses (so test names do not linger in Merchants or teach the category model). */
async function removeSeeded(db: ReturnType<typeof useSQLiteContext>) {
  await db.runAsync("DELETE FROM transactions WHERE raw_text LIKE 'SEED %'");
  await db.runAsync(
    `DELETE FROM merchants WHERE id NOT IN (SELECT merchant_id FROM transactions WHERE merchant_id IS NOT NULL)
       AND id NOT IN (SELECT merchant_id FROM rules WHERE merchant_id IS NOT NULL)
       AND id NOT IN (SELECT merchant_id FROM transfer_merchants)
       AND id NOT IN (SELECT merged_into FROM merchants WHERE merged_into IS NOT NULL)`,
  );
}

const MERCHANTS = ['swiggy@icici', 'ZOMATO', 'Uber India', 'BigBasket', 'Amazon Pay', 'Netflix', 'Apollo Pharmacy', 'Airtel', 'Chai Point', 'Rahul'];

/** Developer tools: seed synthetic rows and time the hot queries against the perf budget (docs/v2-plan.md). */
export default function Dev() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [log, setLog] = useState<string[]>([]);
  const add = (s: string) => setLog((l) => [s, ...l]);

  const time = async <T,>(label: string, fn: () => Promise<T>) => {
    const t0 = Date.now();
    const r = await fn();
    add(`${label}: ${Date.now() - t0} ms`);
    return r;
  };

  const seed = async (n: number) => {
    await time(`seed ${n} rows`, () =>
      db.withExclusiveTransactionAsync(async (tx) => {
        const now = Date.now();
        for (let i = 0; i < n; i++) {
          const ts = now - Math.floor(Math.random() * 365 * 864e5);
          const text = `SEED ${i} ${ts}`;
          await tx.runAsync(
            `INSERT OR IGNORE INTO transactions (amount_paise, direction, merchant, category_id, source, ts, status, raw_text, msg_hash)
             VALUES (?, ?, ?, ?, 'sms', ?, ?, ?, ?)`,
            Math.floor(Math.random() * 500000) + 100, Math.random() < 0.9 ? 'debit' : 'credit',
            MERCHANTS[i % MERCHANTS.length], (i % 9) + 1, ts, i % 5 === 0 ? 'pending' : 'confirmed', text, hashMessage(ts, text),
          );
        }
      }),
    );
  };

  const bench = async () => {
    const now = Date.now();
    await time('pending list', () => getTxns(db, 'pending'));
    await time('spend by category (12 mo)', () => spendByCategory(db, now - 365 * 864e5, now));
    await time('monthly totals (12 mo)', () => monthlyTotals(db, now - 365 * 864e5, now));
    const n = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM transactions');
    add(`rows in db: ${n?.n}`);
  };

  const Btn = ({ label, onPress }: { label: string; onPress: () => void }) => (
    <Button variant="secondary" className="mb-2 mr-2" label={label} onPress={onPress} />
  );

  return (
    <PageScroll>
      <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back"><Text className="mb-2 text-accent">‹ Back</Text></Pressable>
      <Text className="mb-1 text-2xl font-semibold text-fg" accessibilityRole="header">Developer</Text>
      <Text className="mb-4 text-xs text-muted">Budget: any screen's data in under 100 ms at 10,000 rows.</Text>
      <Button className="mb-3" label="Message lab" onPress={() => router.push('/lab')} />
      <View className="mb-3 flex-row">
        <Button className="mr-3 flex-1" label="Load demo data" onPress={async () => { const n = await loadDemo(db); notifyIngested(); add(`demo data loaded: ${n} transactions (an HDFC a/c ending 9999 and a card ending 9998)`); }} />
        <Button className="flex-1" variant="secondary" label="Remove demo data" onPress={async () => { await removeDemo(db); notifyIngested(); add('demo data removed'); }} />
      </View>
      <View className="flex-row flex-wrap">
        <Btn label="Seed 1,000" onPress={() => seed(1000)} />
        <Btn label="Seed 10,000" onPress={() => seed(10000)} />
        <Btn label="Benchmark" onPress={bench} />
        <Btn label="Delete seeded" onPress={async () => { await removeSeeded(db); add('seeded rows deleted'); }} />
      </View>
      {log.map((l, i) => <Text key={i} className="text-muted">{l}</Text>)}
    </PageScroll>
  );
}
