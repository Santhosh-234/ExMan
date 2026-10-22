import { useSecurity } from '@/security/store';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Banknote, CreditCard, Landmark, Plus } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/ui/Text';

import { type Account, type AccountStats, addAccount, getAccountStats } from '@/db/queries';
import { onIngested } from '@/ingest/events';
import { Button, Card, Chip, EmptyState, Sheet, BackButton } from '@/ui/kit';
import { useTheme } from '@/ui/theme';
import { monthKey, monthLabel, monthRange, rupees } from '@/utils/format';

export const asOf = (ts: number | null) => (ts ? new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');

const ICON = { bank: Landmark, card: CreditCard, cash: Banknote } as const;

export function AccountCard({ a, onPress }: { a: AccountStats; onPress: () => void }) {
  const { colors } = useTheme();
  const Icon = ICON[a.kind];
  const sub = [a.bank, a.last4 ? `…${a.last4}` : null].filter(Boolean).join(' ');
  return (
    <Pressable onPress={onPress} accessibilityRole="button" className={`mb-3 rounded-[26px] border border-line bg-card p-4 ${a.archived ? 'opacity-50' : ''}`}>
      <View className="flex-row items-center">
        <View className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-card2"><Icon size={20} color={colors.accent} /></View>
        <View className="flex-1">
          <Text className="text-base font-semibold text-fg">{a.name}{a.archived ? ' (archived)' : ''}</Text>
          {sub ? <Text className="text-xs text-muted">{sub}</Text> : null}
        </View>
        {a.balance_paise != null && (
          <View className="items-end">
            <Text className="text-base font-semibold text-fg">{rupees(a.balance_paise)}</Text>
            <Text className="text-xs text-muted">{a.balance_kind === 'limit' ? 'available limit' : 'balance'} · {asOf(a.balance_ts)}</Text>
          </View>
        )}
      </View>
      <View className="mt-3 flex-row border-t border-line pt-3">
        <View className="flex-1"><Text className="text-xs text-muted">Spent</Text><Text className="text-fg">{rupees(a.spent)}</Text></View>
        <View className="flex-1"><Text className="text-xs text-muted">Received</Text><Text className="text-accent">{rupees(a.received)}</Text></View>
        <View className="flex-1 items-end"><Text className="text-xs text-muted">Transactions</Text><Text className="text-fg">{a.n}</Text></View>
      </View>
    </Pressable>
  );
}

export default function Accounts() {
  useSecurity(); // re-render when "hide amounts" changes
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useTheme();
  const month = monthKey(new Date());
  const [accts, setAccts] = useState<AccountStats[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Account['kind']>('bank');
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => setAccts(await getAccountStats(db, ...monthRange(month))), [db, month]);
  useFocusEffect(useCallback(() => void load(), [load]));
  useEffect(() => onIngested(() => void load()), [load]);

  const active = (accts ?? []).filter((a) => !a.archived);
  const archived = (accts ?? []).filter((a) => a.archived);
  // sum of the latest known bank balances; each card shows its own "as of" date, so this is only indicative
  const banks = active.filter((a) => a.kind === 'bank' && a.balance_paise != null);
  const total = banks.reduce((s, a) => s + (a.balance_paise ?? 0), 0);
  const group = (title: string, list: AccountStats[]) =>
    list.length === 0 ? null : (
      <View key={title}>
        <Text className="mb-2 mt-2 text-xs uppercase tracking-wider text-muted">{title}</Text>
        {list.map((a) => <AccountCard key={a.id} a={a} onPress={() => router.push(`/account/${a.id}`)} />)}
      </View>
    );

  return (
    <View className="flex-1 bg-base px-4 pt-14">
      <BackButton />
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-3xl font-bold text-fg" accessibilityRole="header">Accounts</Text>
        <Pressable onPress={() => setAdding(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Add account"><Plus color={colors.accent} /></Pressable>
      </View>
      <Text className="mb-3 text-xs text-muted">Activity shown for {monthLabel(month)}. Accounts are created automatically from your bank messages.</Text>

      <ScrollView showsVerticalScrollIndicator={false}>
        {banks.length > 0 && (
          <Card className="mb-3">
            <Text className="text-xs text-muted">Latest known bank balances</Text>
            <Text className="text-3xl font-bold text-fg">{rupees(total)}</Text>
            <Text className="text-xs text-muted">From the most recent SMS of each account, so it can be out of date.</Text>
          </Card>
        )}
        {accts && accts.length === 0 && <EmptyState title="No accounts yet" body="They appear once bank messages arrive. You can also add a cash wallet or card by hand." />}
        {group('Bank accounts', active.filter((a) => a.kind === 'bank'))}
        {group('Cards', active.filter((a) => a.kind === 'card'))}
        {group('Cash', active.filter((a) => a.kind === 'cash'))}
        {archived.length > 0 && (
          <>
            <Pressable onPress={() => setShowArchived((v) => !v)} className="mb-2 mt-2" accessibilityRole="button">
              <Text className="text-accent">{showArchived ? 'Hide' : 'Show'} archived ({archived.length})</Text>
            </Pressable>
            {showArchived && archived.map((a) => <AccountCard key={a.id} a={a} onPress={() => router.push(`/account/${a.id}`)} />)}
          </>
        )}
        <View className="h-10" />
      </ScrollView>

      {adding && (
        <Sheet title="Add account" onClose={() => setAdding(false)}>
          <TextInput className="mb-3 min-h-12 rounded-2xl bg-card2 px-4 py-3 text-base text-fg" value={name} onChangeText={setName} placeholder="Name, e.g. Wallet" placeholderTextColor={colors.muted} autoFocus />
          <View className="mb-3 flex-row">
            {([['bank', 'Bank'], ['card', 'Card'], ['cash', 'Cash']] as const).map(([k, l]) => <Chip key={k} label={l} color={colors.accent} selected={kind === k} onPress={() => setKind(k)} />)}
          </View>
          <Button label="Add" disabled={!name.trim()} onPress={async () => { await addAccount(db, name.trim(), kind); setName(''); setAdding(false); load(); }} />
        </Sheet>
      )}
    </View>
  );
}
