import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/ui/Text';

import { setSetting } from '@/db/queries';
import { loadRates } from '@/ingest/run';
import { BackButton, Button, PageHeader } from '@/ui/kit';
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
      <BackButton />
      <PageHeader title="Exchange rates" subtitle="Card spends in other currencies are saved in rupees at these rates and marked with ≈. They are rough defaults: set the rate your bank actually used, or edit a transaction's amount to match your statement." />
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {CURRENCIES.map((c) => {
          const bad = (vals[c.code] ?? '') !== '' && !(parseFloat(vals[c.code]) > 0);
          return (
            <View key={c.code} className="mb-2 flex-row items-center rounded-[22px] border border-line bg-card p-3">
              <View className="mr-3 h-10 min-w-[56px] items-center justify-center rounded-full bg-card2 px-3"><Text className="text-sm font-bold text-fg">{c.code}</Text></View>
              <Text className="mr-2 text-sm text-muted">₹ per 1</Text>
              <TextInput
                className="min-h-11 flex-1 rounded-xl bg-card2 px-3 text-base text-fg"
                style={bad ? { borderWidth: 1, borderColor: colors.danger } : undefined}
                value={vals[c.code] ?? ''} onChangeText={(v) => setVals((s) => ({ ...s, [c.code]: v }))}
                keyboardType="decimal-pad" accessibilityLabel={`Rupees per 1 ${c.code}`} accessibilityHint={bad ? 'Enter a number above zero' : undefined} placeholderTextColor={colors.muted}
              />
            </View>
          );
        })}
        <View className="h-4" />
      </ScrollView>
      <View className="border-t border-line bg-base pb-4 pt-3">
        <Button label="Save rates" disabled={CURRENCIES.some((c) => (vals[c.code] ?? '') !== '' && !(parseFloat(vals[c.code]) > 0))} onPress={async () => {
          for (const c of CURRENCIES) {
            const v = parseFloat(vals[c.code] ?? '');
            if (v > 0) await setSetting(db, `fx_${c.code}`, String(v));
          }
          snack({ message: 'Rates saved. They apply to new transactions.' });
          router.back();
        }} />
      </View>
    </View>
  );
}
