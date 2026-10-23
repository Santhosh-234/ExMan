import { useSecurity } from '@/security/store';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ChevronRight, Eye, EyeOff, Inbox, TrendingDown, TrendingUp } from 'lucide-react-native';
import { updateSecurity } from '@/security/store';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/ui/Text';

import { MonthBar } from '@/components/MonthBar';
import { dueText } from '../subscriptions';
import { type BudgetLine, type Category, type CategorySpend, type Txn, budgetOverview, countPending, getBudget, getCategories, queryTxns, setBudget, spendByCategory, totalFor } from '@/db/queries';
import { countUnparsed } from '@/db/patterns';
import { cachedApkUpdate, dismissApkUpdate } from '@/updates/apk';
import { type ApkUpdate, isTrustedApkUrl } from '@/utils/apkUpdate';
import { acknowledgeAutoTransfers, countAutoTransfers } from '@/db/transfers';
import { notifyIngested, onIngested } from '@/ingest/events';
import { AnimatedBar, Pressy, CountUp, FadeIn } from '@/ui/anim';
import { Button, Card, Fab, SectionLabel, Skeleton } from '@/ui/kit';
import { useTheme } from '@/ui/theme';
import { TxnRow } from '@/ui/TxnRow';
import { monthKey, monthRange, rupees, shiftMonth } from '@/utils/format';
import { budgetStatus } from '@/utils/budgets';
import { getRecurring } from '@/db/recurring';
import { type Recurring } from '@/utils/recurring';
import { PageScroll } from '@/ui/insets';

