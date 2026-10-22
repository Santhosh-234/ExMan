import { useSecurity } from '@/security/store';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Search } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Text, TextInput } from '@/ui/Text';

import { type MerchantStats, applyRuleToExisting, getMerchantStats, mergeMerchant, renameMerchant, setMerchantRule } from '@/db/merchants';
import { type Category, getCategories } from '@/db/queries';
import { isTransferMerchant, setTransferMerchant } from '@/db/transfers';
import { notifyIngested } from '@/ingest/events';
import { track } from '@/telemetry';
import { Button, Card, EmptyState, Sheet, BackButton } from '@/ui/kit';
import { CategoryChips } from '@/ui/sheets';
import { useSnackbar } from '@/ui/Snackbar';
import { useTheme } from '@/ui/theme';
import { rupees } from '@/utils/format';

type Mode = null | 'menu' | 'rename' | 'category' | 'merge';

export default function Merchants() {
  useSecurity(); // re-render when "hide amounts" changes
  const db = useSQLiteContext();
  const router = useRouter();
  const snack = useSnackbar();
  const { colors } = useTheme();
  const [list, setList] = useState<MerchantStats[] | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<MerchantStats | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [name, setName] = useState('');
  const [mq, setMq] = useState('');
  const [isXfer, setIsXfer] = useState(false);

  const load = useCallback(async () => { setList(await getMerchantStats(db)); setCats(await getCategories(db)); }, [db]);
  useEffect(() => void load(), [load]);
  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const shown = useMemo(() => (list ?? []).filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase())), [list, q]);
  const close = () => { setMode(null); setSel(null); setMq(''); };

  return (
    <View className="flex-1 bg-base px-4 pt-14">
      <BackButton />
      <Text className="text-3xl font-bold text-fg" accessibilityRole="header">Merchants</Text>
      <Text className="mb-3 text-xs text-muted">ExMan groups different spellings of the same payee. Rename or merge here if it got one wrong.</Text>
      <View className="mb-3 min-h-12 flex-row items-center rounded-[22px] border border-line bg-card px-3">
        <Search size={18} color={colors.muted} />
        <TextInput className="ml-2 flex-1 text-base text-fg" value={q} onChangeText={setQ} placeholder="Search merchants" placeholderTextColor={colors.muted} accessibilityLabel="Search merchants" />
      </View>
      <FlatList
        data={shown}
        keyExtractor={(m) => String(m.id)}
        ListEmptyComponent={list ? <EmptyState title="No merchants yet" body="They appear as transactions come in." /> : undefined}
        initialNumToRender={14}
        windowSize={9}
        contentContainerStyle={{ paddingBottom: 40 }}
        renderItem={({ item: m }) => {
          const c = catById.get(m.rule_category_id ?? m.category_id ?? -1);
          return (
            <Pressable onPress={() => { setSel(m); setMode('menu'); void isTransferMerchant(db, m.id).then(setIsXfer); }} accessibilityRole="button" className="mb-2 min-h-16 flex-row items-center rounded-[22px] border border-line bg-card p-3">
              <View className="mr-3 h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: c?.color ?? colors.surface2 }}>
                <Text className="text-base font-bold text-white">{m.name[0]?.toUpperCase()}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-base text-fg" numberOfLines={1}>{m.name}</Text>
                <Text className="text-xs text-muted" numberOfLines={1}>{m.n} transaction{m.n === 1 ? '' : 's'} · {c?.name ?? 'Uncategorised'}{m.rule_category_id ? ' · rule' : ''}</Text>
              </View>
              <Text className="text-muted">{rupees(m.spent)}</Text>
            </Pressable>
          );
        }}
      />

      {sel && mode === 'menu' && (
        <Sheet title={sel.name} onClose={close}>
          <Button className="mb-2" variant="secondary" label="Always categorise as…" onPress={() => setMode('category')} />
          <Button className="mb-2" variant="secondary" label={isXfer ? 'Stop treating as a transfer' : 'Always treat as a transfer'} onPress={async () => {
            const m = sel; close();
            const { n, undo } = await setTransferMerchant(db, m.id, !isXfer);
            notifyIngested(); load();
            snack({ message: !isXfer ? `${m.name} is now always a transfer${n ? ` · ${n} marked` : ''}` : `${m.name} is no longer a transfer${n ? ` · ${n} unmarked` : ''}`, onAction: () => void undo().then(() => { notifyIngested(); load(); }) });
          }} />
          <Button className="mb-2" variant="secondary" label="Rename" onPress={() => { setName(sel.name); setMode('rename'); }} />
          <Button className="mb-2" variant="secondary" label="Merge into another merchant…" onPress={() => setMode('merge')} />
          <Button variant="ghost" label="View transactions" onPress={() => { const n = sel.name; close(); router.push(`/activity?q=${encodeURIComponent(n)}`); }} />
        </Sheet>
      )}
      {sel && mode === 'category' && (
        <Sheet title={`Always categorise ${sel.name} as…`} onClose={close}>
          <CategoryChips cats={cats} value={sel.rule_category_id ?? sel.category_id} onPick={async (id) => {
            const m = sel; close();
            await setMerchantRule(db, m.id, id);
            const { n, undo } = await applyRuleToExisting(db, { merchantId: m.id, categoryId: id });
            notifyIngested(); load();
            snack({ message: n ? `Rule saved · updated ${n} transaction${n === 1 ? '' : 's'}` : 'Rule saved', onAction: n ? () => void undo().then(() => { notifyIngested(); load(); }) : undefined });
          }} />
        </Sheet>
      )}
      {sel && mode === 'rename' && (
        <Sheet title="Rename merchant" onClose={close}>
          <TextInput className="mb-3 min-h-12 rounded-2xl bg-card2 px-4 py-3 text-base text-fg" value={name} onChangeText={setName} autoFocus placeholderTextColor={colors.muted} />
          <Button label="Save" disabled={!name.trim()} onPress={async () => { const m = sel; close(); await renameMerchant(db, m.id, name.trim()); notifyIngested(); load(); }} />
        </Sheet>
      )}
      {sel && mode === 'merge' && (
        <Sheet title={`Merge ${sel.name} into…`} onClose={close}>
          <Text className="mb-2 text-sm text-muted">Their transactions are combined, and future messages for “{sel.name}” go to the merchant you pick.</Text>
          <TextInput className="mb-2 min-h-12 rounded-2xl bg-card2 px-4 py-3 text-base text-fg" value={mq} onChangeText={setMq} placeholder="Search…" placeholderTextColor={colors.muted} autoFocus />
          {(list ?? []).filter((m) => m.id !== sel.id && m.name.toLowerCase().includes(mq.trim().toLowerCase())).slice(0, 6).map((m) => (
            <Pressable key={m.id} accessibilityRole="button" className="min-h-12 justify-center rounded-xl px-2" onPress={async () => {
              const s = sel; close();
              await mergeMerchant(db, s.id, m.id);
              track('feature_used', { feature: 'merchant_merged' });
              notifyIngested(); load();
              snack({ message: `Merged ${s.name} into ${m.name}` });
            }}>
              <Text className="text-base text-fg">{m.name} <Text className="text-xs text-muted">· {m.n}</Text></Text>
            </Pressable>
          ))}
        </Sheet>
      )}
    </View>
  );
}
