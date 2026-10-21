import { Check, Repeat } from 'lucide-react-native';
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Category, Txn } from '@/db/queries';
import { Amount } from '@/ui/kit';
import { useTheme } from '@/ui/theme';

type Props = {
  t: Txn;
  cat?: Category;
  selecting?: boolean;
  selected?: boolean;
  onPress: (t: Txn) => void;
  onLongPress?: (t: Txn) => void;
};

/** One ledger line. Memoised so a 10,000-row list only re-renders rows whose props changed. */
export const TxnRow = memo(function TxnRow({ t, cat, selecting, selected, onPress, onLongPress }: Props) {
  const { colors } = useTheme();
  const sub = [cat?.name ?? 'Uncategorised', t.bank && t.account_last4 ? `${t.bank} …${t.account_last4}` : t.bank ?? (t.source === 'manual' ? 'Manual' : '')].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={() => onPress(t)}
      onLongPress={onLongPress && (() => onLongPress(t))}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      className={`mb-2 min-h-16 flex-row items-center rounded-2xl p-3 ${selected ? 'bg-card2' : 'bg-card'}`}>
      <View className="mr-3 h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: selected ? colors.accent : cat?.color ?? colors.surface2 }}>
        {selected ? <Check size={20} color={colors.onaccent} /> : t.is_transfer ? <Repeat size={18} color="#FFFFFF" /> : null}
      </View>
      <View className="flex-1">
        <Text className="text-base text-fg" numberOfLines={1}>{t.merchant ?? 'Unknown'}</Text>
        <Text className="text-xs text-muted" numberOfLines={1}>{t.is_transfer ? `Transfer · ${sub}` : sub}</Text>
      </View>
      <View className="items-end">
        <Amount paise={t.amount_paise} direction={t.direction} className="text-base" />
        {selecting ? null : <Text className="text-xs text-muted">{new Date(t.ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</Text>}
      </View>
    </Pressable>
  );
});
