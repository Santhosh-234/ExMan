import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import type { Category, Txn } from '@/db/queries';
import { Button, Chip, Sheet } from '@/ui/kit';
import { useTheme } from '@/ui/theme';

export type TxnPatch = Partial<Pick<Txn, 'amount_paise' | 'merchant' | 'category_id' | 'tags'>>;

export function CategoryChips({ cats, value, onPick }: { cats: Category[]; value: number | null; onPick: (id: number) => void }) {
  return (
    <View className="flex-row flex-wrap">
      {cats.map((c) => (
        <Chip key={c.id} label={c.name} color={c.color} selected={value === c.id} onPress={() => onPick(c.id)} />
      ))}
    </View>
  );
}

export function CategorySheet({ cats, value, onPick, onClose }: { cats: Category[]; value: number | null; onPick: (id: number) => void; onClose: () => void }) {
  return (
    <Sheet title="Category" onClose={onClose}>
      <CategoryChips cats={cats} value={value} onPick={onPick} />
    </Sheet>
  );
}

export function EditSheet({ txn, cats, onClose, onSave }: { txn: Txn; cats: Category[]; onClose: () => void; onSave: (f: TxnPatch) => void }) {
  const { colors } = useTheme();
  const [amount, setAmount] = useState(String(txn.amount_paise / 100));
  const [merchant, setMerchant] = useState(txn.merchant ?? '');
  const [tags, setTags] = useState(txn.tags);
  const [cat, setCat] = useState(txn.category_id);
  const paise = Math.round(parseFloat(amount) * 100);
  const input = 'mb-3 min-h-12 rounded-2xl bg-card2 px-4 py-3 text-base text-fg';
  return (
    <Sheet title="Edit transaction" onClose={onClose}>
      <Text className="mb-1 text-xs text-muted">Amount (₹)</Text>
      <TextInput className={input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholderTextColor={colors.muted} />
      <Text className="mb-1 text-xs text-muted">Merchant</Text>
      <TextInput className={input} value={merchant} onChangeText={setMerchant} placeholderTextColor={colors.muted} />
      <Text className="mb-1 text-xs text-muted">Tags (comma separated)</Text>
      <TextInput className={input} value={tags} onChangeText={setTags} autoCapitalize="none" placeholderTextColor={colors.muted} />
      <CategoryChips cats={cats} value={cat} onPick={setCat} />
      <View className="mt-2 flex-row justify-end">
        <Button variant="ghost" label="Cancel" onPress={onClose} />
        <Button
          label="Save"
          disabled={!(paise > 0)}
          onPress={() => onSave({ amount_paise: paise, merchant: merchant.trim() || null, tags: tags.split(',').map((t) => t.trim()).filter(Boolean).join(','), category_id: cat })}
        />
      </View>
    </Sheet>
  );
}
