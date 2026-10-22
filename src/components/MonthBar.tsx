import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { Text } from '@/ui/Text';

import { useTheme } from '@/ui/theme';
import { monthLabel, shiftMonth } from '@/utils/format';

export function MonthBar({ month, onChange, max }: { month: string; onChange: (m: string) => void; max: string }) {
  const { colors } = useTheme();
  return (
    <View className="mb-4 flex-row items-center justify-between">
      <Pressable onPress={() => onChange(shiftMonth(month, -1))} hitSlop={12} accessibilityRole="button" accessibilityLabel="Previous month"><ChevronLeft color={colors.muted} /></Pressable>
      <Text className="text-lg font-semibold text-fg">{monthLabel(month)}</Text>
      <Pressable disabled={month >= max} onPress={() => onChange(shiftMonth(month, 1))} hitSlop={12} accessibilityRole="button" accessibilityLabel="Next month">
        <ChevronRight color={month >= max ? colors.line : colors.muted} />
      </Pressable>
    </View>
  );
}
