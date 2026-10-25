import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Plus, Repeat } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/ui/Text';

import { dismissRecurring, getRecurring, getSuggestions, markSubscription, monthlyTotal, recentPayees, restoreRecurring, unmarkSubscription } from '@/db/recurring';
import { CadenceSheet } from '@/ui/CadenceSheet';
import { onIngested } from '@/ingest/events';
import { useSecurity } from '@/security/store';
import { track } from '@/telemetry';
import { FadeIn } from '@/ui/anim';
import { BackButton, Button, Card, EmptyState, IconButton, ListRow, PageHeader, SectionLabel, Sheet } from '@/ui/kit';
import { useSnackbar } from '@/ui/Snackbar';
import { useTheme } from '@/ui/theme';
import { rupees } from '@/utils/format';
import { type Maybe, type Recurring, cadenceLabel } from '@/utils/recurring';
import { Page } from '@/ui/insets';

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
  const [maybe, setMaybe] = useState<Maybe[]>([]);
  const [adding, setAdding] = useState(false);
  const [payees, setPayees] = useState<Awaited<ReturnType<typeof recentPayees>>>([]);
  const [find, setFind] = useState('');
  const [picked, setPicked] = useState<{ id: number; name: string } | null>(null);

  const load = useCallback(async () => { const [l, m] = await Promise.all([getRecurring(db), getSuggestions(db)]); setList(l); setMaybe(m); }, [db]);
  useEffect(() => void load(), [load]);
  useEffect(() => onIngested(() => void load()), [load]);

  const live = (list ?? []).filter((r) => r.status !== 'ended');
  const ended = (list ?? []).filter((r) => r.status === 'ended');
  const total = monthlyTotal(list ?? []);

  const row = (r: Recurring, i: number) => (
    <FadeIn key={`${r.merchant_id}-${r.series ?? ''}`} index={i}>
      <ListRow icon={Repeat} muted={r.status === 'ended'} onPress={() => setSel(r)}
        title={r.series ? `${r.merchant} · ${rupees(r.series)}` : r.merchant}
        subtitle={`${cadenceLabel(r.cadence)}${r.varies ? ' · amount varies' : ''}${r.manual ? ' · added by you' : ''} · ${r.status === 'ended' ? 'no recent charge' : dueText(r)}${r.priceChange ? ` · price up from ${rupees(r.priceChange.from)}` : ''}`}
        right={<Text className="mr-1 text-base font-semibold text-fg" style={{ fontVariant: ['tabular-nums'] }}>{rupees(r.amount)}</Text>} />
    </FadeIn>
  );

  return (
    <Page>
      <BackButton />
      <PageHeader title="Subscriptions" subtitle="Payments that repeat on a schedule. Add one yourself if ExMan has not spotted it." right={<IconButton icon={Plus} label="Add a subscription" onPress={async () => { setPayees(await recentPayees(db)); setFind(''); setAdding(true); }} />} />
      <ScrollView showsVerticalScrollIndicator={false}>
        {live.length > 0 && (
          <Card className="mb-4">
            <Text className="text-xs font-semibold uppercase tracking-widest text-muted">About</Text>
            <Text className="mt-1 text-4xl font-bold text-fg">{rupees(total)} <Text className="text-base font-normal text-muted">a month</Text></Text>
            <Text className="mt-1 text-sm text-muted">{rupees(total * 12)} a year across {live.length} recurring payment{live.length === 1 ? '' : 's'}.</Text>
          </Card>
        )}
        {list && live.length === 0 && ended.length === 0 && <EmptyState icon={<Repeat size={44} color={colors.muted} />} title="No recurring payments found yet" body="They appear once a payee has charged you on a regular schedule a few times." />}
        {maybe.length > 0 && (
          <>
            <SectionLabel>Might be subscriptions</SectionLabel>
            {maybe.map((m) => (
              <Card key={m.merchant_id} className="mb-3">
                <View className="flex-row items-center justify-between">
                  <Text className="flex-1 pr-2 text-base font-semibold text-fg" numberOfLines={1}>{m.merchant}</Text>
                  <Text className="text-base font-semibold text-fg" style={{ fontVariant: ['tabular-nums'] }}>{rupees(m.amount)}</Text>
                </View>
                <Text className="mt-0.5 text-sm text-muted">Charged {m.count} times, {cadenceLabel(m.cadence).toLowerCase()}</Text>
                <View className="mt-3 flex-row">
                  <Button className="mr-3 flex-1" label="Yes, subscription" onPress={async () => { await markSubscription(db, m.merchant_id, m.cadence); track('feature_used', { feature: 'subscription_marked' }); load(); snack({ message: `${m.merchant} added`, onAction: async () => { await unmarkSubscription(db, m.merchant_id); load(); } }); }} />
                  <Button className="flex-1" variant="secondary" label="No" onPress={async () => { await dismissRecurring(db, m.merchant_id); load(); snack({ message: `${m.merchant} will not be suggested`, onAction: async () => { await restoreRecurring(db, m.merchant_id); load(); } }); }} />
                </View>
              </Card>
            ))}
          </>
        )}
        {live.length > 0 && maybe.length > 0 && <SectionLabel>Found</SectionLabel>}
        {live.map(row)}
        {ended.length > 0 && (
          <>
            <Pressable onPress={() => setShowEnded((v) => !v)} className="mb-2 mt-3 min-h-9 justify-center" accessibilityRole="button"><Text className="font-semibold text-accent">{showEnded ? 'Hide' : 'Show'} possibly cancelled ({ended.length})</Text></Pressable>
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
          <Button variant="danger" label={sel.manual ? 'Remove from subscriptions' : 'Not a subscription'} onPress={async () => {
            const r = sel; setSel(null);
            await dismissRecurring(db, r.merchant_id);
            track('feature_used', { feature: 'subscription_dismissed' });
            load();
            snack({ message: `${r.merchant} removed from subscriptions`, onAction: async () => { await restoreRecurring(db, r.merchant_id); load(); } });
          }} />
        </Sheet>
      )}

      {adding && !picked && (
        <Sheet title="Add a subscription" onClose={() => setAdding(false)}>
          <TextInput className="mb-3 min-h-12 rounded-2xl bg-card2 px-4 text-base text-fg" value={find} onChangeText={setFind} placeholder="Search who you pay" placeholderTextColor={colors.muted} accessibilityLabel="Search payees" />
          {payees.filter((p) => p.merchant.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 25).map((p) => (
            <ListRow key={p.merchant_id} title={p.merchant} subtitle={`Last paid ${new Date(p.last_ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`} onPress={() => setPicked({ id: p.merchant_id, name: p.merchant })}
              right={<Text className="mr-1 text-base text-fg" style={{ fontVariant: ['tabular-nums'] }}>{rupees(p.last_amount)}</Text>} />
          ))}
          {payees.length === 0 ? <Text className="text-sm text-muted">Nothing paid recently to choose from.</Text> : null}
        </Sheet>
      )}
      {picked && (
        <CadenceSheet title={`How often does ${picked.name} charge you?`} onClose={() => { setPicked(null); setAdding(false); }}
          onPick={async (c) => { const p = picked; setPicked(null); setAdding(false); await markSubscription(db, p.id, c); track('feature_used', { feature: 'subscription_marked' }); load(); snack({ message: `${p.name} added to subscriptions`, onAction: async () => { await unmarkSubscription(db, p.id); load(); } }); }} />
      )}
    </Page>
  );
}
