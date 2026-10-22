import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, type PressableProps, type StyleProp, View, type ViewStyle } from 'react-native';

import { Text } from '@/ui/Text';
import { useReducedMotion } from '@/ui/motion';

/** A Pressable that gives a gentle scale on touch. */
export function Pressy({ children, scaleTo = 0.97, style, className, innerClassName, ...rest }: Omit<PressableProps, 'style'> & { children: ReactNode; scaleTo?: number; style?: StyleProp<ViewStyle>; className?: string; innerClassName?: string }) {
  const s = useRef(new Animated.Value(1)).current;
  const reduced = useReducedMotion();
  const to = (v: number) => { if (!reduced) Animated.spring(s, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 4 }).start(); };
  return (
    <Pressable {...rest} className={className} onPressIn={(e) => { to(scaleTo); rest.onPressIn?.(e); }} onPressOut={(e) => { to(1); rest.onPressOut?.(e); }}>
      <Animated.View className={innerClassName} style={[{ transform: [{ scale: s }] }, style]}>{children}</Animated.View>
    </Pressable>
  );
}

/** Content rises a few pixels and fades in; `index` staggers a list of blocks. Plays once per mount. */
export function FadeIn({ children, index = 0, style }: { children: ReactNode; index?: number; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) { v.setValue(1); return; }
    Animated.timing(v, { toValue: 1, duration: 320, delay: Math.min(index, 8) * 55, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [v, index, reduced]);
  return <Animated.View style={[{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }, style]}>{children}</Animated.View>;
}

/** Counts a number up to its value (or between values when it changes). Text is produced by `format`. */
export function CountUp({ value, format, className, accessibilityLabel }: { value: number; format: (n: number) => string; className?: string; accessibilityLabel?: string }) {
  const reduced = useReducedMotion();
  const from = useRef(0);
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) { setShown(value); return; }
    const a = new Animated.Value(0);
    const start = from.current;
    const id = a.addListener(({ value: t }) => setShown(start + (value - start) * t));
    Animated.timing(a, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(() => { from.current = value; setShown(value); });
    return () => { a.removeListener(id); from.current = value; };
  }, [value, reduced]);
  return <Text className={className} accessibilityLabel={accessibilityLabel ?? format(value)}>{format(Math.round(shown))}</Text>;
}

/** A horizontal bar whose fill animates to `pct` (0-1) when it changes. */
export function AnimatedBar({ pct, color, height = 10, track, className = '', marker }: { pct: number; color: string; height?: number; track?: string; className?: string; marker?: number }) {
  const reduced = useReducedMotion();
  const w = useRef(new Animated.Value(reduced ? pct : 0)).current;
  useEffect(() => {
    if (reduced) { w.setValue(pct); return; }
    Animated.timing(w, { toValue: pct, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [pct, w, reduced]);
  return (
    <View className={`overflow-hidden rounded-full ${track ?? 'bg-card2'} ${className}`} style={{ height }}>
      <Animated.View style={{ height, borderRadius: height, backgroundColor: color, width: w.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'], extrapolate: 'clamp' }) }} />
      {marker != null && marker > 0 && marker < 1 ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: `${marker * 100}%`, width: 2, backgroundColor: 'rgba(120,130,150,0.9)' }} /> : null}
    </View>
  );
}

/** Pops in with a spring (success checkmarks, empty states). */
export function PopIn({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const reduced = useReducedMotion();
  const s = useRef(new Animated.Value(reduced ? 1 : 0.6)).current;
  const o = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return;
    Animated.parallel([
      Animated.spring(s, { toValue: 1, delay, friction: 6, tension: 90, useNativeDriver: true }),
      Animated.timing(o, { toValue: 1, duration: 220, delay, useNativeDriver: true }),
    ]).start();
  }, [s, o, delay, reduced]);
  return <Animated.View style={{ opacity: o, transform: [{ scale: s }] }}>{children}</Animated.View>;
}
