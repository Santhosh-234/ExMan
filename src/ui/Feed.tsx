import { useRouter } from 'expo-router';
import { AlertTriangle, ArrowLeftRight, CalendarClock, Coins, CopyCheck, Gauge, LineChart, PiggyBank, Receipt, Repeat, ScanSearch, Sparkles, TrendingUp, X, type LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';
import { Text } from '@/ui/Text';
import { Pressable } from 'react-native';

import { FadeIn, Pressy } from '@/ui/anim';
import { useTheme } from '@/ui/theme';
import type { FeedItem } from '@/utils/feed';

const ICONS: Record<FeedItem['icon'], LucideIcon> = {
  ledger: ScanSearch, forecast: LineChart, bill: CalendarClock, unusual: AlertTriangle, duplicate: CopyCheck, budget: Gauge, subscription: Repeat,
  fees: Receipt, pace: TrendingUp, saving: PiggyBank, sip: ArrowLeftRight, value: Coins, runway: Sparkles,
};

/** The "For you" cards: a tinted icon says how urgent it is, the text says what, a tap opens where to act, the cross hides it for two weeks. */
export function FeedList({ items, limit, onDismiss }: { items: FeedItem[]; limit?: number; onDismiss: (id: string) => void }) {
  const router = useRouter();
  const { colors } = useTheme();
  const tone = { alert: colors.danger, watch: colors.warn, good: colors.income, info: colors.accent } as const;
  return (
    <>
      {items.slice(0, limit ?? items.length).map((it, i) => {
        const Icon = ICONS[it.icon];
        const c = tone[it.kind];
        return (
          <FadeIn key={it.id} index={Math.min(i, 4)}>
            <View className="mb-3">
              <Pressy onPress={() => router.push(it.route as never)} accessibilityRole="button" accessibilityLabel={`${it.title}${it.body ? `. ${it.body}` : ''}`}
                innerClassName="flex-row items-center rounded-[26px] border border-line bg-card p-4 pr-11">
                <View className="mr-3 h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: `${c}24` }}><Icon size={20} color={c} /></View>
                <View className="flex-1">
                  <Text className="text-base font-semibold text-fg">{it.title}</Text>
                  {it.body ? <Text className="mt-0.5 text-sm text-muted">{it.body}</Text> : null}
                </View>
              </Pressy>
              <Pressable onPress={() => onDismiss(it.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hide for two weeks" className="absolute right-3 top-3 h-8 w-8 items-center justify-center rounded-full">
                <X size={16} color={colors.muted} />
              </Pressable>
            </View>
          </FadeIn>
        );
      })}
    </>
  );
}
