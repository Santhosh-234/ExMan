import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable } from 'react-native';
import { Text } from '@/ui/Text';

import { useReducedMotion } from './motion';
import { useInsets } from './insets';

type Snack = { message: string; actionLabel?: string; onAction?: () => void; secondLabel?: string; onSecond?: () => void };
const Ctx = createContext<(s: Snack) => void>(() => {});
export const useSnackbar = () => useContext(Ctx);

/** One global snackbar (undo for every commit action). A newer message replaces the older one. */
export function SnackbarProvider({ children }: { children: ReactNode }) {
  const insets = useInsets();
  const [snack, setSnack] = useState<Snack | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reduced = useReducedMotion();
  const dur = reduced ? 0 : 150;

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    Animated.timing(opacity, { toValue: 0, duration: dur, useNativeDriver: true }).start(() => setSnack(null));
  }, [opacity, dur]);

  const show = useCallback((s: Snack) => {
    clearTimeout(timer.current);
    setSnack(s);
    AccessibilityInfo.announceForAccessibility(s.message);
    Animated.timing(opacity, { toValue: 1, duration: dur, useNativeDriver: true }).start();
    timer.current = setTimeout(hide, s.onSecond ? 8000 : 5000);
  }, [hide, opacity, dur]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <Ctx.Provider value={show}>
      {children}
      {snack && (
        <Animated.View
          style={{ opacity, position: 'absolute', left: 16, right: 16, bottom: 80 + insets.bottom }}
          accessibilityLiveRegion="polite">
          {/* same dark pill in both themes so contrast is constant */}
          <Pressable
            onPress={hide}
            accessibilityRole="button"
            accessibilityLabel={`${snack.message}. Tap to dismiss`}
            style={{ backgroundColor: '#1F2937', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ color: '#F3F4F6', flex: 1, fontSize: 15 }}>{snack.message}</Text>
            {snack.onSecond && (
              <Pressable hitSlop={12} accessibilityRole="button" accessibilityLabel={snack.secondLabel ?? 'Undo'} onPress={() => { snack.onSecond?.(); hide(); }}>
                <Text style={{ color: '#9CA3AF', fontWeight: '600', marginLeft: 16 }}>{snack.secondLabel ?? 'Undo'}</Text>
              </Pressable>
            )}
            {snack.onAction && (
              <Pressable hitSlop={12} accessibilityRole="button" accessibilityLabel={snack.actionLabel ?? 'Undo'} onPress={() => { snack.onAction?.(); hide(); }}>
                <Text style={{ color: '#5EDCC8', fontWeight: '600', marginLeft: 16 }}>{snack.actionLabel ?? 'Undo'}</Text>
              </Pressable>
            )}
          </Pressable>
        </Animated.View>
      )}
    </Ctx.Provider>
  );
}
