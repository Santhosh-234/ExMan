import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { SwipeRow } from '@/components/SwipeRow';
import { type Category, type Txn, deleteTxn, getCategories, getTxns, updateTxn } from '@/db/queries';
import { ingest } from '@/ingest/run';
import { rupees } from '@/utils/format';

type Miss = { id: number; sender: string; text: string; ts: number };

function CategoryChips({ cats, value, onPick }: { cats: Category[]; value: number | null; onPick: (id: number) => void }) {
  return (
    <View className="flex-row flex-wrap">
      {cats.map((c) => (
        <Pressable
          key={c.id}
          onPress={() => onPick(c.id)}
          className="mb-2 mr-2 rounded-full px-3 py-1"
          style={{ backgroundColor: value === c.id ? c.color : '#1F2937' }}>
          <Text className="text-xs text-white">{c.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function EditModal({ txn, cats, onClose, onSave }: { txn: Txn; cats: Category[]; onClose: () => void; onSave: (f: Parameters<typeof updateTxn>[2]) => void }) {
  const [amount, setAmount] = useState(String(txn.amount_paise / 100));
  const [merchant, setMerchant] = useState(txn.merchant ?? '');
  const [tags, setTags] = useState(txn.tags);
  const [cat, setCat] = useState(txn.category_id);
  const paise = Math.round(parseFloat(amount) * 100);
  const valid = paise > 0;
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
          <CategoryChips cats={cats} value={cat} onPick={setCat} />
          <View className="mt-2 flex-row justify-end">
            <Pressable onPress={onClose} className="mr-4 px-4 py-2"><Text className="text-gray-400">Cancel</Text></Pressable>
            <Pressable
              disabled={!valid}
              onPress={() =>
                onSave({
                  amount_paise: paise,
                  merchant: merchant.trim() || null,
                  tags: tags.split(',').map((t) => t.trim()).filter(Boolean).join(','),
                  category_id: cat,
                })
              }
              className="rounded-xl bg-accent px-5 py-2">
              <Text className="font-semibold text-base">Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function Inbox() {
  const db = useSQLiteContext();
  const [txns, setTxns] = useState<Txn[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [misses, setMisses] = useState<Miss[]>([]);
  const [editing, setEditing] = useState<Txn | null>(null);

  const load = useCallback(async () => {
    await ingest(db);
    setCats(await getCategories(db));
    setTxns(await getTxns(db, 'pending'));
    setMisses(await db.getAllAsync<Miss>('SELECT * FROM unparsed ORDER BY ts DESC LIMIT 20'));
  }, [db]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const catOf = (id: number | null) => cats.find((c) => c.id === id);
  const confirm = async (t: Txn) => { await updateTxn(db, t.id, { status: 'confirmed' }); load(); };
  const dismiss = async (t: Txn) => { await deleteTxn(db, t.id); load(); };
  const pick = async (t: Txn, id: number) => { await updateTxn(db, t.id, { category_id: id }); load(); };

  return (
    <ScrollView className="flex-1 bg-base px-4 pt-16">
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-2xl font-semibold text-white">Inbox</Text>
        <Pressable onPress={load}><Text className="text-accent">Refresh</Text></Pressable>
      </View>
      <Text className="mb-4 text-xs text-gray-400">Swipe right to confirm, left to dismiss, tap to edit.</Text>
      {txns.length === 0 && <Text className="mb-4 text-gray-400">All caught up.</Text>}
      {txns.map((t) => {
        const c = catOf(t.category_id);
        return (
          <SwipeRow key={t.id} onRight={() => confirm(t)} onLeft={() => dismiss(t)}>
            <Pressable onPress={() => setEditing(t)} className="rounded-2xl bg-card p-4">
              <View className="flex-row items-center justify-between">
                <Text className={t.direction === 'debit' ? 'text-lg text-red-400' : 'text-lg text-accent'}>
                  {t.direction === 'debit' ? '-' : '+'}{rupees(t.amount_paise)}
                </Text>
                {c && <Text className="rounded-full px-2 py-0.5 text-xs text-white" style={{ backgroundColor: c.color }}>{c.name}</Text>}
              </View>
              <Text className="text-white">{t.merchant ?? 'Unknown'}</Text>
              <Text className="text-xs text-gray-400">
                {t.bank ?? '?'} · a/c {t.account_last4 ?? '?'} · {t.source} · {new Date(t.ts).toLocaleString()}
              </Text>
              {t.tags ? <Text className="mt-1 text-xs text-accent">#{t.tags.split(',').join(' #')}</Text> : null}
              {!c && (
                <View className="mt-3">
                  <CategoryChips cats={cats} value={null} onPick={(id) => pick(t, id)} />
                </View>
              )}
            </Pressable>
          </SwipeRow>
        );
      })}
      {misses.length > 0 && <Text className="mb-2 mt-4 text-amber-400">Not recognised ({misses.length})</Text>}
      {misses.map((m) => (
        <View key={m.id} className="mb-2 rounded-2xl bg-card p-4">
          <Text className="text-xs text-gray-400">{m.sender} · {new Date(m.ts).toLocaleString()}</Text>
          <Text className="text-white">{m.text}</Text>
          <Pressable onPress={async () => { await db.runAsync('DELETE FROM unparsed WHERE id = ?', m.id); load(); }}>
            <Text className="mt-2 text-xs text-red-400">Remove</Text>
          </Pressable>
        </View>
      ))}
      <View className="h-8" />
      {editing && (
        <EditModal
          txn={editing}
          cats={cats}
          onClose={() => setEditing(null)}
          onSave={async (f) => { await updateTxn(db, editing.id, f); setEditing(null); load(); }}
        />
      )}
    </ScrollView>
  );
}
