import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { Text } from '@/ui/Text';

import { type LabReport, labReport } from '@/db/lab';
import { BackButton, Button, Card, PageHeader, SectionLabel, Skeleton, Stats } from '@/ui/kit';
import { Page } from '@/ui/insets';
import { maskedReport } from '@/utils/lab';

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');

/** Developer tool: how well ExMan reads this phone's messages and where it falls short. Everything is computed on the phone. */
export default function Lab() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [r, setR] = useState<LabReport | null>(null);
  useEffect(() => { void labReport(db).then(setR); }, [db]);

  const c = r?.category;
  return (
    <Page>
      <BackButton />
      <PageHeader title="Message lab" subtitle="Computed on this phone from your own messages. Nothing leaves it unless you share the masked report." />
      <ScrollView showsVerticalScrollIndicator={false}>
        {!r ? <Skeleton style={{ height: 120 }} /> : (
          <>
            <Card className="mb-4">
              <Text className="text-base font-semibold text-fg">Reading</Text>
              <Text className="mb-3 mt-1 text-sm text-muted">{pct(r.parsed, r.parsed + r.likelyMoney)} of money messages are understood.</Text>
              <Stats items={[
                { label: 'Understood', value: String(r.parsed) },
                { label: 'Look like money, not read', value: String(r.likelyMoney), tone: r.likelyMoney ? 'danger' : 'fg' },
                { label: 'Other kept', value: String(r.unrecognised - r.likelyMoney) },
              ]} />
              {r.groups.length > 0 ? <Text className="mt-3 text-sm text-muted">The 5 biggest unread formats make up {Math.round(r.top5Coverage * 100)}% of everything unread.</Text> : null}
            </Card>

            <Card className="mb-4">
              <Text className="text-base font-semibold text-fg">Categories learned from you</Text>
              {c && c.tested > 0 ? (
                <>
                  <Text className="mb-3 mt-1 text-sm text-muted">Tested on your newest {c.tested} confirmed transactions, after learning from the older {c.history - c.tested}.</Text>
                  <Stats items={[
                    { label: 'Learned: right', value: `${pct(c.correct, c.answered)} of ${c.answered}`, tone: 'income' },
                    { label: 'Keyword guess: right', value: `${pct(c.baselineCorrect, c.baselineAnswered)} of ${c.baselineAnswered}` },
                  ]} />
                </>
              ) : <Text className="mt-1 text-sm text-muted">Confirm a few more transactions in Review and ExMan will start learning your habits. {c?.history ?? 0} so far.</Text>}
            </Card>

            {r.corrections.length > 0 && (
              <Card className="mb-4">
                <Text className="text-base font-semibold text-fg">Corrections you made</Text>
                <Text className="mb-3 mt-1 text-sm text-muted">Fields you had to fix after ExMan read a message. A high count means the parser misreads that.</Text>
                <Stats items={r.corrections.map((x) => ({ label: x.field === 'amount_paise' ? 'Amount' : x.field === 'merchant' ? 'Merchant' : 'Direction', value: String(x.n) }))} />
              </Card>
            )}

            <SectionLabel>Biggest unread formats</SectionLabel>
            {r.groups.slice(0, 12).map((g) => (
              <Card key={g.template} className="mb-2">
                <Text className="text-xs font-semibold uppercase tracking-wider text-muted">{g.count}× · {g.senders.join(', ')} · {g.likelyTransaction ? 'looks like money' : 'probably not money'}</Text>
                <Text className="mt-1 text-sm text-fg" numberOfLines={4}>{g.template}</Text>
                {g.likelyTransaction ? <Button className="mt-3" variant="secondary" label="Teach this format" onPress={() => router.push(`/teach/${g.sampleId}`)} /> : null}
              </Card>
            ))}
            {r.groups.length === 0 && <Text className="mb-3 px-1 text-sm text-muted">Nothing unread.</Text>}

            {r.dismissed.length > 0 && (
              <>
                <View className="mt-3"><SectionLabel>Read, then dismissed by you</SectionLabel></View>
                <Text className="mb-2 px-1 text-sm text-muted">Formats you often throw away. If one is not really a transaction, the parser is too eager there.</Text>
                {r.dismissed.slice(0, 5).map((g) => (
                  <Card key={g.template} className="mb-2">
                    <Text className="text-xs font-semibold uppercase tracking-wider text-muted">{g.count}×</Text>
                    <Text className="mt-1 text-sm text-fg" numberOfLines={4}>{g.template}</Text>
                  </Card>
                ))}
              </>
            )}

            <Button className="mb-6 mt-4" variant="secondary" label="Share masked report" onPress={() => void Share.share({ message: maskedReport({ parsed: r.parsed, unrecognised: r.unrecognised, groups: r.groups }) })} />
          </>
        )}
      </ScrollView>
    </Page>
  );
}
