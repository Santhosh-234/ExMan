import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ArrowLeftRight, CheckCircle2, FileText, Landmark, Square, SquareCheck } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/ui/Text';

import { utf8Decode } from '@/backup/crypto';
import { type StatementRow, applyStatement, guessAccount, listStatements, previewStatement, undoStatement } from '@/db/statements';
import { type Account, getAccounts } from '@/db/queries';
import { notifyIngested } from '@/ingest/events';
import { useSecurity } from '@/security/store';
import { FadeIn } from '@/ui/anim';
import { Page } from '@/ui/insets';
import { BackButton, Button, Card, Chip, EmptyState, ListRow, PageHeader, SectionLabel, Sheet, Stats, tap } from '@/ui/kit';
import { useSnackbar } from '@/ui/Snackbar';
import { useTheme } from '@/ui/theme';
import { readCsv } from '@/utils/csvread';
import { rupees } from '@/utils/format';
import type { ExTxn, Reconciliation } from '@/utils/reconcile';
import { type ParsedStatement, type StmtLine, dayOfTs, parseStatement } from '@/utils/statement';

const dayLabel = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
const period = (a: string, b: string) => `${dayLabel(a)} – ${dayLabel(b)}`;
const signed = (dir: 'debit' | 'credit', paise: number) => `${dir === 'debit' ? '−' : '+'}${rupees(paise)}`;

type Loaded = { st: ParsedStatement; name: string };