export default function Home() {
  const { hide } = useSecurity(); // re-render when "hide amounts" changes
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useTheme();
  const now = monthKey(new Date());
  const [month, setMonth] = useState(now);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(0);
  const [autoTransfers, setAutoTransfers] = useState(0);
  const [unparsed, setUnparsed] = useState(0);
  const [apk, setApk] = useState<ApkUpdate | null>(null);
  const [upcoming, setUpcoming] = useState<Recurring[]>([]);
  const [alerts, setAlerts] = useState<{ line: BudgetLine; pct: number; over: boolean; left: number }[]>([]);
  const [spend, setSpend] = useState<CategorySpend[]>([]);
  const [income, setIncome] = useState(0);
  const [prevSpent, setPrevSpent] = useState(0);
  const [budget, setBudgetState] = useState<number | null>(null);
  const [recent, setRecent] = useState<Txn[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const load = useCallback(async () => {
    const [from, to] = monthRange(month);
    const [pf, pt] = monthRange(shiftMonth(month, -1));
    const [p, s, i, ps, b, r, c, at, up] = await Promise.all([
      countPending(db), spendByCategory(db, from, to), totalFor(db, 'credit', from, to), totalFor(db, 'debit', pf, pt), getBudget(db, month),
      queryTxns(db, { from, to, transfers: 'hide' }, 0), getCategories(db), countAutoTransfers(db), countUnparsed(db),
    ]);
    // category budgets at 80% or more (current month only): shown as alerts, worst first
    const lines = month === monthKey(new Date()) ? await budgetOverview(db, month) : [];
    setAlerts(lines.filter((l) => l.category_id !== null).map((line) => ({ line, st: budgetStatus({ limit: line.limit, carry: line.carry, spent: line.spent, month, now: new Date() }) }))
      .filter((x) => x.st.state !== 'ok').map((x) => ({ line: x.line, pct: x.st.pct, over: x.st.state === 'over', left: x.st.remaining })).sort((a, b) => b.pct - a.pct).slice(0, 2));
    // subscriptions due in the next week (current month view only)
    const rec = month === monthKey(new Date()) ? await getRecurring(db) : [];
    setUpcoming(rec.filter((r) => r.status === 'active' && r.nextTs - Date.now() <= 7 * 864e5).slice(0, 2));
    setApk(await cachedApkUpdate(db));
    setPending(p); setAutoTransfers(at); setUnparsed(up); setSpend(s); setIncome(i); setPrevSpent(ps); setBudgetState(b); setRecent(r.slice(0, 5)); setCats(c); setLoaded(true);
  }, [db, month]);
  useFocusEffect(useCallback(() => void load(), [load]));
  useEffect(() => onIngested(() => void load()), [load]);

  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const spent = spend.reduce((a, s) => a + s.total, 0);
  const pct = budget ? Math.min(1, spent / budget) : 0;
  const over = budget != null && spent > budget;

  const [from, to] = monthRange(month);
  const today = new Date();
  const daysInMonth = Math.round((to - from) / 864e5);
  const daysLeft = month === now ? daysInMonth - today.getDate() + 1 : 0;
  const safeDaily = budget && daysLeft > 0 && !over ? (budget - spent) / daysLeft : null;
  const delta = prevSpent ? Math.round(((spent - prevSpent) / prevSpent) * 100) : null;
  const top = spend.slice(0, 3);
  const topMax = Math.max(1, ...top.map((s) => s.total));

  return (
    <View className="flex-1 bg-base">
      <PageScroll tab>
        <View className="mb-5 flex-row items-center justify-between">
          <View>
            <Text className="text-sm text-muted">{today.getHours() < 12 ? 'Good morning' : today.getHours() < 17 ? 'Good afternoon' : 'Good evening'}</Text>
            <Text className="text-3xl font-bold text-fg" accessibilityRole="header">Home</Text>
          </View>
          <Pressable onPress={() => void updateSecurity(db, { hide: !hide })} hitSlop={12} accessibilityRole="button" accessibilityLabel={hide ? 'Show amounts' : 'Hide amounts'}>
            {hide ? <EyeOff color={colors.muted} /> : <Eye color={colors.muted} />}
          </Pressable>
        </View>

        {apk && (
          <Card className="mb-4">
            <Text className="text-base font-semibold text-fg">New app version available</Text>
            <Text className="mt-1 text-sm text-muted">{apk.name}{apk.sizeMb ? ` · ${apk.sizeMb} MB` : ''}. It includes changes that a normal update can't deliver. Download it, open the file, and install over this one. Your data is kept.</Text>
            <View className="mt-3 flex-row">
              <Button className="mr-3 flex-1" label="Download" onPress={() => { if (isTrustedApkUrl(apk.url)) void Linking.openURL(apk.url); }} />
              <Button className="flex-1" variant="secondary" label="Later" onPress={async () => { await dismissApkUpdate(db, apk.tag); setApk(null); }} />
            </View>
          </Card>
        )}

        {pending > 0 && (
          <Pressy onPress={() => router.push('/review')} accessibilityRole="button" accessibilityLabel={`${pending} transactions to review`} className="mb-4" innerClassName="flex-row items-center rounded-[26px] bg-accent p-4">
            <Inbox color={colors.onaccent} />
            <View className="ml-3 flex-1">
              <Text className="text-base font-semibold text-onaccent">{pending} to review</Text>
              <Text className="text-sm text-onaccent opacity-80">Swipe through them in seconds</Text>
            </View>
            <ChevronRight color={colors.onaccent} />
          </Pressy>
        )}

        {upcoming.map((r) => (
          <Pressy key={r.merchant_id} onPress={() => router.push('/subscriptions')} accessibilityRole="button" className="mb-4" innerClassName="flex-row items-center rounded-[26px] border border-line bg-card p-4">
            <View className="flex-1">
              <Text className="text-base font-semibold text-fg">{r.merchant} · {rupees(r.amount)}</Text>
              <Text className="text-sm text-muted">{dueText(r)}{r.priceChange ? ` · price up from ${rupees(r.priceChange.from)}` : ''}</Text>
            </View>
            <ChevronRight color={colors.muted} />
          </Pressy>
        ))}

        {alerts.map((a) => (
          <Pressy key={String(a.line.category_id)} onPress={() => router.push('/budgets')} accessibilityRole="button" className="mb-4" innerClassName="flex-row items-center rounded-[26px] border border-line bg-card p-4">
            <View className="mr-3 h-3 w-3 rounded-full" style={{ backgroundColor: a.over ? colors.danger : colors.warn }} />
            <View className="flex-1">
              <Text className="text-base font-semibold text-fg">{a.line.name}: {a.over ? 'over budget' : `${Math.round(a.pct * 100)}% used`}</Text>
              <Text className="text-sm text-muted">{a.over ? `${rupees(-a.left)} over its ${rupees(a.line.limit + a.line.carry)} budget` : `${rupees(a.left)} left this month`}</Text>
            </View>
            <ChevronRight color={colors.muted} />
          </Pressy>
        ))}

        {unparsed > 0 && (
          <Pressy onPress={() => router.push('/unrecognised')} accessibilityRole="button" className="mb-4" innerClassName="flex-row items-center rounded-[26px] border border-line bg-card p-4">
            <View className="flex-1">
              <Text className="text-base font-semibold text-fg">{unparsed} message{unparsed === 1 ? '' : 's'} couldn't be read</Text>
              <Text className="mt-1 text-sm text-muted">Teach ExMan the format once and it reads similar ones from now on.</Text>
            </View>
            <ChevronRight color={colors.muted} />
          </Pressy>
        )}

        {autoTransfers > 0 && (
          <Card className="mb-4">
            <Text className="text-base font-semibold text-fg">{autoTransfers} transfer{autoTransfers === 1 ? '' : 's'} detected</Text>
            <Text className="mt-1 text-sm text-muted">Moves between your own accounts and card bill payments are left out of spending and income.</Text>
            <View className="mt-3 flex-row">
              <Button className="mr-3 flex-1" variant="secondary" label="Review" onPress={() => router.push('/activity?transfers=only')} />
              <Button className="flex-1" variant="secondary" label="Looks right" onPress={async () => { await acknowledgeAutoTransfers(db); notifyIngested(); }} />
            </View>
          </Card>
        )}

        <MonthBar month={month} onChange={setMonth} max={now} />

        {!loaded ? (
          <Card className="mb-4"><Skeleton style={{ width: 120, height: 14 }} /><Skeleton style={{ width: 200, height: 40, marginTop: 10 }} /><Skeleton style={{ height: 12, marginTop: 20 }} /></Card>
        ) : (
          <FadeIn index={1}><Card className="mb-4">
            <Text className="text-xs font-semibold uppercase tracking-widest text-muted">Spent in {month === now ? 'this month' : 'the month'}</Text>
            <CountUp value={spent} format={rupees} className="mt-1 text-5xl font-bold text-fg" accessibilityLabel={`Spent ${rupees(spent)}`} />
            {delta != null && (
              <View className="mt-1 flex-row items-center">
                {delta > 0 ? <TrendingUp size={14} color={colors.danger} /> : <TrendingDown size={14} color={colors.accent} />}
                <Text className={`ml-1 text-sm ${delta > 0 ? 'text-danger' : 'text-accent'}`}>{delta === 0 ? 'Same as last month' : `${Math.abs(delta)}% ${delta > 0 ? 'more' : 'less'} than last month`}</Text>
              </View>
            )}

            <View className="mt-5" accessibilityRole="progressbar" accessibilityValue={budget ? { min: 0, max: 100, now: Math.round(pct * 100) } : undefined}>
              <AnimatedBar pct={pct} color={over ? colors.danger : colors.accent} height={10} />
            </View>
            {editing ? (
              <View className="mt-3 flex-row items-center">
                <TextInput
                  className="mr-3 min-h-12 flex-1 rounded-2xl bg-card2 px-4 text-base text-fg"
                  value={draft} onChangeText={setDraft} keyboardType="numeric" autoFocus
                  placeholder="Monthly budget in ₹ (blank to clear)" placeholderTextColor={colors.muted}
                />
                <Button label="Save" onPress={async () => {
                  const v = Math.round(parseFloat(draft) * 100);
                  await setBudget(db, month, v > 0 ? v : null);
                  setEditing(false);
                  load();
                }} />
              </View>
            ) : (
              <Pressable onPress={() => { setDraft(budget ? String(budget / 100) : ''); setEditing(true); }} className="mt-3" accessibilityRole="button">
                <Text className={over ? 'text-danger' : 'text-muted'}>
                  {budget ? `${rupees(spent)} of ${rupees(budget)}${over ? ` · over by ${rupees(spent - budget)}` : ` · ${rupees(budget - spent)} left`}` : 'Set a monthly budget ›'}
                </Text>
                {safeDaily != null && <Text className="mt-1 text-sm text-muted">Safe to spend {rupees(safeDaily)} a day for {daysLeft} more days</Text>}
              </Pressable>
            )}
            <Pressable onPress={() => router.push('/budgets')} hitSlop={8} accessibilityRole="button" className="mt-2"><Text className="text-accent">Budgets by category ›</Text></Pressable>

            <View className="mt-4 flex-row border-t border-line pt-3">
              <View className="flex-1"><Text className="text-xs text-muted">Income</Text><Text className="text-lg font-semibold text-income">{rupees(income)}</Text></View>
              <View className="flex-1"><Text className="text-xs text-muted">Net</Text><Text className={`text-lg font-semibold ${income - spent < 0 ? 'text-danger' : 'text-fg'}`}>{income - spent < 0 ? '-' : ''}{rupees(Math.abs(income - spent))}</Text></View>
            </View>
          </Card></FadeIn>
        )}

        {top.length > 0 && (
          <FadeIn index={2}><Card className="mb-4">
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-base font-semibold text-fg">Top categories</Text>
              <Pressable onPress={() => router.push('/insights')} hitSlop={10} accessibilityRole="button"><Text className="text-accent">See all</Text></Pressable>
            </View>
            {top.map((s) => (
              <Pressy key={String(s.category_id)} onPress={() => router.push(`/activity?category=${s.category_id ?? 'none'}&month=${month}&direction=debit&n=${Date.now()}`)} scaleTo={0.99} accessibilityRole="button" accessibilityLabel={`${s.name}, ${rupees(s.total)}. Show its transactions`} innerClassName="mb-3">
                <View className="mb-1 flex-row justify-between"><Text className="text-fg">{s.name}</Text><Text className="text-muted" style={{ fontVariant: ['tabular-nums'] }}>{rupees(s.total)}</Text></View>
                <AnimatedBar pct={s.total / topMax} color={s.color} height={8} />
              </Pressy>
            ))}
          </Card></FadeIn>
        )}

        <SectionLabel right={<Pressable onPress={() => router.push('/activity')} hitSlop={10} accessibilityRole="button"><Text className="text-sm font-semibold text-accent">See all</Text></Pressable>}>Recent</SectionLabel>
        {loaded && recent.length === 0 ? (
          <Card className="mb-4"><Text className="text-muted">Nothing confirmed this month yet. Review new transactions, or tap + to add one.</Text></Card>
        ) : (
          recent.map((t) => <TxnRow key={t.id} t={t} cat={catById.get(t.category_id ?? -1)} onPress={(x) => router.push(`/txn/${x.id}`)} />)
        )}
        <View className="h-28" />
      </PageScroll>
      <Fab onPress={() => router.push('/add')} />
    </View>
  );
}
