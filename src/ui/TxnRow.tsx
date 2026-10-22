import { ArrowDownLeft, ArrowUpRight, Check, Repeat } from 'lucide-react-native';
import { memo } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/ui/Text';

import type { Category, Txn } from '@/db/queries';
import { Amount } from '@/ui/kit';
import { useTheme } from '@/ui/theme';
import { formatForeign } from '@/utils/currency';

type Props = {
  t: Txn;
  cat?: Category;
  selecting?: boolean;
  selected?: boolean;
  onPress: (t: Txn) => void;
  onLongPress?: (t: Txn) => void;
};

/**
 * One ledger line. The leading icon says what kind of money movement it is at a glance:
 * green down-arrow = money in, arrow up = spent, two arrows = transfer (not counted).
 * Memoised so a 10,000-row list only re-renders rows whose props changed.
 */
export const TxnRow = memo(function TxnRow({ t, cat, selecting, selected, onPress, onLongPress }: Props) {
  const { colors } = useTheme();
  const income = t.direction === 'credit' && !t.is_transfer;
  const where = t.bank && t.account_last4 ? `${t.bank} …${t.account_last4}` : t.bank ?? (t.source === 'manual' ? 'Manual' : '');
  const what = t.is_transfer ? 'Transfer' : income ? (t.refund_of ? 'Refund' : 'Money in') : cat?.name ?? 'Uncategorised';
  const sub = [what, where, t.currency && t.foreign_minor ? formatForeign(t.foreign_minor, t.currency) : ''].filter(Boolean).join(' · ');

  const circle = selected
    ? { bg: colors.accent, icon: <Check size={20} color={colors.onaccent} /> }
    : t.is_transfer
      ? { bg: colors.surface2, icon: <Repeat size={18} color={colors.muted} /> }
      : income
        ? { bg: `${colors.accent}2E`, icon: <ArrowDownLeft size={20} color={colors.accent} /> }
        : { bg: cat?.color ?? colors.surface2, icon: <ArrowUpRight size={20} color={cat ? '#FFFFFF' : colors.muted} /> };

  return (
    <Pressable
      onPress={() => onPress(t)}
      onLongPress={onLongPress && (() => onLongPress(t))}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={`${what}, ${t.merchant ?? 'Unknown'}`}
      className={`mb-2 min-h-16 flex-row items-center rounded-2xl p-3 ${selected ? 'bg-card2' : 'bg-card'}`}>
      <View className="mr-3 h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: circle.bg }}>{circle.icon}</View>
      <View className="flex-1">
        <Text className="text-base text-fg" numberOfLines={1}>{t.merchant ?? 'Unknown'}</Text>
        <Text className="text-xs text-muted" numberOfLines={1}>{sub}</Text>
      </View>
      <View className="items-end">
        <Amount paise={t.amount_paise} direction={t.direction} muted={!!t.is_transfer} approx={!!t.currency} className="text-base" />
        {selecting ? null : <Text className="text-xs text-muted">{new Date(t.ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</Text>}
      </View>
    </Pressable>
  );
});
