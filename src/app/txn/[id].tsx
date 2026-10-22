import { useSecurity } from '@/security/store';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Repeat } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/ui/Text';

import { type Account, type Category, type Txn, getAccounts, getCategories, getEditLog, getTxn, linkRefund, refundCandidates, unlinkRefund, updateTxn } from '@/db/queries';
import { isTransferMerchant, markTransferByUser, rejectTransfer, setTransferMerchant } from '@/db/transfers';
import { notifyIngested } from '@/ingest/events';
import { track } from '@/telemetry';
import { Amount, BackButton, Button, Card, Group, Sheet } from '@/ui/kit';
import { CategorySheet, EditSheet, type TxnPatch } from '@/ui/sheets';
import { useSnackbar } from '@/ui/Snackbar';
import { useRuleOffer } from '@/ui/useRuleOffer';
import { useTheme } from '@/ui/theme';
import { rupees } from '@/utils/format';
import { formatForeign } from '@/utils/currency';

const FIELD: Record<string, string> = { amount_paise: 'Amount', merchant: 'Merchant', category_id: 'Category', tags: 'Tags', notes: 'Notes', account_id: 'Account', is_transfer: 'Transfer', ts: 'Date', direction: 'Direction' };

export default function TxnDetail() {
  useSecurity(); // re-render when "hide amounts" changes
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const snack = useSnackbar();
  const offerRule = useRuleOffer();
  const { colors } = useTheme();
  const [t, setT] = useState<Txn | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [accts, setAccts] = useState<Account[]>([]);
  const [log, setLog] = useState<Awaited<ReturnType<typeof getEditLog>>>([]);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [linking, setLinking] = useState<Txn[] | null>(null);

  const load = useCallback(async () => {
    const n = Number(id);
    const [row, c, a, l] = await Promise.all([getTxn(db, n), getCategories(db), getAccounts(db), getEditLog(db, n)]);
    setT(row); setCats(c); setAccts(a); setLog(l);
  }, [db, id]);
  useEffect(() => void load(), [load]);

  if (!t) return <View className="flex-1 bg-base" />;
  const cat = cats.find((c) => c.id === t.category_id);
  const acct = accts.find((a) => a.id === t.account_id);
  const name = (field: string, v: string | null) => {
    if (v == null || v === '') return 'none';
    if (field === 'amount_paise') return rupees(Number(v));
    if (field === 'category_id') return cats.find((c) => c.id === Number(v))?.name ?? v;
    if (field === 'account_id') return accts.find((a) => a.id === Number(v))?.name ?? v;
    if (field === 'is_transfer') return v === '1' ? 'yes' : 'no';
    if (field === 'ts') return new Date(Number(v)).toLocaleString('en-IN');
    return v;
  };

  const patch = async (p: Parameters<typeof updateTxn>[2]) => {
    const catChanged = p.category_id != null && p.category_id !== t.category_id;
    await updateTxn(db, t.id, p);
    notifyIngested();
    load();
    if (catChanged) {
      await offerRule({ merchantId: t.merchant_id, merchantName: t.merchant, categoryId: p.category_id!, categoryName: cats.find((c) => c.id === p.category_id)?.name ?? 'this category' });
    }
  };
  const toggleTransfer = async () => {
    if (t.is_transfer) {
      // "not a transfer": clears both legs and teaches the detector not to flag them again
      const wasPair = t.transfer_pair_id;
      await updateTxn(db, t.id, { is_transfer: 0 });
      await rejectTransfer(db, t.id);
      track('feature_used', { feature: 'transfer_unmarked' });
      notifyIngested();
      load();
      snack({
        message: wasPair ? 'Unmarked, and its other leg too. They count in totals again.' : 'Unmarked as transfer. It counts in totals again.',
        onAction: async () => { await markTransferByUser(db, t.id); if (wasPair) await markTransferByUser(db, wasPair); notifyIngested(); load(); },
      });
    } else {
      await updateTxn(db, t.id, { is_transfer: 1 });
      await markTransferByUser(db, t.id);
      track('feature_used', { feature: 'transfer_marked' });
      notifyIngested();
      load();
      const undo = async () => { await updateTxn(db, t.id, { is_transfer: 0 }); await rejectTransfer(db, t.id); notifyIngested(); load(); };
      // offer to remember it for the merchant, so the next payment there is caught automatically
      if (t.merchant_id && t.merchant && !(await isTransferMerchant(db, t.merchant_id))) {
        snack({
          message: `Marked as transfer. Always treat ${t.merchant} as a transfer?`,
          actionLabel: 'Always',
          onAction: async () => {
            const { n, undo: undoRule } = await setTransferMerchant(db, t.merchant_id!, true);
            notifyIngested(); load();
            snack({ message: n > 1 ? `Rule saved · ${n} transactions marked as transfers` : 'Rule saved', onAction: () => void undoRule().then(() => { notifyIngested(); load(); }) });
          },
          secondLabel: 'Undo',
          onSecond: undo,
        });
      } else snack({ message: 'Marked as transfer (not counted as spending)', onAction: undo });
    }
  };
  const openLinker = async () => setLinking(await refundCandidates(db, t));
  const link = async (p: Txn) => {
    setLinking(null);
    await linkRefund(db, t.id, p);
    notifyIngested();
    load();
    snack({ message: `Linked to ${p.merchant ?? 'purchase'} · ${rupees(p.amount_paise)}. It now reduces that spending.`, onAction: async () => { await unlinkRefund(db, t.id); notifyIngested(); load(); } });
  };
  const unlink = async () => {
    const was = t.refund_of;
    await unlinkRefund(db, t.id);
    notifyIngested();
    load();
    snack({ message: 'Unlinked. It counts as income again.', onAction: async () => { if (was) { const p = await getTxn(db, was); if (p) await linkRefund(db, t.id, p); notifyIngested(); load(); } } });
  };
  const remove = async () => {
    const was = t.status;
    await updateTxn(db, t.id, { status: 'dismissed' });
    notifyIngested();
    snack({ message: 'Transaction deleted', onAction: () => { void updateTxn(db, t.id, { status: was }).then(() => notifyIngested()); } });
    router.back();
  };

  const Row = ({ k, v, first }: { k: string; v: string; first?: boolean }) => (
    <View className={`min-h-[48px] flex-row items-center justify-between px-4 py-2 ${first ? '' : 'border-t border-line'}`}>
      <Text className="text-sm text-muted">{k}</Text>
      <Text className="ml-4 flex-1 text-right text-base text-fg">{v}</Text>
    </View>
  );

  return (
    <View className="flex-1 bg-base px-4 pt-14">
      <BackButton />
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="mb-5 items-center">
          <View className="mb-3 mt-1 h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: cat?.color ?? colors.surface2 }}>
            <Text className="text-2xl font-bold" style={{ color: cat ? '#FFFFFF' : colors.muted }}>{(t.merchant ?? '?').trim()[0]?.toUpperCase() ?? '?'}</Text>
          </View>
          <Text className={`text-xs font-semibold uppercase tracking-widest ${t.direction === 'debit' ? 'text-danger' : 'text-income'}`}>{t.direction === 'debit' ? 'Spent' : 'Received'}</Text>
          <Amount paise={t.amount_paise} direction={t.direction} approx={!!t.currency} className="text-5xl" />
          <Text className="mt-2 text-xl font-semibold text-fg" accessibilityRole="header">{t.merchant ?? 'Unknown merchant'}</Text>
          {t.is_transfer ? (
            <View className="mt-2 flex-row items-center rounded-full bg-card2 px-3 py-1"><Repeat size={14} color={colors.muted} /><Text className="ml-1 text-xs text-muted">Transfer{t.transfer_reason ? ` · ${t.transfer_reason}` : ''}, not counted in totals</Text></View>
          ) : null}
        </View>

        <Group>
          {([
            t.currency && t.foreign_minor ? ['Original amount', `${formatForeign(t.foreign_minor, t.currency)} (≈ rupees, edit to match your statement)`] : null,
            ['Category', cat?.name ?? 'Uncategorised'],
            ['Account', acct?.name ?? t.bank ?? 'Unknown'],
            ['Date', new Date(t.ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })],
            ['Mode', t.payment_mode ?? (t.source === 'manual' ? 'Manual entry' : 'n/a')],
            ['Source', t.source],
            ['Status', t.status],
            t.tags ? ['Tags', t.tags.split(',').join(', ')] : null,
            t.notes ? ['Notes', t.notes] : null,
          ].filter(Boolean) as [string, string][]).map(([k, v], i) => <Row key={k} k={k} v={v} first={i === 0} />)}
          {t.refund_of ? (
            <Pressable onPress={() => router.push(`/txn/${t.refund_of}`)} accessibilityRole="button" className="min-h-[48px] flex-row items-center justify-between border-t border-line px-4">
              <Text className="text-sm text-muted">Refund of</Text><Text className="font-semibold text-accent">View purchase ›</Text>
            </Pressable>
          ) : null}
          {t.is_transfer && t.transfer_pair_id ? (
            <Pressable onPress={() => router.push(`/txn/${t.transfer_pair_id}`)} accessibilityRole="button" className="min-h-[48px] flex-row items-center justify-between border-t border-line px-4">
              <Text className="text-sm text-muted">Other leg</Text><Text className="font-semibold text-accent">View ›</Text>
            </Pressable>
          ) : null}
        </Group>

        <View className="mb-4 flex-row">
          <Button className="mr-3 flex-1" label="Edit" onPress={() => setEditing(true)} />
          <Button className="mr-3 flex-1" variant="secondary" label="Category" onPress={() => setPicking(true)} />
          <Button className="flex-1" variant="secondary" label={t.is_transfer ? 'Not transfer' : 'Transfer'} onPress={toggleTransfer} />
        </View>

        {t.direction === 'credit' && !t.is_transfer && (
          <View className="mb-4">
            {t.refund_of
              ? <Button variant="secondary" label="Unlink refund" onPress={unlink} />
              : <Button variant="secondary" label="This is a refund: link to purchase" onPress={openLinker} />}
          </View>
        )}

        {t.raw_text ? (
          <Card className="mb-4">
            <Pressable onPress={() => setShowRaw((v) => !v)} accessibilityRole="button">
              <Text className="text-base font-semibold text-fg">Original message {showRaw ? '▾' : '▸'}</Text>
            </Pressable>
            {showRaw && <Text className="mt-2 text-sm text-muted" selectable>{t.raw_text}</Text>}
          </Card>
        ) : null}

        {log.length > 0 && (
          <Card className="mb-4">
            <Text className="mb-2 text-base font-semibold text-fg">Edit history</Text>
            {log.map((l, i) => (
              <Text key={i} className="mb-1 text-sm text-muted">
                {new Date(l.ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {FIELD[l.field] ?? l.field}: {name(l.field, l.old_value)} → {name(l.field, l.new_value)}
              </Text>
            ))}
          </Card>
        )}

        <Button variant="danger" label="Delete" onPress={remove} className="mb-10" />
      </ScrollView>

      {linking && (
        <Sheet title="Which purchase was refunded?" onClose={() => setLinking(null)}>
          <Text className="mb-2 text-sm text-muted">A linked refund reduces that purchase's category instead of counting as income.</Text>
          {linking.length === 0 && <Text className="text-muted">No earlier purchases of at least this amount in the last 6 months.</Text>}
          {linking.slice(0, 8).map((p) => (
            <Pressable key={p.id} onPress={() => link(p)} accessibilityRole="button" className="min-h-14 flex-row items-center justify-between rounded-xl px-2">
              <View className="flex-1"><Text className="text-base text-fg" numberOfLines={1}>{p.merchant ?? 'Unknown'}</Text><Text className="text-xs text-muted">{new Date(p.ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text></View>
              <Text className="text-fg">{rupees(p.amount_paise)}</Text>
            </Pressable>
          ))}
        </Sheet>
      )}
      {picking && <CategorySheet cats={cats} value={t.category_id} onClose={() => setPicking(false)} onPick={(cid) => { setPicking(false); void patch({ category_id: cid }); }} />}
      {editing && <EditSheet txn={t} cats={cats} accounts={accts} onClose={() => setEditing(false)} onSave={(p: TxnPatch) => { setEditing(false); void patch(p); }} />}
    </View>
  );
}