/** Check a bank statement against what ExMan recorded: finds payments that never produced a message, and anything ExMan has that the bank doesn't. */
export default function Statement() {
  useSecurity();
  const db = useSQLiteContext();
  const router = useRouter();
  const snack = useSnackbar();
  const { colors } = useTheme();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [history, setHistory] = useState<StatementRow[]>([]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [acct, setAcct] = useState<number | null>(null);
  const [rec, setRec] = useState<Reconciliation | null>(null);
  const [pick, setPick] = useState<Set<number>>(new Set());
  const [useBalance, setUseBalance] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ added: number; balanceSet: boolean; id: number } | null>(null);
  const [open, setOpen] = useState<StatementRow | null>(null);

  const refresh = useCallback(async () => { setAccounts((await getAccounts(db)).filter((a) => a.kind !== 'cash')); setHistory(await listStatements(db)); }, [db]);
  useEffect(() => { void refresh(); }, [refresh]);

  // compare whenever the statement or the account changes
  useEffect(() => {
    if (!loaded || acct == null) { setRec(null); return; }
    let live = true;
    void previewStatement(db, acct, loaded.st).then((r) => { if (!live) return; setRec(r); setPick(new Set(r.missing.map((m) => m.line.seq))); });
    return () => { live = false; };
  }, [db, loaded, acct]);

  const choose = async () => {
    setError(''); setDone(null);
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
      if (r.canceled || !r.assets?.[0]) return;
      const a = r.assets[0];
      if (/\.(xlsx?|pdf)$/i.test(a.name)) {
        setError(`${/\.pdf$/i.test(a.name) ? 'PDF' : 'Excel'} statements can't be opened yet. In your bank's website choose the CSV download instead.`);
        return;
      }
      const f = new File(a.uri);
      const text = utf8Decode(new Uint8Array(await f.bytes()));
      try { f.delete(); } catch { /* cache copy */ }
      const res = parseStatement(readCsv(text));
      if (!res.ok) { setError(res.reason); return; }
      const guess = guessAccount(accounts, res.statement.hint);
      setLoaded({ st: res.statement, name: a.name });
      setAcct(guess?.id ?? (accounts.length === 1 ? accounts[0].id : null));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open that file'); }
  };

  const toggle = (seq: number) => { tap(); setPick((p) => { const n = new Set(p); if (n.has(seq)) n.delete(seq); else n.add(seq); return n; }); };

  const apply = async () => {
    if (!loaded || acct == null || !rec) return;
    setBusy(true);
    try {
      const res = await applyStatement(db, acct, loaded.st, rec, { add: pick, useBalance });
      notifyIngested();
      setDone({ added: res.added, balanceSet: res.balanceSet, id: res.id });
      setLoaded(null); setRec(null); void refresh();
    } catch (e) { snack({ message: e instanceof Error ? e.message : 'Could not save the check' }); } finally { setBusy(false); }
  };

  const undo = async (id: number) => {
    const n = await undoStatement(db, id);
    notifyIngested(); setOpen(null); setDone(null); void refresh();
    snack({ message: n ? `Removed ${n} added ${n === 1 ? 'transaction' : 'transactions'}` : 'Check removed' });
  };

  const st = loaded?.st;
  const clean = rec && !rec.missing.length && !rec.differs.length && !rec.extra.length;
  const myAcct = accounts.find((a) => a.id === acct);
  const chainOk = !!st && st.chainBroken === 0;
  const total = useMemo(() => (rec ? rec.matched.length + rec.differs.length + rec.missing.length : 0), [rec]);

  return (
    <Page>
      <BackButton />
      <PageHeader title="Check a statement" subtitle="Compare your bank's statement with what ExMan recorded. The file is read on your phone and never uploaded." />
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!st && !done ? (
          <>
            <Button label="Choose statement file (CSV)" onPress={() => void choose()} />
            {error ? <Text className="mt-3 text-sm text-danger" accessibilityLiveRegion="polite">{error}</Text> : null}
            {history.length > 0 && (
              <View className="mt-5">
                <SectionLabel>Past checks</SectionLabel>
                {history.map((h) => (
                  <ListRow key={h.id} icon={h.added || h.differs || h.extra ? FileText : CheckCircle2} iconColor={h.added || h.differs || h.extra ? colors.accent : colors.income}
                    title={`${h.account ?? 'Account'} · ${period(h.from_day, h.to_day)}`}
                    subtitle={`${h.lines} lines · ${h.matched} matched${h.added ? ` · ${h.added} added` : ''}${h.differs ? ` · ${h.differs} differ` : ''}${h.extra ? ` · ${h.extra} only in ExMan` : ''}`}
                    onPress={() => setOpen(h)} />
                ))}
              </View>
            )}
            {!history.length && !error ? <EmptyState icon={<FileText size={44} color={colors.muted} />} title="Nothing checked yet" body="Download a statement as CSV from your bank's website or app, then choose it here." /> : null}
          </>
        ) : null}

        {done ? (
          <FadeIn>
            <Card>
              <View className="flex-row items-center"><CheckCircle2 size={22} color={colors.income} /><Text className="ml-2 text-base font-semibold text-fg">Statement checked</Text></View>
              <Text className="mt-2 text-sm text-muted">
                {done.added ? `${done.added} ${done.added === 1 ? 'transaction' : 'transactions'} added to Review.` : 'Nothing needed adding.'}
                {done.balanceSet ? ' The closing balance is now this account\'s balance.' : ''}
              </Text>
              <View className="mt-3 flex-row">
                {done.added > 0 ? <Button className="mr-3 flex-1" label="Open Review" onPress={() => router.replace('/review')} /> : null}
                <Button className="flex-1" variant="secondary" label="Undo" onPress={() => void undo(done.id)} />
              </View>
            </Card>
            <Button className="mt-3" variant="ghost" label="Check another" onPress={() => setDone(null)} />
          </FadeIn>
        ) : null}

        {st ? (
          <>
            <SectionLabel>Account</SectionLabel>
            <View className="mb-3 flex-row flex-wrap">
              {accounts.map((a) => <Chip key={a.id} label={a.name} selected={a.id === acct} onPress={() => setAcct(a.id)} />)}
            </View>
            {acct == null ? <Text className="mb-3 text-sm text-muted">Choose which account this statement is for.</Text> : null}

            {rec && st ? (
              <FadeIn>
                <Card className="mb-3">
                  <View className="flex-row items-center">
                    <Landmark size={18} color={colors.accent} />
                    <Text className="ml-2 flex-1 text-base font-semibold text-fg" numberOfLines={1}>{myAcct?.name ?? 'Account'} · {period(st.from, st.to)}</Text>
                  </View>
                  <Text className={`mt-2 text-sm ${clean ? 'text-income' : 'text-fg'}`}>
                    {clean ? `All ${total} lines are already in ExMan.` : `${rec.matched.length} of ${total} lines are in ExMan${rec.missing.length ? `, ${rec.missing.length} are not` : ''}.`}
                  </Text>
                  <View className="mt-3">
                    <Stats items={[
                      { label: 'Matched', value: String(rec.matched.length), tone: 'income' },
                      { label: 'Not in ExMan', value: String(rec.missing.length), tone: rec.missing.length ? 'danger' : 'fg' },
                      { label: 'Only in ExMan', value: String(rec.extra.length), tone: rec.extra.length ? 'danger' : 'fg' },
                    ]} />
                  </View>
                  {st.closingPaise != null ? (
                    <Text className="mt-3 text-xs text-muted">
                      Closing balance {rupees(st.closingPaise)}. {chainOk ? 'The statement\'s balances add up, so it was read correctly.' : `The balances don't add up in ${st.chainBroken} place${st.chainBroken === 1 ? '' : 's'}, so some lines may be misread.`}
                    </Text>
                  ) : null}
                  {st.warnings.filter((w) => !w.startsWith('The balances')).map((w) => <Text key={w} className="mt-1 text-xs text-muted">{w}</Text>)}
                </Card>

                {rec.missing.length > 0 && (
                  <>
                    <SectionLabel right={<Pressable accessibilityRole="button" onPress={() => setPick(pick.size === rec.missing.length ? new Set() : new Set(rec.missing.map((m) => m.line.seq)))}><Text className="text-sm font-semibold text-accent">{pick.size === rec.missing.length ? 'Clear' : 'Select all'}</Text></Pressable>}>On the statement, not in ExMan</SectionLabel>
                    {rec.missing.map((m) => <MissingRow key={m.line.seq} line={m.line} transfer={!!m.partner} on={pick.has(m.line.seq)} onPress={() => toggle(m.line.seq)} />)}
                  </>
                )}

                {rec.differs.length > 0 && (
                  <>
                    <SectionLabel>Different amount</SectionLabel>
                    {rec.differs.map((d) => (
                      <ListRow key={d.line.seq} title={d.txn.merchant ?? d.line.payee ?? 'Payment'} subtitle={`Statement ${rupees(d.line.paise)} · ExMan ${rupees(d.txn.amount_paise)} · ${dayLabel(d.line.day)}`} onPress={() => router.push(`/txn/${d.txn.id}`)} />
                    ))}
                  </>
                )}

                {rec.extra.length > 0 && (
                  <>
                    <SectionLabel>In ExMan, not on the statement</SectionLabel>
                    {rec.extra.map((t) => <ExtraRow key={t.id} t={t} onPress={() => router.push(`/txn/${t.id}`)} />)}
                    <Text className="mb-2 text-xs text-muted">These may be duplicates or amounts that were read wrongly. Open one to dismiss or fix it.</Text>
                  </>
                )}
                {rec.edge.length > 0 ? <Text className="mb-2 text-xs text-muted">{rec.edge.length} very recent {rec.edge.length === 1 ? 'transaction' : 'transactions'} may not have reached the bank's statement yet.</Text> : null}
              </FadeIn>
            ) : null}
            <View className="h-6" />
          </>
        ) : null}
      </ScrollView>

      {st && rec ? (
        <View className="border-t border-line pt-3">
          {st.closingPaise != null && chainOk ? (
            <View className="mb-3 flex-row"><Chip label={`Set balance to ${rupees(st.closingPaise)}`} selected={useBalance} onPress={() => setUseBalance(!useBalance)} /></View>
          ) : null}
          <View className="flex-row">
            <Button className="mr-3 flex-1" variant="secondary" label="Cancel" onPress={() => { setLoaded(null); setRec(null); }} />
            <Button className="flex-1" disabled={busy || acct == null} label={pick.size ? `Add ${pick.size} to Review` : 'Save check'} onPress={() => void apply()} />
          </View>
        </View>
      ) : null}

      {open ? (
        <Sheet title={`${open.account ?? 'Account'} · ${period(open.from_day, open.to_day)}`} onClose={() => setOpen(null)}
          footer={<Button variant="danger" label={open.pending ? `Undo (removes ${open.pending} waiting in Review)` : 'Remove this check'} onPress={() => void undo(open.id)} />}>
          <Text className="text-sm text-fg">{open.lines} lines on the statement, {open.matched} already in ExMan, {open.added} added.</Text>
          {open.closing_paise != null ? <Text className="mt-2 text-sm text-muted">Closing balance {rupees(open.closing_paise)}{open.balance_set ? ', used as the account balance' : ''}.</Text> : null}
          <Text className="mt-2 text-xs text-muted">Undo removes only what this check added and you haven't confirmed yet.</Text>
        </Sheet>
      ) : null}
    </Page>
  );
}

