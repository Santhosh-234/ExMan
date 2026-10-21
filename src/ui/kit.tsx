import * as Haptics from 'expo-haptics';
import { Plus } from 'lucide-react-native';
import { type ReactNode, useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, Text, View, type ViewStyle } from 'react-native';

import { useSecurity } from '@/security/store';
import { useTheme } from '@/ui/theme';
import { rupees } from '@/utils/format';

/** Black or white text, whichever reads better on a given hex background. */
export const onColor = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111827' : '#FFFFFF';
};

export const tap = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
export const success = () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

type BtnProps = { label: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; disabled?: boolean; className?: string };
const BTN = {
  primary: ['bg-accent', 'text-onaccent'],
  secondary: ['bg-card2', 'text-fg'],
  ghost: ['', 'text-accent'],
  danger: ['bg-card2', 'text-danger'],
} as const;

export function Button({ label, onPress, variant = 'primary', disabled, className = '' }: BtnProps) {
  const [bg, fg] = BTN[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => { tap(); onPress(); }}
      className={`min-h-12 items-center justify-center rounded-2xl px-5 py-3 ${bg} ${disabled ? 'opacity-40' : ''} ${className}`}>
      <Text className={`text-base font-semibold ${fg}`}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <View className={`rounded-3xl bg-card p-4 ${className}`}>{children}</View>;
}

export function Chip({ label, color, selected, onPress }: { label: string; color?: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress && (() => { tap(); onPress(); })}
      className={`mb-2 mr-2 min-h-9 flex-row items-center rounded-full px-3 py-1.5 ${selected ? '' : 'bg-card2'}`}
      style={selected ? { backgroundColor: color ?? '#10B981' } : undefined}>
      {color && !selected ? <View className="mr-1.5 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} /> : null}
      <Text className={`text-sm ${selected ? 'font-semibold' : 'text-fg'}`} style={selected ? { color: onColor(color ?? '#10B981') } : undefined}>{label}</Text>
    </Pressable>
  );
}

/** Signed amount in INR with Indian grouping; colour carries direction, sign carries it for screen readers. */
export function Amount({ paise, direction, className = 'text-lg', approx, muted }: { paise: number; direction?: 'debit' | 'credit'; className?: string; approx?: boolean; muted?: boolean }) {
  const { hide } = useSecurity();
  const sign = direction === 'debit' ? '-' : direction === 'credit' ? '+' : '';
  const tone = muted ? 'text-muted' : direction === 'debit' ? 'text-danger' : direction === 'credit' ? 'text-accent' : 'text-fg';
  return (
    <Text className={`font-semibold ${tone} ${className}`} accessibilityLabel={`${direction === 'credit' ? 'received' : direction === 'debit' ? 'spent' : ''} ${hide ? 'amount hidden' : rupees(paise)}`}>
      {approx ? '≈' : ''}{sign}{rupees(paise)}
    </Text>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <View className="items-center px-6 py-12">
      {icon}
      <Text className="mt-4 text-center text-lg font-semibold text-fg">{title}</Text>
      {body ? <Text className="mt-1 text-center text-muted">{body}</Text> : null}
      {action ? <View className="mt-5">{action}</View> : null}
    </View>
  );
}

export function Skeleton({ style }: { style?: ViewStyle }) {
  const o = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(o, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(o, { toValue: 0.4, duration: 700, useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [o]);
  return <Animated.View className="rounded-2xl bg-card2" style={[{ opacity: o, height: 16 }, style]} />;
}

/** Bottom sheet. Tapping the scrim closes it. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable className="flex-1 justify-end bg-black/60" onPress={onClose} accessibilityLabel="Close">
        <Pressable className="rounded-t-3xl bg-card p-5 pb-8" onPress={() => {}}>
          <Text className="mb-3 text-lg font-semibold text-fg">{title}</Text>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function Screen({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <View className="flex-1 bg-base px-4 pt-14">
      <View className="mb-4 flex-row items-center justify-between">
        <Text className="text-3xl font-bold text-fg" accessibilityRole="header">{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

/** Floating action button, sits above the tab bar. */
export function Fab({ onPress, label = 'Add transaction' }: { onPress: () => void; label?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => { tap(); onPress(); }}
      className="absolute bottom-5 right-5 h-14 w-14 items-center justify-center rounded-full bg-accent"
      style={{ elevation: 6, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } }}>
      <Plus color={colors.onaccent} size={28} />
    </Pressable>
  );
}
