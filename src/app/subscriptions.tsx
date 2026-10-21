import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ChevronLeft, Repeat } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { dismissRecurring, getRecurring, monthlyTotal, restoreRecurring } from '@/db/recurring';
import { onIngested } from '@/ingest/events';
import { useSecurity } from '@/security/store';
import { track } from '@/telemetry';
import { Button, Card, EmptyState, Sheet } from '@/ui/kit';
import { useSnackbar } from '@/ui/Snackbar';
import { useTheme } from '@/ui/theme';
import { rupees } from '@/utils/format';
import { type Recurring, cadenceLabel } from '@/utils/recurring';

const DAY = 864e5;
export const dueText = (r: Recurring, now = Date.now()) => {
  const d = Math.round((r.nextTs - now) / DAY);
  if (r.status === 'overdue') return `Was due ${Math.max(1, -d)} day${-d === 1 ? '' : 's'} ago`;
  return d <= 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : d < 14 ? `Due in ${d} days` : `Due ${new Date(r.nextTs).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
};

export default function Subscriptions() {
  useSecurity();
  const db = useSQLiteContext();
  const router = useRouter();
  const snack = useSnackbar();
  const { colors } = useTheme();
  const [list, setList] = useState<Recurring[] | null>(null);
  const [sel, setSel] = useState<Recurring | null>(null);
  const [showEnded, setShowEnded] = useState(false);

  const load = useCallback(async () => setList(await getRecurring(db)), [db]);
  useEffect(() => void load(), [load]);
  useEffect(() => onIngested(() => void load()), [load]);

  const live = (list ?? []).filter((r) => r.status !== 'ended');
  const ended = (list ?? []).filter((r) => r.status === 'ended');
  const total = monthlyTotal(list ?? []);

  const row = (r: Recurring) => (
    <Pressable key={r.merchant_id} onPress={() => setSel(r)} accessibilityRole="button" className={`mb-2 min-h-16 flex-row items-center rounded-2xl bg-card p-3 ${r.status === 'ended' ? 'opacity-60' : ''}`}>
      <View className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-card2"><Repeat size={18} color={colors.muted} /></View>
      <View className="flex-1">
        <Text className="text-base text-fg" numberOfLines={1}>{r.merchant}</Text>
        <Text className="text-xs text-muted" numberOfLines={1}>{cadenceLabel(r.cadence)}{r.varies ? ' · amount varies' : ''} · {r.status === 'ended' ? 'no recent charge' : dueText(r)}</Text>
        {r.priceChange ? <Text className="text-xs text-warn">Price went up from {rupees(r.priceChange.from)} to {rupees(r.priceChange.to)}</Text> : null}
      </View>
      <Text className="text-base text-fg">{rupees(r.amount)}</Text>
    </Pressable>
  );

  return (
    <View className="flex-1 bg-base px-4 pt-14">
      <Pressable onPress={() => router.back()} hitSlop={12} className="mb-2 flex-row items-center" accessibilityRole="button" accessibilityLabel="Back">
        <ChevronLeft color={colors.fg} /><Text className="text-fg">Back</Text>
      </Pressable>
      <Text className="text-3xl font-bold text-fg" accessibilityRole="header">Subscriptions</Text>
      <Text className="mb-3 text-xs text-muted">Payments that repeat on a schedule, found from your confirmed spending. A pattern needs about 3 charges (2 for yearly ones).</Text>
      <ScrollView showsVerticalScrollIndicator={false}>
        {live.length > 0 && (
          <Card className="mb-4">
            <Text className="text-xs uppercase tracking-wider text-muted">About</Text>
            <Text className="text-3xl font-bold text-fg">{rupees(total)} <Text className="text-base font-normal text-muted">a month</Text></Text>
            <Text className="text-sm text-muted">{rupees(total * 12)} a year across {live.length} recurring payment{live.length === 1 ? '' : 's'}.</Text>
          </Card>
        )}
        {list && live.length === 0 && ended.length === 0 && <EmptyState icon={<Repeat size={44} color={colors.muted} />} title="No recurring payments found yet" body="They appear once a payee has charged you on a regular schedule a few times." />}
        {live.map(row)}
        {ended.length > 0 && (
          <>
            <Pressable onPress={() => setShowEnded((v) => !v)} className="mb-2 mt-3" accessibilityRole="button"><Text className="text-accent">{showEnded ? 'Hide' : 'Show'} possibly cancelled ({ended.length})</Text></Pressable>
            {showEnded && ended.map(row)}
          </>
        )}
        <View className="h-10" />
      </ScrollView>

      {sel && (
        <Sheet title={sel.merchant} onClose={() => setSel(null)}>
          <Text className="mb-1 text-base text-fg">{rupees(sel.amount)} · {cadenceLabel(sel.cadence).toLowerCase()}</Text>
          <Text className="mb-1 text-sm text-muted">{sel.count} charges since {new Date(sel.firstTs).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}. Last on {new Date(sel.lastTs).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.</Text>
          <Text className="mb-3 text-sm text-muted">{sel.status === 'ended' ? 'No charge for a while: it may have been cancelled.' : `Costs about ${rupees(sel.monthlyCost)} a month. ${dueText(sel)}.`}</Text>
          <Button className="mb-2" variant="secondary" label="View its transactions" onPress={() => { const n = sel.merchant; setSel(null); router.push(`/activity?q=${encodeURIComponent(n)}`); }} />
          <Button variant="danger" label="Not a subscription" onPress={async () => {
            const r = sel; setSel(null);
            await dismissRecurring(db, r.merchant_id);
            track('feature_used', { feature: 'subscription_dismissed' });
            load();
            snack({ message: `${r.merchant} removed from subscriptions`, onAction: async () => { await restoreRecurring(db, r.merchant_id); load(); } });
          }} />
        </Sheet>
      )}
    </View>
  );
}
