import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

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
