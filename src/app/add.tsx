import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput, type TextInputHandle } from '@/ui/Text';

import { type Account, type Category, addManualTxn, getAccounts, getCategories, recentManualMerchants } from '@/db/queries';
import { notifyIngested } from '@/ingest/events';
import { track } from '@/telemetry';
import { Button, Chip, success } from '@/ui/kit';
import { useSnackbar } from '@/ui/Snackbar';
import { useTheme } from '@/ui/theme';
import { rupees } from '@/utils/format';

const DAY = 864e5;
const startOfDay = (ts: number) => new Date(new Date(ts).setHours(0, 0, 0, 0)).getTime();

/** Manual / cash entry. Saved as confirmed, no review step. */
export default function Add() {
  const db = useSQLiteContext();
  const router = useRouter();
  const snack = useSnackbar();
  const { colors } = useTheme();
  const [direction, setDirection] = useState<'debit' | 'credit'>('debit');
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [tags, setTags] = useState('');
  const [cat, setCat] = useState<number | null>(null);
  const [acct, setAcct] = useState<number | null>(null);
  const [day, setDay] = useState(startOfDay(Date.now()));
  const [cats, setCats] = useState<Category[]>([]);
  const [accts, setAccts] = useState<Account[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const merchantRef = useRef<TextInputHandle>(null);
  const tagsRef = useRef<TextInputHandle>(null);

  useEffect(() => {
    (async () => {
      const [c, a, r] = await Promise.all([getCategories(db), getAccounts(db), recentManualMerchants(db)]);
      setCats(c); setAccts(a); setRecent(r.map((x) => x.merchant));
      setAcct(a.find((x) => x.kind === 'cash')?.id ?? a[0]?.id ?? null);
    })();
  }, [db]);

  const paise = Math.round(parseFloat(amount.replace(/,/g, '')) * 100);
  const valid = paise > 0;
  const today = startOfDay(Date.now());
  const dayLabel = day === today ? 'Today' : day === today - DAY ? 'Yesterday' : new Date(day).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const input = 'mb-4 min-h-12 rounded-2xl bg-card px-4 py-3 text-base text-fg';

  const save = async () => {
    // keep the current time-of-day when logging for today so ordering within the day makes sense
    const now = new Date();
    const ts = day + (now.getTime() - startOfDay(now.getTime()));
    await addManualTxn(db, {
      amount_paise: paise, direction, merchant: merchant.trim() || null, category_id: cat, account_id: acct, ts: Math.min(ts, Date.now()),
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean).join(','), notes: null,
    });
    success();
    track('feature_used', { feature: 'manual_add' });
    notifyIngested();
    snack({ message: `Added ${rupees(paise)}${merchant.trim() ? ` · ${merchant.trim()}` : ''}` });
    router.back();
  };

  return (
    <View className="flex-1 bg-base">
      <ScrollView className="px-4 pt-14" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View className="mb-4 flex-row items-center justify-between">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" className="h-10 w-10 items-center justify-center rounded-full border border-line bg-card"><X size={20} color={colors.fg} /></Pressable>
          <Text className="text-lg font-semibold text-fg" accessibilityRole="header">Add transaction</Text>
          <View className="w-6" />
        </View>

        <View className="mb-4 flex-row">
          <Chip label="Spent" selected={direction === 'debit'} color={colors.danger} onPress={() => setDirection('debit')} />
          <Chip label="Received" selected={direction === 'credit'} color={colors.accent} onPress={() => setDirection('credit')} />
        </View>

        <Text className="mb-1 text-xs text-muted">Amount (₹)</Text>
        <TextInput
          className="mb-4 rounded-[22px] border border-line bg-card px-4 py-4 text-4xl font-bold text-fg"
          value={amount} onChangeText={setAmount} keyboardType="decimal-pad" autoFocus selectTextOnFocus returnKeyType="next" blurOnSubmit={false}
          onSubmitEditing={() => merchantRef.current?.focus()}
          placeholder="0" placeholderTextColor={colors.muted} accessibilityLabel="Amount in rupees"
        />

        <Text className="mb-1 text-xs text-muted">Merchant or note</Text>
        <TextInput ref={merchantRef} className={recent.length && !merchant ? 'mb-2 min-h-12 rounded-2xl bg-card px-4 py-3 text-base text-fg' : input} value={merchant} onChangeText={setMerchant} placeholder="e.g. Chai, Auto, Rent" placeholderTextColor={colors.muted} returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => tagsRef.current?.focus()} />
        {recent.length > 0 && !merchant && (
          <View className="mb-3 flex-row flex-wrap">
            {recent.map((m) => <Chip key={m} label={m} onPress={() => setMerchant(m)} />)}
          </View>
        )}

        <Text className="mb-2 text-xs text-muted">Category</Text>
        <View className="mb-2 flex-row flex-wrap">
          {cats.filter((c) => !c.archived).map((c) => <Chip key={c.id} label={c.name} color={c.color} selected={cat === c.id} onPress={() => setCat(cat === c.id ? null : c.id)} />)}
        </View>

        <Text className="mb-2 text-xs text-muted">Account</Text>
        <View className="mb-2 flex-row flex-wrap">
          {accts.map((a) => <Chip key={a.id} label={a.name} selected={acct === a.id} color={colors.accent} onPress={() => setAcct(a.id)} />)}
        </View>

        <Text className="mb-2 text-xs text-muted">Date</Text>
        <View className="mb-4 flex-row items-center justify-between rounded-2xl border border-line bg-card p-2">
          <Pressable onPress={() => setDay(day - DAY)} hitSlop={8} className="p-2" accessibilityRole="button" accessibilityLabel="Previous day"><ChevronLeft color={colors.muted} /></Pressable>
          <Pressable onPress={() => setDay(today)} accessibilityRole="button"><Text className="text-base text-fg">{dayLabel}</Text></Pressable>
          <Pressable disabled={day >= today} onPress={() => setDay(Math.min(today, day + DAY))} hitSlop={8} className="p-2" accessibilityRole="button" accessibilityLabel="Next day">
            <ChevronRight color={day >= today ? colors.line : colors.muted} />
          </Pressable>
        </View>

        <Text className="mb-1 text-xs text-muted">Tags (comma separated)</Text>
        <TextInput ref={tagsRef} className={input} value={tags} onChangeText={setTags} autoCapitalize="none" placeholder="trip, work" placeholderTextColor={colors.muted} returnKeyType="done" onSubmitEditing={() => { if (valid) void save(); }} />
        <View className="h-4" />
      </ScrollView>
      {/* always reachable, even with the keyboard open */}
      <View className="border-t border-line bg-base px-4 pb-4 pt-3">
        <Button label={valid ? `Save ${rupees(paise)}` : 'Save'} disabled={!valid} onPress={save} />
      </View>
    </View>
  );
}
