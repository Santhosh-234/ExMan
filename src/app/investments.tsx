import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { TrendingUp } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/ui/Text';

import { type HoldingStat, addManualHolding, archiveHolding, holdingStats, renameHolding, setHoldingType, setHoldingValue, syncHoldings } from '@/db/holdings';
import { onIngested } from '@/ingest/events';
import { useSecurity } from '@/security/store';
import { FadeIn } from '@/ui/anim';
import { Page } from '@/ui/insets';
import { BackButton, Button, Card, Chip, EmptyState, PageHeader, SectionLabel, Sheet, Stats } from '@/ui/kit';
import { useSnackbar } from '@/ui/Snackbar';
import { useTheme } from '@/ui/theme';
import { rupees } from '@/utils/format';
import { HOLDING_LABEL, HOLDING_TYPES, type HoldingType } from '@/utils/holdings';

const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;

/** Everything you have put into investments, with what each is worth today (entered by you) and the return so far. */
export default function Investments() {
  useSecurity();
  const db = useSQLiteContext();
  const router = useRouter();
  const snack = useSnackbar();
  const { colors } = useTheme();
  const [rows, setRows] = useState<HoldingStat[] | null>(null);
  const [edit, setEdit] = useState<HoldingStat | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => { await syncHoldings(db); setRows(await holdingStats(db)); }, [db]);
  useEffect(() => { void load(); return onIngested(() => void load()); }, [load]);

  const valued = (rows ?? []).filter((r) => r.value != null);
  const putIn = valued.reduce((s, r) => s + r.putIn, 0);
  const worth = valued.reduce((s, r) => s + r.value!, 0);
  const gain = valued.reduce((s, r) => s + r.gain!, 0);

  return (
    <Page>
      <BackButton />
      <PageHeader title="Investments" subtitle="Found from your SIP and broker messages. Enter what each is worth to see your return." right={<Button label="Add" variant="secondary" onPress={() => setAdding(true)} />} />
      <ScrollView showsVerticalScrollIndicator={false}>
        {rows && rows.length === 0 ? (
          <EmptyState icon={<TrendingUp size={44} color={colors.muted} />} title="No investments yet" body="SIP debits and transfers to brokers are picked up automatically. You can also add a holding by hand." />
        ) : null}
        {valued.length > 0 && (
          <Card className="mb-4">
            <Text className="text-xs font-semibold uppercase tracking-widest text-muted">Valued holdings</Text>
            <Text className="mb-3 mt-1 text-3xl font-bold text-fg" style={{ fontVariant: ['tabular-nums'] }}>{rupees(worth)}</Text>
            <Stats items={[
              { label: 'Put in', value: rupees(putIn) },
              { label: 'Gain', value: `${gain >= 0 ? '+' : '−'}${rupees(Math.abs(gain))}${putIn ? ` (${pct(gain / putIn)})` : ''}`, tone: gain >= 0 ? 'income' : 'danger' },
            ]} />
          </Card>
        )}
        {(rows ?? []).map((h, i) => (
          <FadeIn key={h.id} index={Math.min(i, 5)}>
            <Card className="mb-3">
              <View className="flex-row items-start justify-between">
                <View className="flex-1 pr-3">
                  <Text className="text-base font-semibold text-fg" numberOfLines={1}>{h.name}</Text>
                  <Text className="mt-0.5 text-xs text-muted">{HOLDING_LABEL[h.type]}{h.n ? ` · ${h.n} payment${h.n === 1 ? '' : 's'}` : ' · added by hand'}</Text>
                </View>
                <View className="items-end">
                  <Text className="text-lg font-bold text-fg" style={{ fontVariant: ['tabular-nums'] }}>{h.value != null ? rupees(h.value) : rupees(h.putIn - h.takenOut)}</Text>
                  <Text className="text-xs text-muted">{h.value != null ? 'worth today' : 'put in'}</Text>
                </View>
              </View>
              {h.value != null && h.gain != null ? (
                <Stats items={[
                  { label: 'Put in', value: rupees(h.putIn - h.takenOut) },
                  { label: 'Gain', value: `${h.gain >= 0 ? '+' : '−'}${rupees(Math.abs(h.gain))}${h.gainPct != null ? ` (${pct(h.gainPct)})` : ''}`, tone: h.gain >= 0 ? 'income' : 'danger' },
                  ...(h.xirr != null ? [{ label: 'Per year', value: pct(h.xirr), tone: (h.xirr >= 0 ? 'income' : 'danger') as 'income' | 'danger' }] : []),
                ]} />
              ) : null}
              {h.monthly > 0 ? <Text className="mt-2 text-xs text-muted">About {rupees(h.monthly)} a month lately</Text> : null}
              <View className="mt-3 flex-row">
                <Button className="mr-3 flex-1" label={h.value != null ? 'Update value' : 'Enter value'} onPress={() => setEdit(h)} />
                {h.n > 0 ? <Button className="flex-1" variant="secondary" label="Payments" onPress={() => router.push(`/activity?holding=${h.id}`)} /> : null}
              </View>
              {h.valued_at ? <Text className="mt-2 text-xs text-muted">Value entered {new Date(h.valued_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text> : null}
            </Card>
          </FadeIn>
        ))}
        <SectionLabel>Where does the value come from?</SectionLabel>
        <Text className="mb-6 px-1 text-sm text-muted">ExMan never looks prices up, so nothing leaves your phone. Open your fund or broker app now and then and type what it shows.</Text>
      </ScrollView>

      {edit && (
        <HoldingSheet h={edit} onClose={() => setEdit(null)}
          onSave={async (v) => { await renameHolding(db, edit.id, v.name); await setHoldingType(db, edit.id, v.type); await setHoldingValue(db, edit.id, v.paise); setEdit(null); void load(); }}
          onArchive={async () => { await archiveHolding(db, edit.id, true); setEdit(null); void load(); snack({ message: 'Holding hidden', onAction: () => void archiveHolding(db, edit.id, false).then(load) }); }} />
      )}
      {adding && <AddSheet onClose={() => setAdding(false)} onSave={async (name, type, paise) => { await addManualHolding(db, name, type, paise); setAdding(false); void load(); }} />}
    </Page>
  );
}

function HoldingSheet({ h, onClose, onSave, onArchive }: { h: HoldingStat; onClose: () => void; onSave: (v: { name: string; type: HoldingType; paise: number | null }) => void; onArchive: () => void }) {
  const { colors } = useTheme();
  const [name, setName] = useState(h.name);
  const [type, setType] = useState<HoldingType>(h.type);
  const [value, setValue] = useState(h.value != null ? String(h.value / 100) : '');
  const paise = value.trim() === '' ? null : Math.round(parseFloat(value.replace(/,/g, '')) * 100);
  const ok = name.trim().length > 0 && (paise === null || paise >= 0);
  return (
    <Sheet title={h.name} onClose={onClose} footer={<View className="flex-row"><Button className="mr-3 flex-1" variant="secondary" label="Hide" onPress={onArchive} /><Button className="flex-1" label="Save" disabled={!ok} onPress={() => onSave({ name, type, paise })} /></View>}>
      <Text className="mb-1 text-xs text-muted">Worth today (₹)</Text>
      <TextInput className="mb-3 min-h-12 rounded-2xl bg-card2 px-4 text-base text-fg" value={value} onChangeText={setValue} keyboardType="decimal-pad" placeholder="What does your app show?" placeholderTextColor={colors.muted} accessibilityLabel="Worth today in rupees" />
      <Text className="mb-1 text-xs text-muted">Name</Text>
      <TextInput className="mb-3 min-h-12 rounded-2xl bg-card2 px-4 text-base text-fg" value={name} onChangeText={setName} accessibilityLabel="Name" />
      <View className="mb-2 flex-row flex-wrap">{HOLDING_TYPES.map((t) => <Chip key={t} label={HOLDING_LABEL[t]} selected={type === t} onPress={() => setType(t)} />)}</View>
    </Sheet>
  );
}

function AddSheet({ onClose, onSave }: { onClose: () => void; onSave: (name: string, type: HoldingType, paise: number | null) => void }) {
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [type, setType] = useState<HoldingType>('other');
  const [value, setValue] = useState('');
  const paise = value.trim() === '' ? null : Math.round(parseFloat(value.replace(/,/g, '')) * 100);
  return (
    <Sheet title="Add a holding" onClose={onClose} footer={<Button label="Add" disabled={!name.trim() || (paise !== null && !(paise >= 0))} onPress={() => onSave(name, type, paise)} />}>
      <TextInput className="mb-3 min-h-12 rounded-2xl bg-card2 px-4 text-base text-fg" value={name} onChangeText={setName} placeholder="e.g. Gold coins, LIC policy" placeholderTextColor={colors.muted} accessibilityLabel="Name" />
      <TextInput className="mb-3 min-h-12 rounded-2xl bg-card2 px-4 text-base text-fg" value={value} onChangeText={setValue} keyboardType="decimal-pad" placeholder="Worth today (₹)" placeholderTextColor={colors.muted} accessibilityLabel="Worth today in rupees" />
      <View className="mb-2 flex-row flex-wrap">{HOLDING_TYPES.map((t) => <Chip key={t} label={HOLDING_LABEL[t]} selected={type === t} onPress={() => setType(t)} />)}</View>
    </Sheet>
  );
}
