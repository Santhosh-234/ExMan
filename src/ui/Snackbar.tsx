import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text } from 'react-native';

type Snack = { message: string; actionLabel?: string; onAction?: () => void };
const Ctx = createContext<(s: Snack) => void>(() => {});
export const useSnackbar = () => useContext(Ctx);

/** One global snackbar (undo for every commit action). A newer message replaces the older one. */
export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [snack, setSnack] = useState<Snack | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => setSnack(null));
  }, [opacity]);

  const show = useCallback((s: Snack) => {
    clearTimeout(timer.current);
    setSnack(s);
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    timer.current = setTimeout(hide, 5000);
  }, [hide, opacity]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <Ctx.Provider value={show}>
      {children}
      {snack && (
        <Animated.View
          style={{ opacity, position: 'absolute', left: 16, right: 16, bottom: 88 }}
          accessibilityLiveRegion="polite">
          {/* same dark pill in both themes so contrast is constant */}
          <Pressable
            onPress={hide}
            style={{ backgroundColor: '#1F2937', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ color: '#F3F4F6', flex: 1, fontSize: 15 }}>{snack.message}</Text>
            {snack.onAction && (
              <Pressable hitSlop={12} onPress={() => { snack.onAction?.(); hide(); }}>
                <Text style={{ color: '#34D399', fontWeight: '600', marginLeft: 16 }}>{snack.actionLabel ?? 'Undo'}</Text>
              </Pressable>
            )}
          </Pressable>
        </Animated.View>
      )}
    </Ctx.Provider>
  );
}
