import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { monthLabel, shiftMonth } from '@/utils/format';

export function MonthBar({ month, onChange, max }: { month: string; onChange: (m: string) => void; max: string }) {
  return (
    <View className="mb-4 flex-row items-center justify-between">
      <Pressable onPress={() => onChange(shiftMonth(month, -1))} hitSlop={12}><ChevronLeft color="#9CA3AF" /></Pressable>
      <Text className="text-lg font-semibold text-white">{monthLabel(month)}</Text>
      <Pressable disabled={month >= max} onPress={() => onChange(shiftMonth(month, 1))} hitSlop={12}>
        <ChevronRight color={month >= max ? '#1F2937' : '#9CA3AF'} />
      </Pressable>
    </View>
  );
}
