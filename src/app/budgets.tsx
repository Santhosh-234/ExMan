import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ChevronLeft, Plus } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { Text, TextInput } from '@/ui/Text';

import { MonthBar } from '@/components/MonthBar';
import { type BudgetLine, type Category, budgetOverview, getBudgetRow, getCategories, setBudgetRow } from '@/db/queries';
import { onIngested, notifyIngested } from '@/ingest/events';
import { useSecurity } from '@/security/store';
import { track } from '@/telemetry';
import { Button, Card, Chip, EmptyState, Sheet } from '@/ui/kit';
import { useSnackbar } from '@/ui/Snackbar';
import { useTheme } from '@/ui/theme';
import { budgetStatus } from '@/utils/budgets';
import { monthKey, monthLabel, rupees } from '@/utils/format';

type Edit = { id: number | null; name: string; amount: string; rollover: boolean; isNew: boolean };

export default function Budgets() {
  useSecurity();
  const db = useSQLiteContext();
  const router = useRouter();
  const snack = useSnackbar();
  const { colors } = useTheme();
  const now = new Date();
  const nowKey = monthKey(now);
  const [month, setMonth] = useState(nowKey);
  const [lines, setLines] = useState<BudgetLine[] | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [ed, setEd] = useState<Edit | null>(null);

  const load = useCallback(async () => { setLines(await budgetOverview(db, month)); setCats(await getCategories(db)); }, [db, month]);
  useEffect(() => void load(), [load]);
  useEffect(() => onIngested(() => void load()), [load]);

  const open = async (l?: BudgetLine) => {
    if (l) return setEd({ id: l.category_id, name: l.name, amount: String(l.limit / 100), rollover: l.rollover, isNew: false });
    setEd({ id: -1, name: '', amount: '', rollover: false, isNew: true }); // -1 = choosing a category
  };

  const save = async () => {
    if (!ed || ed.id === -1) return;
    const v = Math.round(parseFloat(ed.amount.replace(/,/g, '')) * 100);
    if (!(v > 0)) return;
    await setBudgetRow(db, ed.id, month, v, ed.rollover);
    track('feature_used', { feature: 'budget_set' });
    setEd(null); notifyIngested(); load();
  };

  const remove = async () => {
    if (!ed || ed.id === -1) return;
    const before = await getBudgetRow(db, ed.id, month);
    const id = ed.id;
    await setBudgetRow(db, id, month, null);
    setEd(null); notifyIngested(); load();
    snack({ message: `Budget removed from ${monthLabel(month)} on`, onAction: async () => { if (before) await setBudgetRow(db, id, month, before.limit, before.rollover); notifyIngested(); load(); } });
  };

  const have = new Set((lines ?? []).map((l) => l.category_id));
  const free = cats.filter((c) => !c.archived && !have.has(c.id));

  return (
    <View className="flex-1 bg-base px-4 pt-14">
      <Pressable onPress={() => router.back()} hitSlop={12} className="mb-2 flex-row items-center" accessibilityRole="button" accessibilityLabel="Back">
        <ChevronLeft color={colors.fg} /><Text className="text-fg">Back</Text>
      </Pressable>
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-3xl font-bold text-fg" accessibilityRole="header">Budgets</Text>
        <Pressable onPress={() => open()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Add a budget"><Plus color={colors.accent} /></Pressable>
      </View>
      <Text className="mb-3 text-xs text-muted">A budget you set applies to that month and every later month until you change it.</Text>
      <MonthBar month={month} onChange={setMonth} max={nowKey} />

      <ScrollView showsVerticalScrollIndicator={false}>
        {lines && lines.length === 0 && <EmptyState title="No budgets yet" body="Set an overall monthly budget, or one for a category like Food or Shopping." action={<Button label="Add a budget" onPress={() => open()} />} />}
        {(lines ?? []).map((l) => {
          const st = budgetStatus({ limit: l.limit, carry: l.carry, spent: l.spent, month, now });
          const tone = st.state === 'over' ? colors.danger : st.state === 'near' || st.aheadOfPace ? colors.warn : colors.accent;
          return (
            <Pressable key={String(l.category_id)} onPress={() => open(l)} accessibilityRole="button" accessibilityLabel={`${l.name} budget, ${Math.round(st.pct * 100)} percent used`}>
              <Card className="mb-3">
                <View className="mb-2 flex-row items-center justify-between">
                  <View className="flex-row items-center"><View className="mr-2 h-3 w-3 rounded-full" style={{ backgroundColor: l.color }} /><Text className="text-base font-semibold text-fg">{l.name}</Text></View>
                  <Text className="text-sm text-muted">{rupees(st.spent)} of {rupees(st.available)}</Text>
                </View>
                <View className="h-3 overflow-hidden rounded-full bg-card2" accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.min(100, Math.round(st.pct * 100)) }}>
                  <View className="h-3 rounded-full" style={{ width: `${Math.min(1, st.pct) * 100}%`, backgroundColor: tone }} />
                </View>
                <Text className="mt-2 text-sm" style={{ color: tone }}>
                  {st.state === 'over' ? `Over by ${rupees(-st.remaining)}` : `${rupees(st.remaining)} left`}
                  {st.state !== 'over' && st.dailySafe != null ? ` · about ${rupees(st.dailySafe)} a day` : ''}
                </Text>
                {st.aheadOfPace && st.projected != null && <Text className="mt-1 text-xs text-warn">At this pace you'll reach {rupees(st.projected)} by month end.</Text>}
                {l.carry > 0 && <Text className="mt-1 text-xs text-muted">Includes {rupees(l.carry)} rolled over from last month.</Text>}
              </Card>
            </Pressable>
          );
        })}
        <View className="h-10" />
      </ScrollView>

      {ed && ed.id === -1 && (
        <Sheet title="Budget for…" onClose={() => setEd(null)}>
          <View className="flex-row flex-wrap">
            {!have.has(null) && <Chip label="Overall (all spending)" color={colors.accent} onPress={() => setEd({ id: null, name: 'Overall', amount: '', rollover: false, isNew: true })} />}
            {free.map((c) => <Chip key={c.id} label={c.name} color={c.color} onPress={() => setEd({ id: c.id, name: c.name, amount: '', rollover: false, isNew: true })} />)}
          </View>
        </Sheet>
      )}
      {ed && ed.id !== -1 && (
        <Sheet title={`${ed.name} budget`} onClose={() => setEd(null)}>
          <Text className="mb-1 text-xs text-muted">Monthly limit (₹), from {monthLabel(month)} on</Text>
          <TextInput className="mb-3 min-h-12 rounded-2xl bg-card2 px-4 py-3 text-base text-fg" value={ed.amount} onChangeText={(amount) => setEd({ ...ed, amount })} keyboardType="decimal-pad" autoFocus placeholder="e.g. 8000" placeholderTextColor={colors.muted} />
          <View className="mb-3 flex-row items-center">
            <View className="mr-3 flex-1"><Text className="text-base text-fg">Roll over unused money</Text><Text className="text-xs text-muted">What you don't spend this month is added to next month's budget.</Text></View>
            <Switch value={ed.rollover} onValueChange={(rollover) => setEd({ ...ed, rollover })} trackColor={{ true: colors.accent, false: colors.surface2 }} accessibilityLabel="Roll over unused money" />
          </View>
          <Button label="Save" disabled={!(parseFloat(ed.amount.replace(/,/g, '')) > 0)} onPress={save} className="mb-2" />
          {!ed.isNew && <Button variant="danger" label="Remove this budget" onPress={remove} />}
        </Sheet>
      )}
    </View>
  );
}

