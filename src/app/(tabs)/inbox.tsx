import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';

import { SwipeRow } from '@/components/SwipeRow';
import { type Category, type Txn, getCategories, getTxns, updateTxn } from '@/db/queries';
import { onIngested } from '@/ingest/events';
import { rupees } from '@/utils/format';

type Patch = Parameters<typeof updateTxn>[2];

function CategoryList({ cats, value, onPick }: { cats: Category[]; value: number | null; onPick: (id: number) => void }) {
  return (
    <View className="flex-row flex-wrap">
      {cats.map((c) => (
        <Pressable key={c.id} onPress={() => onPick(c.id)} className="mb-2 mr-2 rounded-full px-3 py-1" style={{ backgroundColor: value === c.id ? c.color : '#1F2937' }}>
          <Text className="text-xs text-white">{c.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** One shared sheet for category picking (instead of chips inside every row). */
function CategorySheet({ cats, onPick, onClose }: { cats: Category[]; onPick: (id: number) => void; onClose: () => void }) {
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/60" onPress={onClose}>
        <View className="rounded-t-3xl bg-card p-5">
          <Text className="mb-3 text-lg font-semibold text-white">Category</Text>
          <CategoryList cats={cats} value={null} onPick={onPick} />
        </View>
      </Pressable>
    </Modal>
  );
}

function EditModal({ txn, cats, onClose, onSave }: { txn: Txn; cats: Category[]; onClose: () => void; onSave: (f: Patch) => void }) {
  const [amount, setAmount] = useState(String(txn.amount_paise / 100));
  const [merchant, setMerchant] = useState(txn.merchant ?? '');
  const [tags, setTags] = useState(txn.tags);
  const [cat, setCat] = useState(txn.category_id);
  const paise = Math.round(parseFloat(amount) * 100);
  const input = 'mb-3 rounded-xl bg-base px-3 py-2 text-white';
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <View className="rounded-t-3xl bg-card p-5">
          <Text className="mb-3 text-lg font-semibold text-white">Edit transaction</Text>
          <Text className="mb-1 text-xs text-gray-400">Amount (₹)</Text>
          <TextInput className={input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Text className="mb-1 text-xs text-gray-400">Merchant</Text>
          <TextInput className={input} value={merchant} onChangeText={setMerchant} placeholderTextColor="#6B7280" />
          <Text className="mb-1 text-xs text-gray-400">Tags (comma separated)</Text>
          <TextInput className={input} value={tags} onChangeText={setTags} autoCapitalize="none" placeholderTextColor="#6B7280" />
          <CategoryList cats={cats} value={cat} onPick={setCat} />
          <View className="mt-2 flex-row justify-end">
            <Pressable onPress={onClose} className="mr-4 px-4 py-2"><Text className="text-gray-400">Cancel</Text></Pressable>
            <Pressable
              disabled={!(paise > 0)}
              onPress={() => onSave({ amount_paise: paise, merchant: merchant.trim() || null, tags: tags.split(',').map((t) => t.trim()).filter(Boolean).join(','), category_id: cat })}
              className="rounded-xl bg-accent px-5 py-2">
              <Text className="font-semibold text-base">Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

type RowProps = {
  t: Txn;
  cat: Category | undefined;
  onConfirm: (t: Txn) => void;
  onDismiss: (t: Txn) => void;
  onEdit: (t: Txn) => void;
  onPickCategory: (t: Txn) => void;
};

const Row = memo(function Row({ t, cat, onConfirm, onDismiss, onEdit, onPickCategory }: RowProps) {
  return (
    <SwipeRow onRight={() => onConfirm(t)} onLeft={() => onDismiss(t)}>
      <Pressable onPress={() => onEdit(t)} className="rounded-2xl bg-card p-4">
        <View className="flex-row items-center justify-between">
          <Text className={t.direction === 'debit' ? 'text-lg text-red-400' : 'text-lg text-accent'}>
            {t.direction === 'debit' ? '-' : '+'}{rupees(t.amount_paise)}
          </Text>
          <Pressable onPress={() => onPickCategory(t)} hitSlop={8}>
            <Text className="rounded-full px-2 py-0.5 text-xs text-white" style={{ backgroundColor: cat?.color ?? '#374151' }}>
              {cat?.name ?? 'Set category'}
            </Text>
          </Pressable>
        </View>
        <Text className="text-white">{t.merchant ?? 'Unknown'}</Text>
        <Text className="text-xs text-gray-400">
          {t.bank ?? '?'} · a/c {t.account_last4 ?? '?'} · {t.source} · {new Date(t.ts).toLocaleString()}
        </Text>
        {t.tags ? <Text className="mt-1 text-xs text-accent">#{t.tags.split(',').join(' #')}</Text> : null}
      </Pressable>
    </SwipeRow>
  );
});

export default function Inbox() {
  const db = useSQLiteContext();
  const [txns, setTxns] = useState<Txn[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Txn | null>(null);
  const [picking, setPicking] = useState<Txn | null>(null);
  const catById = useRef(new Map<number, Category>());

  // Ingest runs app-wide (see ingest/Ingest.tsx); here we only read.
  const load = useCallback(async () => {
    const c = await getCategories(db);
    catById.current = new Map(c.map((x) => [x.id, x]));
    setCats(c);
    setTxns(await getTxns(db, 'pending'));
  }, [db]);
  useFocusEffect(useCallback(() => void load(), [load]));
  useEffect(() => onIngested(() => void load()), [load]);

  // optimistic: drop/patch the row in state first, write to SQLite after
  const apply = useCallback((t: Txn, patch: Patch, remove: boolean) => {
    setTxns((cur) => (remove ? cur.filter((x) => x.id !== t.id) : cur.map((x) => (x.id === t.id ? { ...x, ...patch } : x))));
    void updateTxn(db, t.id, patch).catch(load);
  }, [db, load]);

  const confirm = useCallback((t: Txn) => apply(t, { status: 'confirmed' }, true), [apply]);
  const dismiss = useCallback((t: Txn) => apply(t, { status: 'dismissed' }, true), [apply]);
  const edit = useCallback((t: Txn) => setEditing(t), []);
  const pickCat = useCallback((t: Txn) => setPicking(t), []);

  const confirmCategorised = async () => {
    await db.runAsync("UPDATE transactions SET status = 'confirmed', synced_at = NULL WHERE status = 'pending' AND category_id IS NOT NULL");
    load();
  };

  return (
    <View className="flex-1 bg-base px-4 pt-16">
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-2xl font-semibold text-white">Inbox{txns.length ? ` · ${txns.length}` : ''}</Text>
        {txns.length > 1 && (
          <Pressable onPress={confirmCategorised}><Text className="text-accent">Confirm categorised</Text></Pressable>
        )}
      </View>
      <Text className="mb-4 text-xs text-gray-400">Swipe right to confirm, left to dismiss, tap to edit.</Text>
      <FlatList
        data={txns}
        keyExtractor={(t) => String(t.id)}
        renderItem={({ item }) => (
          <Row t={item} cat={item.category_id ? catById.current.get(item.category_id) : undefined} onConfirm={confirm} onDismiss={dismiss} onEdit={edit} onPickCategory={pickCat} />
        )}
        ListEmptyComponent={<Text className="text-gray-400">All caught up.</Text>}
        initialNumToRender={8}
        windowSize={7}
        maxToRenderPerBatch={8}
        removeClippedSubviews
        contentContainerStyle={{ paddingBottom: 32 }}
      />
      {picking && (
        <CategorySheet cats={cats} onClose={() => setPicking(null)} onPick={(id) => { apply(picking, { category_id: id }, false); setPicking(null); }} />
      )}
      {editing && (
        <EditModal txn={editing} cats={cats} onClose={() => setEditing(null)} onSave={(f) => { apply(editing, f, false); setEditing(null); }} />
      )}
    </View>
  );
}
