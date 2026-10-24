import { useSecurity } from '@/security/store';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { CheckCheck, ChevronDown, ChevronUp, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '@/ui/Text';

import { type Category, type Txn, getAccountNames, getCategories, getTxns, topCategoryIds, updateTxn } from '@/db/queries';
import { AnimatedBar, PopIn } from '@/ui/anim';
import { Amount, BackButton, Button, Chip, EmptyState, Skeleton, success, tap, useElevation } from '@/ui/kit';
import { CategorySheet, EditSheet, type TxnPatch } from '@/ui/sheets';
import { useSnackbar } from '@/ui/Snackbar';
import { useRuleOffer } from '@/ui/useRuleOffer';
import { rejectTransfer } from '@/db/transfers';
import { track } from '@/telemetry';
import { useReducedMotion } from '@/ui/motion';
import { useTheme } from '@/ui/theme';
import { rupees } from '@/utils/format';
import { formatForeign } from '@/utils/currency';
import { describeRate } from '@/utils/fx';
import { Page } from '@/ui/insets';

const THRESHOLD = 110;

type CardProps = {
  txn: Txn;
  cats: Category[];
  quick: Category[];
  account: string | null;
  onConfirm: (via: 'swipe' | 'button') => void;
  onDismiss: (via: 'swipe' | 'button') => void;
  onEdit: () => void;
  onCategory: (id: number) => void;
  onMore: () => void;
  onNotTransfer: () => void;
  onNotKind: () => void;
};

/** Draggable card: right = confirm, left = dismiss. Buttons below do the same, so gestures are optional. */
function ReviewCard({ txn, cats, quick, account, onConfirm, onDismiss, onEdit, onCategory, onMore, onNotTransfer, onNotKind }: CardProps) {
  const { colors } = useTheme();
  const lift = useElevation(2);
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const x = useRef(new Animated.Value(0)).current;
  const [showRaw, setShowRaw] = useState(false);
  const cb = useRef({ onConfirm, onDismiss });
  cb.current = { onConfirm, onDismiss };
  const via = useRef<'swipe' | 'button'>('button');

  const fling = useCallback((dir: 1 | -1) => {
    Animated.timing(x, { toValue: dir * width, duration: reduced ? 0 : 160, useNativeDriver: true }).start(() => (dir > 0 ? cb.current.onConfirm(via.current) : cb.current.onDismiss(via.current)));
  }, [x, width, reduced]);
  const flingRef = useRef(fling);
  flingRef.current = fling;

  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderMove: Animated.event([null, { dx: x }], { useNativeDriver: false }),
    onPanResponderRelease: (_, g) => {
      if (g.dx > THRESHOLD) { via.current = 'swipe'; flingRef.current(1); }
      else if (g.dx < -THRESHOLD) { via.current = 'swipe'; flingRef.current(-1); }
      else Animated.spring(x, { toValue: 0, useNativeDriver: true }).start();
    },
  })).current;

  const rotate = x.interpolate({ inputRange: [-width, 0, width], outputRange: ['-8deg', '0deg', '8deg'] });
  const confirmOpacity = x.interpolate({ inputRange: [0, THRESHOLD], outputRange: [0, 1], extrapolate: 'clamp' });
  const dismissOpacity = x.interpolate({ inputRange: [-THRESHOLD, 0], outputRange: [1, 0], extrapolate: 'clamp' });
  const confirmTint = x.interpolate({ inputRange: [0, THRESHOLD], outputRange: [0, 0.16], extrapolate: 'clamp' });
  const dismissTint = x.interpolate({ inputRange: [-THRESHOLD, 0], outputRange: [0.16, 0], extrapolate: 'clamp' });
  const cat = cats.find((c) => c.id === txn.category_id);
  const when = new Date(txn.ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  return (
    <View>
      <Animated.View {...pan.panHandlers} style={[{ transform: [{ translateX: x }, { rotate }] }, lift]} className="overflow-hidden rounded-[32px] border border-line bg-card p-5">
        {/* swipe feedback: the card tints toward the action and a stamp appears */}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.accent, opacity: confirmTint }]} />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.danger, opacity: dismissTint }]} />
        <Animated.View style={{ opacity: confirmOpacity, borderColor: colors.accent }} className="absolute left-5 top-5 rounded-full border-2 px-3 py-1" pointerEvents="none"><Text className="text-sm font-bold tracking-widest text-accent">CONFIRM</Text></Animated.View>
        <Animated.View style={{ opacity: dismissOpacity, borderColor: colors.danger }} className="absolute right-5 top-5 rounded-full border-2 px-3 py-1" pointerEvents="none"><Text className="text-sm font-bold tracking-widest text-danger">DISMISS</Text></Animated.View>

        <View className="mt-4 items-center">
          <View className="mb-3 h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: cat?.color ?? colors.surface2 }}>
            <Text className="text-2xl font-bold" style={{ color: cat ? '#FFFFFF' : colors.muted }}>{(txn.merchant ?? '?').trim()[0]?.toUpperCase() ?? '?'}</Text>
          </View>
          <Text className={`text-xs font-semibold uppercase tracking-widest ${txn.direction === 'debit' ? 'text-danger' : 'text-income'}`}>{txn.direction === 'debit' ? 'Spent' : 'Received'}</Text>
          <Amount paise={txn.amount_paise} direction={txn.direction} approx={!!txn.currency} className="mt-1 text-5xl" />
          {txn.currency && txn.foreign_minor ? <Text className="mt-1 text-center text-sm text-muted">{formatForeign(txn.foreign_minor, txn.currency)} · {describeRate(txn.fx_source, txn.fx_rate, txn.currency)}</Text> : null}
          <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel="Edit merchant and amount" hitSlop={8}>
            <Text className="mt-2 text-xl font-semibold text-fg" accessibilityRole="header">{txn.merchant ?? 'Unknown merchant'}</Text>
          </Pressable>
          <Text className="mt-1 text-sm text-muted">
            {[account ?? txn.bank, txn.payment_mode, when].filter(Boolean).join(' · ')}
          </Text>
        </View>

        {txn.is_transfer ? (
          <View className="mt-4 rounded-2xl bg-card2 p-3">
            <Text className="text-sm text-fg">Looks like a transfer{txn.transfer_reason ? ` (${txn.transfer_reason})` : ''}. It won't count as spending or income.</Text>
            <Pressable onPress={onNotTransfer} accessibilityRole="button" className="mt-1 min-h-9 justify-center"><Text className="text-accent">Not a transfer</Text></Pressable>
          </View>
        ) : null}

        {txn.kind === 'investment' || txn.kind === 'loan' ? (
          <View className="mt-4 rounded-2xl bg-card2 p-3">
            <Text className="text-sm text-fg">{txn.kind === 'investment' ? 'Looks like an investment' : 'Looks like a loan payment'}. It won't count as spending or income.</Text>
            <Pressable onPress={onNotKind} accessibilityRole="button" className="mt-1 min-h-9 justify-center"><Text className="text-accent">{txn.kind === 'investment' ? 'Not an investment' : 'Not a loan'}</Text></Pressable>
          </View>
        ) : null}

        <Text className="mb-2 mt-6 text-xs font-semibold uppercase tracking-widest text-muted">Category</Text>
        <View className="flex-row flex-wrap">
          {quick.map((c) => <Chip key={c.id} label={c.name} color={c.color} selected={cat?.id === c.id} onPress={() => onCategory(c.id)} />)}
          {cat && !quick.some((q) => q.id === cat.id) && <Chip label={cat.name} color={cat.color} selected onPress={onMore} />}
          <Chip label="More…" onPress={onMore} />
        </View>

        {txn.raw_text ? (
          <Pressable onPress={() => setShowRaw((v) => !v)} className="mt-2 flex-row items-center" accessibilityRole="button">
            <Text className="text-sm text-muted">{showRaw ? 'Hide' : 'Show'} original message</Text>
            {showRaw ? <ChevronUp size={14} color={colors.muted} /> : <ChevronDown size={14} color={colors.muted} />}
          </Pressable>
        ) : null}
        {showRaw && <Text className="mt-2 rounded-2xl bg-card2 p-3 text-xs text-muted" selectable>{txn.raw_text}</Text>}
      </Animated.View>

      <View className="mt-6 flex-row">
        <Button className="mr-3 flex-1" variant="danger" label="Dismiss" onPress={() => fling(-1)} />
        <Button className="flex-1" label="Confirm" onPress={() => fling(1)} />
      </View>
    </View>
  );
}

