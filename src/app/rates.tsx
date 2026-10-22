import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { useEffect, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { Text, TextInput } from '@/ui/Text';

import { getSetting, setSetting } from '@/db/queries';
import { loadRateInfo, refreshForeignRates } from '@/ingest/run';
import { BackButton, Button, Card, PageHeader } from '@/ui/kit';
import { useSnackbar } from '@/ui/Snackbar';
import { useTheme } from '@/ui/theme';
import { CURRENCIES } from '@/utils/currency';
import { ONLINE_CODES } from '@/utils/fx';

/**
 * Rupees per 1 unit of each currency for card spends made abroad. A field left empty means "automatic": that day's published rate when it
 * can be fetched (otherwise the approximate default shown greyed out). A number you type is yours and is always used for that currency.
 */
export default function Rates() {
  const db = useSQLiteContext();
  const router = useRouter();
  const snack = useSnackbar();
  const { colors } = useTheme();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadRateInfo(db).then(({ rates, user }) => {
      const v = Object.fromEntries(CURRENCIES.map((c) => [c.code, user.has(c.code) ? String(rates.get(c.code)) : '']));
      setVals(v); setInitial(v);
    });
    void getSetting(db, 'fx_online').then((x) => setOnline(x !== '0'));
  }, [db]);

  const invalid = CURRENCIES.some((c) => (vals[c.code] ?? '') !== '' && !(parseFloat(vals[c.code]) > 0));
  const save = async () => {
    for (const c of CURRENCIES) {
      const v = (vals[c.code] ?? '').trim();
      if (v === (initial[c.code] ?? '')) continue; // untouched currencies stay automatic
      if (v === '') await db.runAsync('DELETE FROM settings WHERE key = ?', `fx_${c.code}`);
      else await setSetting(db, `fx_${c.code}`, String(parseFloat(v)));
    }
    snack({ message: 'Rates saved. Your own rates apply to new transactions.' });
    router.back();
  };

  return (
    <View className="flex-1 bg-base px-4 pt-14">
      <BackButton />
      <PageHeader title="Exchange rates" subtitle="Card spends in other currencies are saved in rupees and marked ≈ because your bank's own rate differs a little." />
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Card className="mb-4">
          <View className="flex-row items-center">
            <View className="mr-3 flex-1">
              <Text className="text-base font-semibold text-fg">Use each day's published rate</Text>
              <Text className="mt-0.5 text-xs text-muted">Looks up the ECB reference rate for the day of the spend. Only the currency and the date are sent, never amounts or merchants.</Text>
            </View>
            <Switch value={online} onValueChange={async (v) => { setOnline(v); await setSetting(db, 'fx_online', v ? '1' : '0'); }} trackColor={{ true: colors.accent, false: colors.surface2 }} accessibilityLabel="Use each day's published exchange rate" />
          </View>
          {online ? (
            <Button className="mt-3" variant="secondary" label={busy ? 'Checking…' : 'Update past spends now'} disabled={busy} onPress={async () => {
              setBusy(true);
              const r = await refreshForeignRates(db, { force: true });
              setBusy(false);
              snack({ message: r.updated ? `Updated ${r.updated} spend${r.updated === 1 ? '' : 's'}` : r.failed ? 'Could not reach the rate service. Try again when online.' : 'Everything is already up to date' });
            }} />
          ) : null}
        </Card>

        {CURRENCIES.map((c) => {
          const v = vals[c.code] ?? '';
          const bad = v !== '' && !(parseFloat(v) > 0);
          return (
            <View key={c.code} className="mb-2 rounded-[22px] border border-line bg-card p-3">
              <View className="flex-row items-center">
                <View className="mr-3 h-10 min-w-[56px] items-center justify-center rounded-full bg-card2 px-3"><Text className="text-sm font-bold text-fg">{c.code}</Text></View>
                <Text className="mr-2 text-sm text-muted">₹ per 1</Text>
                <TextInput
                  className="min-h-11 flex-1 rounded-xl bg-card2 px-3 text-base text-fg"
                  style={bad ? { borderWidth: 1, borderColor: colors.danger } : undefined}
                  value={v} onChangeText={(x) => setVals((s) => ({ ...s, [c.code]: x }))}
                  placeholder={`${c.rate} · automatic`} placeholderTextColor={colors.muted}
                  keyboardType="decimal-pad" accessibilityLabel={`Rupees per 1 ${c.code}, ${v ? 'your rate' : 'automatic'}`} accessibilityHint={bad ? 'Enter a number above zero' : undefined}
                />
              </View>
              {!ONLINE_CODES.includes(c.code) && v === '' ? <Text className="mt-1.5 pl-1 text-xs text-muted">No published rate for {c.code}: the default above is used until you set one.</Text> : null}
            </View>
          );
        })}
        <View className="h-4" />
      </ScrollView>
      <View className="border-t border-line bg-base pb-4 pt-3">
        <Button label="Save rates" disabled={invalid} onPress={save} />
      </View>
    </View>
  );
}
