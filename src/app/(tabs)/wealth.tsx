import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ChevronRight, Landmark, ListChecks, Plus, TrendingUp } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text, TextInput } from '@/ui/Text';

import { AreaChart } from '@/components/Charts';
import { type ForecastResult, loadForecast } from '@/db/forecast';
import { type HoldingStat, holdingStats, syncHoldings } from '@/db/holdings';
import { ledgerGaps } from '@/db/ledger';
import { type NetItem, type NetWorth, deleteNetItem, netWorth, saveNetItem } from '@/db/networth';
import { onIngested } from '@/ingest/events';
import { useSecurity } from '@/security/store';
import { CountUp, FadeIn, Pressy } from '@/ui/anim';
import { PageScroll } from '@/ui/insets';
import { Button, Card, Chip, EmptyState, ListRow, SectionLabel, Sheet, Skeleton } from '@/ui/kit';
import { ForecastCard } from '@/ui/ForecastCard';
import { useTheme } from '@/ui/theme';
import { rupees, rupeesShort } from '@/utils/format';
import { HOLDING_LABEL } from '@/utils/holdings';

const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;

/** Wealth: net worth over time, where it sits (bank, investments, other) and the holdings behind it. */
export default function Wealth() {
  useSecurity();
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useTheme();
  const [nw, setNw] = useState<NetWorth | null>(null);
  const [holdings, setHoldings] = useState<HoldingStat[]>([]);
  const [gaps, setGaps] = useState(0);
  const [fc, setFc] = useState<ForecastResult | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [editing, setEditing] = useState<Partial<NetItem> | null>(null);

  const load = useCallback(async () => {
    await syncHoldings(db);
    const [n, h, g, f] = await Promise.all([netWorth(db), holdingStats(db), ledgerGaps(db), loadForecast(db)]);
    setNw(n); setHoldings(h); setGaps(g.length); setFc(f);
  }, [db]);
  useFocusEffect(useCallback(() => void load(), [load]));
  useEffect(() => onIngested(() => void load()), [load]);

  const series = nw?.series ?? [];
  const idx = sel ?? series.length - 1;
  const point = series[idx];
  const prev = idx > 0 ? series[idx - 1] : null;
  const delta = point && prev ? point.total - prev.total : null;
  const hasAnything = !!nw && (nw.banks.length > 0 || nw.unknownBanks.length > 0 || holdings.length > 0 || nw.items.length > 0);

  const parts = nw ? [
    { label: 'Bank', value: nw.bankTotal, color: colors.accent },
    { label: 'Investments', value: nw.investments, color: '#8B5CF6' },
    { label: 'Other', value: nw.assets, color: '#F59E0B' },
  ].filter((p) => p.value > 0) : [];
  const partsTotal = parts.reduce((s, p) => s + p.value, 0);

  return (
    <PageScroll tab>
      <Text className="mb-4 text-3xl font-bold text-fg" accessibilityRole="header">Wealth</Text>

      {!nw ? <Skeleton style={{ height: 220 }} /> : !hasAnything ? (
        <EmptyState icon={<TrendingUp size={44} color={colors.muted} />} title="Your net worth appears here" body="Bank balances come from your messages. SIPs and broker transfers become investments automatically." />
      ) : (
        <>
          <FadeIn index={0}>
            <Card className="mb-4">
              <Text className="text-xs font-semibold uppercase tracking-widest text-muted">{sel == null || sel === series.length - 1 ? 'Net worth today' : `Net worth · ${point.label}`}</Text>
              <CountUp value={point?.total ?? 0} format={rupees} className="mt-1 text-4xl font-bold text-fg" />
              {delta != null ? (
                <Text className={`mt-1 text-sm font-semibold ${delta >= 0 ? 'text-income' : 'text-danger'}`}>
                  {delta >= 0 ? '↑' : '↓'} {rupees(Math.abs(delta))} <Text className="font-normal text-muted">vs {prev?.label}</Text>
                </Text>
              ) : null}
              <View className="mt-3">
                <AreaChart data={series.map((s) => ({ label: s.label, value: s.total }))} selected={sel} onSelect={(i) => setSel(i === series.length - 1 ? null : i)} label="Net worth over 12 months" format={rupees} />
              </View>
            </Card>
          </FadeIn>

          {partsTotal > 0 && (
            <FadeIn index={1}>
              <Card className="mb-4">
                <View className="mb-3 h-3 flex-row overflow-hidden rounded-full bg-card2">
                  {parts.map((p) => <View key={p.label} style={{ flex: p.value, backgroundColor: p.color }} />)}
                </View>
                {parts.map((p) => (
                  <View key={p.label} className="flex-row items-center py-1">
                    <View className="mr-2 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                    <Text className="flex-1 text-sm text-fg">{p.label}</Text>
                    <Text className="text-sm text-muted" style={{ fontVariant: ['tabular-nums'] }}>{Math.round((p.value / partsTotal) * 100)}%</Text>
                    <Text className="w-28 text-right text-sm font-semibold text-fg" style={{ fontVariant: ['tabular-nums'] }}>{rupeesShort(p.value)}</Text>
                  </View>
                ))}
                {nw.liabilities > 0 ? (
                  <View className="flex-row items-center border-t border-line pt-2">
                    <Text className="flex-1 text-sm text-fg">Owed</Text>
                    <Text className="text-right text-sm font-semibold text-danger" style={{ fontVariant: ['tabular-nums'] }}>−{rupeesShort(nw.liabilities)}</Text>
                  </View>
                ) : null}
              </Card>
            </FadeIn>
          )}

          {gaps > 0 && (
            <FadeIn index={2}>
              <Pressy onPress={() => router.push('/ledger')} accessibilityRole="button" className="mb-4" innerClassName="flex-row items-center rounded-[26px] border border-line bg-card p-4">
                <View className="mr-3 h-11 w-11 items-center justify-center rounded-full bg-card2"><ListChecks size={20} color={colors.warn} /></View>
                <View className="flex-1">
                  <Text className="text-base font-semibold text-fg">{gaps} {gaps === 1 ? 'difference' : 'differences'} in your books</Text>
                  <Text className="mt-0.5 text-sm text-muted">Bank balances don't add up with what ExMan has</Text>
                </View>
                <ChevronRight size={18} color={colors.muted} />
              </Pressy>
            </FadeIn>
          )}

          {fc ? <FadeIn index={3}><ForecastCard result={fc} /></FadeIn> : null}

          <SectionLabel right={holdings.length ? <Pressable onPress={() => router.push('/investments')} hitSlop={8} accessibilityRole="button"><Text className="text-sm font-semibold text-accent">All ›</Text></Pressable> : undefined}>Investments</SectionLabel>
          {holdings.length === 0 ? (
            <Card className="mb-4"><Text className="text-sm text-muted">SIPs, broker transfers, FDs and PPF show up here on their own once ExMan sees them.</Text><Button className="mt-3" variant="secondary" label="Add a holding" onPress={() => router.push('/investments')} /></Card>
          ) : (
            <View className="mb-4">
              {holdings.slice(0, 4).map((h) => (
                <ListRow key={h.id} icon={TrendingUp} title={h.name} subtitle={`${HOLDING_LABEL[h.type]} · put in ${rupeesShort(h.putIn - h.takenOut)}`} onPress={() => router.push('/investments')}
                  right={<View className="items-end"><Text className="font-semibold text-fg" style={{ fontVariant: ['tabular-nums'] }}>{h.value != null ? rupeesShort(h.value) : '—'}</Text>{h.gainPct != null ? <Text className={`text-xs ${h.gainPct >= 0 ? 'text-income' : 'text-danger'}`}>{pct(h.gainPct)}</Text> : <Text className="text-xs text-accent">Add value</Text>}</View>} />
              ))}
            </View>
          )}

          <SectionLabel>Bank accounts</SectionLabel>
          <View className="mb-4">
            {nw.banks.length === 0 && nw.unknownBanks.length === 0 ? <Card><Text className="text-sm text-muted">Balances appear once your bank messages quote them.</Text></Card> : null}
            {nw.banks.map((b) => (
              <ListRow key={b.id} icon={Landmark} title={b.name} subtitle={b.estimated ? `Estimated from the balance you entered${b.ts ? ` on ${new Date(b.ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}` : b.stale ? 'Balance is old' : `Updated ${b.ts ? new Date(b.ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}`} onPress={() => router.push(`/account/${b.id}`)}
                right={<Text className="font-semibold text-fg" style={{ fontVariant: ['tabular-nums'] }}>{b.estimated ? '≈ ' : ''}{rupees(b.paise)}</Text>} />
            ))}
            {nw.unknownBanks.map((b) => (
              <ListRow key={b.id} icon={Landmark} title={b.name} subtitle="Its messages show no balance" onPress={() => router.push(`/account/${b.id}`)} right={<Text className="text-sm font-semibold text-accent">Add balance</Text>} />
            ))}
          </View>
        </>
      )}

      {nw ? (
        <>
          <SectionLabel right={<Pressable onPress={() => setEditing({ side: 'asset' })} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add an asset or something you owe" className="h-8 w-8 items-center justify-center rounded-full bg-card2"><Plus size={18} color={colors.accent} /></Pressable>}>Other assets and what you owe</SectionLabel>
          {nw.items.length === 0 ? <Text className="mb-4 px-1 text-sm text-muted">Cash at home, a deposit, a loan or a card balance: add what the messages cannot see.</Text> : (
            <View className="mb-4">
              {nw.items.map((i) => (
                <ListRow key={i.id} title={i.name} subtitle={i.side === 'asset' ? 'Asset' : 'You owe'} onPress={() => setEditing(i)}
                  right={<Text className={`font-semibold ${i.side === 'asset' ? 'text-fg' : 'text-danger'}`} style={{ fontVariant: ['tabular-nums'] }}>{i.side === 'asset' ? '' : '−'}{rupees(i.amount_paise)}</Text>} />
              ))}
            </View>
          )}
        </>
      ) : null}

      {editing && <ItemSheet item={editing} onClose={() => setEditing(null)} onSave={async (v) => { await saveNetItem(db, v); setEditing(null); void load(); }} onDelete={editing.id ? async () => { await deleteNetItem(db, editing.id!); setEditing(null); void load(); } : undefined} />}
    </PageScroll>
  );
}

function ItemSheet({ item, onClose, onSave, onDelete }: { item: Partial<NetItem>; onClose: () => void; onSave: (v: { id?: number; name: string; side: 'asset' | 'liability'; paise: number }) => void; onDelete?: () => void }) {
  const { colors } = useTheme();
  const [name, setName] = useState(item.name ?? '');
  const [amount, setAmount] = useState(item.amount_paise ? String(item.amount_paise / 100) : '');
  const [side, setSide] = useState<'asset' | 'liability'>(item.side ?? 'asset');
  const paise = Math.round(parseFloat(amount.replace(/,/g, '')) * 100);
  const ok = name.trim().length > 0 && paise > 0;
  return (
    <Sheet title={item.id ? 'Edit' : 'Add'} onClose={onClose} footer={
      <View className="flex-row">
        {onDelete ? <Button className="mr-3 flex-1" variant="secondary" label="Remove" onPress={onDelete} /> : null}
        <Button className="flex-1" label="Save" disabled={!ok} onPress={() => onSave({ id: item.id, name, side, paise })} />
      </View>}>
      <View className="mb-3 flex-row">
        <Chip label="Asset" selected={side === 'asset'} onPress={() => setSide('asset')} />
        <Chip label="I owe" selected={side === 'liability'} onPress={() => setSide('liability')} />
      </View>
      <TextInput className="mb-3 min-h-12 rounded-2xl bg-card2 px-4 text-base text-fg" placeholder={side === 'asset' ? 'e.g. Cash at home' : 'e.g. Car loan'} placeholderTextColor={colors.muted} value={name} onChangeText={setName} accessibilityLabel="Name" />
      <TextInput className="mb-3 min-h-12 rounded-2xl bg-card2 px-4 text-base text-fg" placeholder="Amount in rupees" placeholderTextColor={colors.muted} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" accessibilityLabel="Amount in rupees" />
    </Sheet>
  );
}