export default function Review() {
  useSecurity(); // re-render when "hide amounts" changes
  const db = useSQLiteContext();
  const router = useRouter();
  const snack = useSnackbar();
  const offerRule = useRuleOffer();
  const [userCat, setUserCat] = useState<number | null>(null); // category the user chose on the current card
  const { colors } = useTheme();
  const [queue, setQueue] = useState<Txn[] | null>(null);
  const [total, setTotal] = useState(0);
  const [cats, setCats] = useState<Category[]>([]);
  const [quickIds, setQuickIds] = useState<number[]>([]);
  const [accounts, setAccounts] = useState<Map<number, string>>(new Map());
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    (async () => {
      const [c, q, a, t] = await Promise.all([getCategories(db), topCategoryIds(db), getAccountNames(db), getTxns(db, 'pending')]);
      setCats(c); setQuickIds(q); setAccounts(a); setQueue(t); setTotal(t.length);
    })();
  }, [db]);

  const quick = useMemo(() => {
    const byId = new Map(cats.map((c) => [c.id, c]));
    const ids = quickIds.length ? quickIds : cats.filter((c) => !c.archived).slice(0, 5).map((c) => c.id);
    return ids.map((i) => byId.get(i)).filter((c): c is Category => !!c && !c.archived);
  }, [cats, quickIds]);

  const head = queue?.[0];
  const patchHead = useCallback((p: TxnPatch) => {
    if (!head) return;
    if (p.category_id != null && p.category_id !== head.category_id) setUserCat(p.category_id);
    setQueue((q) => q && [{ ...q[0], ...p }, ...q.slice(1)]);
    void updateTxn(db, head.id, p);
  }, [db, head]);

  // commit = move the head out of the queue; Undo puts it back as pending at the front
  const commit = useCallback((status: 'confirmed' | 'dismissed', via: 'swipe' | 'button' = 'button') => {
    if (!head) return;
    track('review_action', { action: status === 'confirmed' ? 'confirm' : 'dismiss', via });
    const t = head;
    setQueue((q) => q && q.slice(1));
    void updateTxn(db, t.id, { status });
    status === 'confirmed' ? success() : tap();
    const undo = () => {
      track('review_action', { action: 'undo', via: 'button' });
      void updateTxn(db, t.id, { status: 'pending' });
      setQueue((q) => q && [t, ...q]);
    };
    const label = `${status === 'confirmed' ? 'Confirmed' : 'Dismissed'} ${rupees(t.amount_paise)}${t.merchant ? ` · ${t.merchant}` : ''}`;
    const chosen = userCat;
    setUserCat(null);
    const plain = () => snack({ message: label, onAction: undo });
    // the user picked a category on this card: offer to remember it for the merchant
    if (status === 'confirmed' && chosen && t.merchant_id) {
      const c = cats.find((x) => x.id === chosen);
      void offerRule({ merchantId: t.merchant_id, merchantName: t.merchant, categoryId: chosen, categoryName: c?.name ?? 'this category', prefix: label, undo })
        .then((shown) => !shown && plain());
    } else plain();
  }, [db, head, snack, userCat, cats, offerRule]);

  const confirmCategorised = async () => {
    const ids = (queue ?? []).filter((t) => t.category_id != null);
    if (!ids.length) return;
    await db.runAsync(`UPDATE transactions SET status = 'confirmed', synced_at = NULL WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids.map((t) => t.id));
    setQueue((q) => q && q.filter((t) => t.category_id == null));
    success();
    snack({
      message: `Confirmed ${ids.length} categorised`,
      onAction: async () => {
        await db.runAsync(`UPDATE transactions SET status = 'pending' WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids.map((t) => t.id));
        setQueue((q) => q && [...ids, ...q].sort((a, b) => b.ts - a.ts));
      },
    });
  };

  const done = total - (queue?.length ?? total);
  return (
    <Page>
      <View className="mb-4 flex-row items-center justify-between">
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close review" className="h-10 w-10 items-center justify-center rounded-full border border-line bg-card"><X size={20} color={colors.fg} /></Pressable>
        <Text className="text-base font-semibold text-fg" accessibilityRole="header">{queue && queue.length ? `${done + 1} of ${total}` : 'Review'}</Text>
        <Pressable onPress={confirmCategorised} hitSlop={12} accessibilityRole="button" accessibilityLabel="Confirm all categorised" className="h-10 w-10 items-center justify-center rounded-full border border-line bg-card"><CheckCheck size={20} color={colors.accent} /></Pressable>
      </View>
      {queue && total > 0 && (
        <AnimatedBar className="mb-5" pct={done / total} color={colors.accent} height={6} />
      )}

      {!queue ? (
        <View><Skeleton style={{ height: 280, borderRadius: 24 }} /></View>
      ) : head ? (
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <ReviewCard
            key={head.id}
            txn={head}
            cats={cats}
            quick={quick}
            account={head.account_id ? accounts.get(head.account_id) ?? null : null}
            onConfirm={(v) => commit('confirmed', v)}
            onDismiss={(v) => commit('dismissed', v)}
            onEdit={() => setEditing(true)}
            onCategory={(id) => patchHead({ category_id: id })}
            onMore={() => setPicking(true)}
            onNotKind={async () => {
              const t0 = head;
              await updateTxn(db, t0.id, { kind: 'normal' });
              setQueue((q) => q && [{ ...q[0], kind: 'normal' }, ...q.slice(1)]);
              snack({ message: 'Now a regular transaction.', onAction: async () => { await updateTxn(db, t0.id, { kind: t0.kind }); setQueue((q) => q && [{ ...q[0], kind: t0.kind }, ...q.slice(1)]); } });
            }}
            onNotTransfer={async () => {
              const t0 = head;
              await rejectTransfer(db, t0.id);
              track('feature_used', { feature: 'transfer_unmarked' });
              setQueue((q) => q && [{ ...q[0], is_transfer: 0, transfer_reason: null, transfer_pair_id: null }, ...q.slice(1)]);
              snack({ message: 'Unmarked. It counts in totals again.' });
            }}
          />
        </ScrollView>
      ) : (
        <EmptyState
          icon={<PopIn><View className="h-20 w-20 items-center justify-center rounded-full" style={{ backgroundColor: `${colors.accent}22` }}><CheckCheck size={40} color={colors.accent} /></View></PopIn>}
          title="All caught up"
          body={total ? `You reviewed ${total} transaction${total === 1 ? '' : 's'}.` : 'New transactions will show up here.'}
          action={<Button label="Back to Home" onPress={() => router.back()} />}
        />
      )}

      {picking && head && <CategorySheet cats={cats} value={head.category_id} onClose={() => setPicking(false)} onPick={(id) => { patchHead({ category_id: id }); setPicking(false); }} />}
      {editing && head && <EditSheet txn={head} cats={cats} onClose={() => setEditing(false)} onSave={(f) => { patchHead(f); setEditing(false); }} />}
    </Page>
  );
}
