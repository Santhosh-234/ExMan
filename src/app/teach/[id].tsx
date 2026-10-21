import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ChevronLeft } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { type Unparsed, getUnparsed, savePattern } from '@/db/patterns';
import { reprocessUnparsed } from '@/ingest/run';
import { track } from '@/telemetry';
import { Button, Card, Chip } from '@/ui/kit';
import { useSnackbar } from '@/ui/Snackbar';
import { useTheme } from '@/ui/theme';
import { rupees } from '@/utils/format';
import { CURRENCIES, formatForeign, isForeign } from '@/utils/currency';
import { type Selection, buildPattern, NUMERIC, detectCurrency, tokenize } from '@/utils/teach';

type Field = 'amount' | 'merchant' | 'account';

export default function Teach() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const snack = useSnackbar();
  const { colors } = useTheme();
  const [msg, setMsg] = useState<Unparsed | null>(null);
  const [field, setField] = useState<Field>('amount');
  const [direction, setDirection] = useState<'debit' | 'credit' | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [account, setAccount] = useState<number | null>(null);
  const [mStart, setMStart] = useState<number | null>(null);
  const [mEnd, setMEnd] = useState<number | null>(null);
  const [currency, setCurrency] = useState('INR');
  const [detected, setDetected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => void getUnparsed(db, Number(id)).then(setMsg), [db, id]);
  const tokens = useMemo(() => (msg ? tokenize(msg.text) : []), [msg]);

  const selection: Selection | null = amount == null ? null : {
    amount: [amount, amount],
    ...(account != null ? { account: [account, account] as [number, number] } : {}),
    ...(mStart != null ? { merchant: [Math.min(mStart, mEnd ?? mStart), Math.max(mStart, mEnd ?? mStart)] as [number, number] } : {}),
  };
  const built = msg && selection && direction ? buildPattern(msg.text, selection, direction, currency) : null;

  const tint = (i: number): string | undefined => {
    if (i === amount) return colors.accent;
    if (i === account) return colors.warn;
    if (mStart != null && i >= Math.min(mStart, mEnd ?? mStart) && i <= Math.max(mStart, mEnd ?? mStart)) return '#3B82F6';
    return undefined;
  };

  const tap = (i: number) => {
    setError('');
    const numeric = NUMERIC.test(tokens[i].text);
    if (field === 'amount') {
      if (!numeric) setError('The amount is a number. Tap the digits.');
      else {
        setAmount(i === amount ? null : i);
        // the message itself says which currency: "32 USD", "USD 32", "$32"
        const found = msg ? detectCurrency(msg.text, tokens, i) : null;
        if (found) { setCurrency(found); setDetected(found); } else setDetected(null);
      }
    }
    else if (field === 'account') { if (numeric) setAccount(i === account ? null : i); else setError('Tap the last 3-4 digits of the account number.'); }
    else if (mStart == null || mEnd != null) { setMStart(i); setMEnd(null); }
    else setMEnd(i);
  };

  const save = async () => {
    if (!msg || !built) return;
    if (!built.ok) return setError(built.error);
    setSaving(true);
    try {
      await savePattern(db, msg.sender, built.pattern, msg.text);
      const n = await reprocessUnparsed(db);
      track('feature_used', { feature: 'teach_saved' });
      snack({ message: `Learned this format · added ${n} transaction${n === 1 ? '' : 's'} to Review` });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      setSaving(false);
    }
  };

  if (!msg) return <View className="flex-1 bg-base" />;
  const hint = field === 'amount' ? 'Tap the amount.' : field === 'merchant' ? 'Tap the first and last word of the merchant (optional).' : 'Tap the last digits of the account (optional).';

  return (
    <View className="flex-1 bg-base px-4 pt-14">
      <Pressable onPress={() => router.back()} hitSlop={12} className="mb-2 flex-row items-center" accessibilityRole="button" accessibilityLabel="Back">
        <ChevronLeft color={colors.fg} /><Text className="text-fg">Back</Text>
      </Pressable>
      <Text className="text-3xl font-bold text-fg" accessibilityRole="header">Teach ExMan</Text>
      <Text className="mb-3 text-xs text-muted">From {msg.sender}. Show ExMan where the details are in this message.</Text>

      <ScrollView showsVerticalScrollIndicator={false}>
        <Text className="mb-1 text-xs uppercase tracking-wider text-muted">1 · What is it?</Text>
        <View className="mb-2 flex-row">
          <Chip label="Spent" color={colors.danger} selected={direction === 'debit'} onPress={() => setDirection('debit')} />
          <Chip label="Received" color={colors.accent} selected={direction === 'credit'} onPress={() => setDirection('credit')} />
        </View>

        <Text className="mb-1 mt-2 text-xs uppercase tracking-wider text-muted">Currency of the amount</Text>
        <View className="mb-1 flex-row flex-wrap">
          {['INR', ...CURRENCIES.map((c) => c.code)].map((c) => <Chip key={c} label={c} color={colors.accent} selected={currency === c} onPress={() => setCurrency(c)} />)}
        </View>
        {detected && <Text className="mb-1 text-xs text-accent">Detected {detected} next to the amount in this message.</Text>}
        {isForeign(currency) && <Text className="mb-2 text-xs text-muted">Foreign amounts are converted to rupees at the rate in Settings, Exchange rates. It's approximate; edit the transaction if your statement differs.</Text>}

        <Text className="mb-1 mt-2 text-xs uppercase tracking-wider text-muted">2 · Pick what to mark</Text>
        <View className="mb-1 flex-row">
          <Chip label="Amount" color={colors.accent} selected={field === 'amount'} onPress={() => setField('amount')} />
          <Chip label="Merchant" color="#3B82F6" selected={field === 'merchant'} onPress={() => setField('merchant')} />
          <Chip label="Account" color={colors.warn} selected={field === 'account'} onPress={() => setField('account')} />
        </View>
        <Text className="mb-2 text-sm text-muted">{hint}</Text>

        <Card className="mb-3">
          <View className="flex-row flex-wrap">
            {tokens.map((t, i) => {
              const c = tint(i);
              return (
                <Pressable key={i} onPress={() => tap(i)} accessibilityRole="button" accessibilityLabel={`${t.text}${c ? ', selected' : ''}`} hitSlop={2}
                  className="mb-1 mr-0.5 min-h-8 justify-center rounded-lg px-1" style={c ? { backgroundColor: c } : undefined}>
                  <Text className="text-base" style={{ color: c ? '#FFFFFF' : colors.fg }}>{t.text}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        {built?.ok && (
          <Card className="mb-3">
            <Text className="mb-1 text-xs uppercase tracking-wider text-muted">ExMan will read this as</Text>
            <Text className="text-base text-fg">
              {built.preview.direction === 'debit' ? 'Spent' : 'Received'} {isForeign(currency) ? formatForeign(Math.round(built.preview.amountPaise / 100 * 10 ** (CURRENCIES.find((c) => c.code === currency)?.minor ?? 2)), currency) : rupees(built.preview.amountPaise)}
              {built.preview.merchant ? ` · ${built.preview.merchant}` : ''}{built.preview.account ? ` · a/c ${built.preview.account}` : ''}
            </Text>
          </Card>
        )}
        {(error || (built && !built.ok)) && <Text className="mb-3 text-danger">{error || (built && !built.ok ? built.error : '')}</Text>}
        {!direction && <Text className="mb-3 text-sm text-muted">Choose Spent or Received first.</Text>}

        <Button label={saving ? 'Saving…' : 'Teach this format'} disabled={!built?.ok || saving} onPress={save} className="mb-10" />
      </ScrollView>
    </View>
  );
}
