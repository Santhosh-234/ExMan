import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { ChevronLeft, ChevronRight, Plus, type LucideIcon } from 'lucide-react-native';
import { type ReactNode, useEffect, useRef } from 'react';
import { Animated, KeyboardAvoidingView, Modal, Pressable, ScrollView, View, type ViewStyle } from 'react-native';
import { Text } from '@/ui/Text';

import { useSecurity } from '@/security/store';
import { Pressy } from '@/ui/anim';
import { useReducedMotion } from '@/ui/motion';
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
    <Pressy
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => { tap(); onPress(); }}
      className={className}
      innerClassName={`min-h-[52px] items-center justify-center rounded-[18px] px-5 py-3 ${bg} ${disabled ? 'opacity-40' : ''}`}>
      <Text className={`text-base font-semibold ${fg}`}>{label}</Text>
    </Pressy>
  );
}

/** Soft elevation: a hairline border always, and a faint shadow in the light theme (shadows read as dirt on dark surfaces). */
export function useElevation(level: 1 | 2 = 1): ViewStyle {
  const { scheme, glass } = useTheme();
  if (scheme === 'dark' || glass) return {}; // shadows show through translucent panes as dirt
  return { shadowColor: '#1B2430', shadowOpacity: level === 1 ? 0.05 : 0.1, shadowRadius: level === 1 ? 10 : 18, shadowOffset: { width: 0, height: level === 1 ? 3 : 8 }, elevation: level === 1 ? 1 : 3 };
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  const lift = useElevation(1);
  return <View className={`rounded-[26px] border border-line bg-card p-4 ${className}`} style={lift}>{children}</View>;
}

/** A card holding a list of rows separated by hairlines (Settings style). Pass the rows as children. */
export function Group({ children }: { children: ReactNode }) {
  const lift = useElevation(1);
  return <View className="mb-5 overflow-hidden rounded-[26px] border border-line bg-card" style={lift}>{children}</View>;
}

/** One tappable row in a Group: tinted icon, label, optional detail text, chevron. */
export function NavRow({ icon: Icon, label, detail, tone, first, onPress }: { icon: LucideIcon; label: string; detail?: string; tone?: 'warn'; first?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressy
      onPress={() => { tap(); onPress(); }}
      scaleTo={0.99}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      innerClassName={`min-h-[60px] flex-row items-center px-4 ${first ? '' : 'border-t border-line'}`}>
      <View className="mr-3 h-9 w-9 items-center justify-center rounded-full bg-card2"><Icon size={18} color={colors.accent} /></View>
      <Text className="flex-1 text-base text-fg">{label}</Text>
      {detail ? <Text className={`mr-1 text-sm ${tone === 'warn' ? 'text-warn' : 'text-muted'}`}>{detail}</Text> : null}
      <ChevronRight size={18} color={colors.muted} />
    </Pressy>
  );
}

/** Small caps label above a block of content. */
export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View className="mb-2 mt-1 flex-row items-center justify-between px-1">
      <Text className="text-xs font-semibold uppercase tracking-widest text-muted" accessibilityRole="header">{children}</Text>
      {right}
    </View>
  );
}

export function Chip({ label, color, selected, onPress }: { label: string; color?: string; selected?: boolean; onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress && (() => { tap(); onPress(); })}
      className={`mb-2 mr-2 min-h-9 flex-row items-center rounded-full px-3 py-1.5 ${selected ? '' : 'bg-card2'}`}
      style={selected ? { backgroundColor: color ?? colors.accent } : undefined}>
      {color && !selected ? <View className="mr-1.5 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} /> : null}
      <Text className={`text-sm ${selected ? 'font-semibold' : 'text-fg'}`} style={selected ? { color: color ? onColor(color) : colors.onaccent } : undefined}>{label}</Text>
    </Pressable>
  );
}

/** Signed amount in INR with Indian grouping; colour carries direction, sign carries it for screen readers. */
export function Amount({ paise, direction, className = 'text-lg', approx, muted }: { paise: number; direction?: 'debit' | 'credit'; className?: string; approx?: boolean; muted?: boolean }) {
  const { hide } = useSecurity();
  const sign = direction === 'debit' ? '-' : direction === 'credit' ? '+' : '';
  // colour always follows direction (green in, red out); transfers keep the hue but are dimmed so they still read as "not counted"
  const tone = direction === 'debit' ? 'text-danger' : direction === 'credit' ? 'text-income' : muted ? 'text-muted' : 'text-fg';
  return (
    <Text className={`font-semibold ${tone} ${muted && direction ? 'opacity-60' : ''} ${className}`} style={{ fontVariant: ['tabular-nums'] }} accessibilityLabel={`${direction === 'credit' ? 'received' : direction === 'debit' ? 'spent' : ''} ${hide ? 'amount hidden' : rupees(paise)}`}>
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
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(o, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(o, { toValue: 0.4, duration: 700, useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [o, reduced]);
  return <Animated.View accessibilityLabel="Loading" importantForAccessibility="no" className="rounded-2xl bg-card2" style={[{ opacity: o, height: 16 }, style]} />;
}

/** Bottom sheet. Tapping the scrim closes it. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  // The keyboard lifts the sheet (a Modal is its own window, so the app-level keyboard handling does not reach it), and tall content
  // scrolls inside it instead of running off the top.
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable className="flex-1 justify-end bg-black/60" onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
          <Pressable className="rounded-t-[28px] bg-sheet px-5 pb-6 pt-3" style={{ maxHeight: '90%' }} onPress={() => {}} accessible={false} accessibilityViewIsModal>
            <View className="mb-4 h-1 w-10 self-center rounded-full bg-line" importantForAccessibility="no" />
            <Text className="mb-3 text-lg font-semibold text-fg" accessibilityRole="header">{title}</Text>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false}>{children}</ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Round back button used at the top of every pushed screen. */
export function BackButton({ label = 'Back' }: { label?: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel={label} className="mb-3 h-10 w-10 items-center justify-center rounded-full border border-line bg-card">
      <ChevronLeft size={22} color={colors.fg} />
    </Pressable>
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
      style={{ elevation: 6, shadowColor: colors.accent, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }}>
      <Plus color={colors.onaccent} size={28} />
    </Pressable>
  );
}
