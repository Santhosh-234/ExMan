import { useSecurity } from '@/security/store';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ListOrdered, Search, SlidersHorizontal, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Text, TextInput } from '@/ui/Text';

import { type Account, type Category, type Txn, PAGE, bulkUpdate, getAccounts, getCategories, queryTxns, summarize } from '@/db/queries';
import { onIngested } from '@/ingest/events';
import { Button, EmptyState, Fab, useElevation } from '@/ui/kit';
import { FilterSheet } from '@/ui/FilterSheet';
import { CategorySheet } from '@/ui/sheets';
import { useSnackbar } from '@/ui/Snackbar';
import { useRuleOffer } from '@/ui/useRuleOffer';
import { useTheme } from '@/ui/theme';
import { TxnRow } from '@/ui/TxnRow';
import { type TxnFilter, EMPTY_FILTER, activeFilterCount } from '@/utils/filters';
import { rupees } from '@/utils/format';

type Item = { kind: 'day'; key: string; label: string; spent: number } | { kind: 'txn'; key: string; t: Txn };

const dayLabel = (ts: number) => {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(today.getTime() - 864e5);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
};

export default function Activity() {
  useSecurity(); // re-render when "hide amounts" changes
  const db = useSQLiteContext();
  const router = useRouter();
  const snack = useSnackbar();
  const offerRule = useRuleOffer();
  const { account, q: qParam, transfers } = useLocalSearchParams<{ account?: string; q?: string; transfers?: string }>();
  const { colors } = useTheme();
  const [filter, setFilter] = useState<TxnFilter>(EMPTY_FILTER);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Txn[]>([]);
  const [sum, setSum] = useState({ n: 0, spent: 0, received: 0 });
  const [cats, setCats] = useState<Category[]>([]);
  const [accts, setAccts] = useState<Account[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pickCat, setPickCat] = useState(false);
  const exhausted = useRef(false);
  const loading = useRef(false);
  const seq = useRef(0); // drops results from superseded queries

  // arriving from an account screen: filter to that account (cleared via the filter sheet)
  useEffect(() => {
    if (account) setFilter((f) => ({ ...f, accountIds: [Number(account)] }));
  }, [account]);

  useEffect(() => {
    if (transfers === 'only') setFilter((f) => ({ ...f, transfers: 'only' }));
  }, [transfers]);
  useEffect(() => {
    if (qParam) setSearch(qParam);
  }, [qParam]);

  // debounce typing into the actual filter
  useEffect(() => {
    const h = setTimeout(() => setFilter((f) => (f.q === (search || undefined) ? f : { ...f, q: search || undefined })), 200);
    return () => clearTimeout(h);
  }, [search]);

  const load = useCallback(async () => {
    const my = ++seq.current;
    exhausted.current = false;
    const [page, s] = await Promise.all([queryTxns(db, filter, 0), summarize(db, filter)]);
    if (my !== seq.current) return;
    exhausted.current = page.length < PAGE;
    setRows(page); setSum(s);
  }, [db, filter]);

  const loadMore = useCallback(async () => {
    if (loading.current || exhausted.current) return;
    loading.current = true;
    const my = seq.current;
    const page = await queryTxns(db, filter, rows.length);
    loading.current = false;
    if (my !== seq.current) return;
    exhausted.current = page.length < PAGE;
    setRows((r) => [...r, ...page]);
  }, [db, filter, rows.length]);

  useEffect(() => void load(), [load]);
  useFocusEffect(useCallback(() => { void load(); void getCategories(db).then(setCats); void getAccounts(db).then(setAccts); }, [db, load]));
  useEffect(() => onIngested(() => void load()), [load]);

  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    let last = '';
    let head: Extract<Item, { kind: 'day' }> | null = null;
    for (const t of rows) {
      const label = dayLabel(t.ts);
      if (label !== last) { head = { kind: 'day', key: `d${label}`, label, spent: 0 }; out.push(head); last = label; }
      if (head && t.direction === 'debit' && !t.is_transfer) head.spent += t.amount_paise; // day total: what was spent (transfers excluded)
      out.push({ kind: 'txn', key: `t${t.id}`, t });
    }
    return out;
  }, [rows]);

  const selecting = selected.size > 0;
  const toggleSel = useCallback((t: Txn) => setSelected((s) => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; }), []);
  const open = useCallback((t: Txn) => router.push(`/txn/${t.id}`), [router]);
  const onPress = useCallback((t: Txn) => (selecting ? toggleSel(t) : open(t)), [selecting, toggleSel, open]);
  const onLong = useCallback((t: Txn) => toggleSel(t), [toggleSel]);

  const bulk = async (patch: Parameters<typeof bulkUpdate>[2], message: string) => {
    const ids = [...selected];
    const undo = await bulkUpdate(db, ids, patch);
    setSelected(new Set());
    await load();
    // all selected rows from one merchant and a category was chosen: offer to remember it
    const picked = rows.filter((r) => ids.includes(r.id));
    const m = picked[0]?.merchant_id;
    if (patch.category_id && m && picked.every((r) => r.merchant_id === m)) {
      const shown = await offerRule({ merchantId: m, merchantName: picked[0].merchant, categoryId: patch.category_id, categoryName: catById.get(patch.category_id)?.name ?? 'this category', prefix: message, undo: () => void undo().then(load) });
      if (shown) return;
    }
    snack({ message, actionLabel: 'Undo', onAction: () => void undo().then(load) });
  };

  const lift = useElevation(1);
  const nFilters = activeFilterCount(filter);
  const summaryText = `${sum.n} transaction${sum.n === 1 ? '' : 's'}${sum.spent ? ` · ${rupees(sum.spent)} spent` : ''}${sum.received ? ` · ${rupees(sum.received)} received` : ''}`;

  return (
    <View className="flex-1 bg-base px-4 pt-14">
      {selecting ? (
        <View className="mb-3 flex-row items-center justify-between">
          <View className="flex-row items-center">
            <Pressable onPress={() => setSelected(new Set())} hitSlop={12} accessibilityRole="button" accessibilityLabel="Cancel selection"><X color={colors.fg} /></Pressable>
            <Text className="ml-3 text-xl font-semibold text-fg">{selected.size} selected</Text>
          </View>
        </View>
      ) : (
        <Text className="mb-4 text-3xl font-bold text-fg" accessibilityRole="header">Activity</Text>
      )}

      {selecting ? (
        <View className="mb-3 flex-row">
          <Button className="mr-2 flex-1" variant="secondary" label="Category" onPress={() => setPickCat(true)} />
          <Button className="mr-2 flex-1" variant="secondary" label="Transfer" onPress={() => bulk({ is_transfer: 1 }, `Marked ${selected.size} as transfers`)} />
          <Button className="flex-1" variant="danger" label="Delete" onPress={() => bulk({ status: 'dismissed' }, `Deleted ${selected.size}`)} />
        </View>
      ) : (
        <View className="mb-2 flex-row items-center">
          <View className="mr-2 min-h-12 flex-1 flex-row items-center rounded-2xl border border-line bg-card px-3" style={lift}>
            <Search size={18} color={colors.muted} />
            <TextInput
              className="ml-2 flex-1 text-base text-fg" value={search} onChangeText={setSearch}
              placeholder="Search merchant, tag, amount" placeholderTextColor={colors.muted} returnKeyType="search" accessibilityLabel="Search transactions"
            />
            {search ? <Pressable onPress={() => setSearch('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search"><X size={18} color={colors.muted} /></Pressable> : null}
          </View>
          <Pressable onPress={() => setShowFilters(true)} accessibilityRole="button" accessibilityLabel={`Filters${nFilters ? `, ${nFilters} active` : ''}`} className="h-12 w-12 items-center justify-center rounded-2xl border border-line bg-card" style={lift}>
            <SlidersHorizontal size={20} color={nFilters ? colors.accent : colors.muted} />
            {nFilters > 0 && <View className="absolute right-1 top-1 h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1"><Text className="text-[10px] font-bold text-onaccent">{nFilters}</Text></View>}
          </Pressable>
        </View>
      )}

      {!selecting && <Text className="mb-1 text-xs text-muted">{summaryText}</Text>}

      <FlatList
        data={items}
        keyExtractor={(i) => i.key}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <EmptyState
            icon={<ListOrdered size={44} color={colors.muted} />}
            title={nFilters || search ? 'No matches' : 'No confirmed transactions yet'}
            body={nFilters || search ? 'Try a different search or reset the filters.' : 'Review new transactions on Home, or add one with the + button.'}
            action={nFilters || search ? <Button variant="secondary" label="Clear filters" onPress={() => { setSearch(''); setFilter(EMPTY_FILTER); }} /> : undefined}
          />
        }
        initialNumToRender={14}
        windowSize={9}
        removeClippedSubviews
        contentContainerStyle={{ paddingBottom: 96 }}
        renderItem={({ item }) =>
          item.kind === 'day' ? (
            <View className="mb-2 mt-4 flex-row items-center justify-between px-1">
              <Text className="text-xs font-semibold uppercase tracking-widest text-muted" accessibilityRole="header">{item.label}</Text>
              {item.spent > 0 ? <Text className="text-xs text-muted" style={{ fontVariant: ['tabular-nums'] }}>{rupees(item.spent)} spent</Text> : null}
            </View>
          ) : (
            <TxnRow t={item.t} cat={catById.get(item.t.category_id ?? -1)} selecting={selecting} selected={selected.has(item.t.id)} onPress={onPress} onLongPress={onLong} />
          )
        }
      />

      {!selecting && <Fab onPress={() => router.push('/add')} />}
      {showFilters && <FilterSheet value={filter} cats={cats} accounts={accts} onClose={() => setShowFilters(false)} onApply={(f) => { setFilter(f); setShowFilters(false); }} />}
      {pickCat && <CategorySheet cats={cats} value={null} onClose={() => setPickCat(false)} onPick={(id) => { setPickCat(false); void bulk({ category_id: id }, `Categorised ${selected.size} as ${catById.get(id)?.name}`); }} />}
    </View>
  );
}
