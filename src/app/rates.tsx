import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ChevronLeft } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/ui/Text';

import { setSetting } from '@/db/queries';
import { loadRates } from '@/ingest/run';
import { Button } from '@/ui/kit';
import { useSnackbar } from '@/ui/Snackbar';
import { useTheme } from '@/ui/theme';
import { CURRENCIES } from '@/utils/currency';

/** Rupees per 1 unit of each currency, used for card spends made abroad. */
export default function Rates() {
  const db = useSQLiteContext();
  const router = useRouter();
  const snack = useSnackbar();
  const { colors } = useTheme();
  const [vals, setVals] = useState<Record<string, string>>({});

  useEffect(() => void loadRates(db).then((m) => setVals(Object.fromEntries([...m].map(([k, v]) => [k, String(v)])))), [db]);

  return (
    <View className="flex-1 bg-base px-4 pt-14">
      <Pressable onPress={() => router.back()} hitSlop={12} className="mb-2 flex-row items-center" accessibilityRole="button" accessibilityLabel="Back">
        <ChevronLeft color={colors.fg} /><Text className="text-fg">Back</Text>
      </Pressable>
      <Text className="text-3xl font-bold text-fg" accessibilityRole="header">Exchange rates</Text>
      <Text className="mb-3 text-xs text-muted">Card spends in other currencies are saved in rupees at these rates and marked with ≈. They are rough defaults: set the rate your bank actually used, or edit a transaction's amount to match your statement.</Text>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {CURRENCIES.map((c) => (
          <View key={c.code} className="mb-2 flex-row items-center rounded-2xl bg-card p-3">
            <Text className="w-16 text-base font-semibold text-fg">{c.code}</Text>
            <Text className="mr-2 text-muted">₹ per 1</Text>
            <TextInput
              className="min-h-11 flex-1 rounded-xl bg-card2 px-3 text-base text-fg"
              value={vals[c.code] ?? ''} onChangeText={(v) => setVals((s) => ({ ...s, [c.code]: v }))}
              keyboardType="decimal-pad" accessibilityLabel={`Rupees per 1 ${c.code}`} placeholderTextColor={colors.muted}
            />
          </View>
        ))}
        <Button className="mb-10 mt-2" label="Save rates" onPress={async () => {
          for (const c of CURRENCIES) {
            const v = parseFloat(vals[c.code] ?? '');
            if (v > 0) await setSetting(db, `fx_${c.code}`, String(v));
          }
          snack({ message: 'Rates saved. They apply to new transactions.' });
          router.back();
        }} />
      </ScrollView>
    </View>
  );
}
