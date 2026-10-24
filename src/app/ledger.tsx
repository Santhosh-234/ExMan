import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { CheckCircle2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '@/ui/Text';

import { type AccountGap, type AccountHealth, ignoreGap, ledgerGaps, ledgerHealth, unignoreGap } from '@/db/ledger';
import { onIngested } from '@/ingest/events';
import { useSecurity } from '@/security/store';
import { FadeIn } from '@/ui/anim';
import { Page } from '@/ui/insets';
import { BackButton, Button, Card, EmptyState, PageHeader, SectionLabel, Skeleton } from '@/ui/kit';
import { useSnackbar } from '@/ui/Snackbar';
import { useTheme } from '@/ui/theme';
import { rupees } from '@/utils/format';

const when = (ts: number) => new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Books check: balances quoted in your messages must add up with the transactions ExMan has. Differences are money it never saw. */
export default function Ledger() {
  useSecurity();
  const db = useSQLiteContext();
  const router = useRouter();
  const snack = useSnackbar();
  const { colors } = useTheme();
  const [gaps, setGaps] = useState<AccountGap[] | null>(null);
  const [health, setHealth] = useState<AccountHealth[]>([]);

  const load = useCallback(async () => { const [g, h] = await Promise.all([ledgerGaps(db), ledgerHealth(db)]); setGaps(g); setHealth(h); }, [db]);
  useEffect(() => { void load(); return onIngested(() => void load()); }, [load]);

  const ignore = async (g: AccountGap) => {
    await ignoreGap(db, g.toId); void load();
    snack({ message: 'Ignored', onAction: () => void unignoreGap(db, g.toId).then(load) });
  };

  const checkable = health.filter((h) => h.checkable > 0.3);
  return (
    <Page>
      <BackButton />
      <PageHeader title="Books check" subtitle="Your bank messages quote the balance after each transaction. ExMan checks that they add up." />
      <ScrollView showsVerticalScrollIndicator={false}>
        {!gaps ? <Skeleton style={{ height: 96 }} /> : gaps.length === 0 ? (
          <EmptyState icon={<CheckCircle2 size={44} color={colors.income} />} title={checkable.length ? 'Everything adds up' : 'Not enough to check yet'} body={checkable.length ? `${checkable.length} account${checkable.length === 1 ? '' : 's'} match their balances.` : 'Once your bank messages include balances, ExMan can verify them.'} />
        ) : (
          <>
            <SectionLabel>{gaps.length} unexplained {gaps.length === 1 ? 'difference' : 'differences'}</SectionLabel>
            {gaps.map((g, i) => (
              <FadeIn key={g.toId} index={Math.min(i, 5)}>
                <Card className="mb-3">
                  <View className="flex-row items-center justify-between">
                    <Text className="flex-1 pr-2 text-sm font-semibold text-fg" numberOfLines={1}>{g.accountName}</Text>
                    <Text className={`text-lg font-bold ${g.amountPaise < 0 ? 'text-danger' : 'text-income'}`} style={{ fontVariant: ['tabular-nums'] }}>{g.amountPaise < 0 ? '−' : '+'}{rupees(Math.abs(g.amountPaise))}</Text>
                  </View>
                  <Text className="mt-1 text-sm text-muted">{g.amountPaise < 0 ? 'Left the account' : 'Arrived'} with no message, between {when(g.fromTs)} and {when(g.toTs)}.</Text>
                  <View className="mt-3 flex-row">
                    <Button className="mr-3 flex-1" label="Add it" onPress={() => router.push(`/add?amount=${Math.abs(g.amountPaise) / 100}&direction=${g.amountPaise < 0 ? 'debit' : 'credit'}&ts=${g.toTs - 1000}&account=${g.accountId}`)} />
                    <Button className="flex-1" variant="secondary" label="Ignore" onPress={() => void ignore(g)} />
                  </View>
                </Card>
              </FadeIn>
            ))}
          </>
        )}

        {health.length > 0 && (
          <View className="mt-3">
            <SectionLabel>Accounts</SectionLabel>
            {health.map((h) => (
              <Card key={h.id} className="mb-2">
                <View className="flex-row items-center justify-between">
                  <Text className="flex-1 pr-2 text-base font-semibold text-fg" numberOfLines={1}>{h.name}</Text>
                  {h.balance != null ? <Text className="text-base text-fg" style={{ fontVariant: ['tabular-nums'] }}>{rupees(h.balance)}</Text> : null}
                </View>
                <Text className={`mt-0.5 text-xs ${h.gaps ? 'text-danger' : h.checkable > 0.3 ? 'text-income' : 'text-muted'}`}>
                  {h.gaps ? `${h.gaps} to look at` : h.checkable > 0.3 ? 'Adds up' : 'Messages carry no balance, so it cannot be checked'}
                </Text>
              </Card>
            ))}
          </View>
        )}
        <View className="h-6" />
      </ScrollView>
    </Page>
  );
}