function MissingRow({ line, transfer, on, onPress }: { line: StmtLine; transfer: boolean; on: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const Box = on ? SquareCheck : Square;
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${line.payee ?? line.desc}, ${signed(line.direction, line.paise)}, ${dayLabel(line.day)}`}
      className="mb-2 min-h-[60px] flex-row items-center rounded-[22px] border border-line bg-card px-3 py-2.5">
      <Box size={22} color={on ? colors.accent : colors.muted} />
      <View className="ml-3 flex-1 pr-2">
        <Text className="text-base font-semibold text-fg" numberOfLines={1}>{line.payee ?? line.desc}</Text>
        <View className="mt-0.5 flex-row items-center">
          {transfer ? <ArrowLeftRight size={12} color={colors.muted} /> : null}
          <Text className="text-xs text-muted" numberOfLines={1}>{transfer ? ' Between your accounts · ' : ''}{dayLabel(line.day)}</Text>
        </View>
      </View>
      <Text className={`text-base font-bold ${line.direction === 'credit' ? 'text-income' : 'text-fg'}`} style={{ fontVariant: ['tabular-nums'] }}>{signed(line.direction, line.paise)}</Text>
    </Pressable>
  );
}

function ExtraRow({ t, onPress }: { t: ExTxn; onPress: () => void }) {
  return (
    <ListRow title={t.merchant ?? (t.raw_text ?? 'Payment').slice(0, 40)} subtitle={`${dayLabel(dayOfTs(t.ts))} · ${signed(t.direction, t.amount_paise)}`} onPress={onPress} />
  );
}
