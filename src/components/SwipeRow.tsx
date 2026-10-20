import { type ReactNode, useRef } from 'react';
import { Animated, PanResponder, Text, View } from 'react-native';

const THRESHOLD = 90;

/** Swipe right = confirm, swipe left = dismiss. Snaps back if released early. */
export function SwipeRow({ children, onRight, onLeft }: { children: ReactNode; onRight: () => void; onLeft: () => void }) {
  const x = useRef(new Animated.Value(0)).current;
  const cb = useRef({ onRight, onLeft });
  cb.current = { onRight, onLeft };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderMove: Animated.event([null, { dx: x }], { useNativeDriver: false }),
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) > THRESHOLD) {
          Animated.timing(x, { toValue: g.dx > 0 ? 500 : -500, duration: 150, useNativeDriver: false }).start(() =>
            g.dx > 0 ? cb.current.onRight() : cb.current.onLeft(),
          );
        } else Animated.spring(x, { toValue: 0, useNativeDriver: false }).start();
      },
    }),
  ).current;

  return (
    <View className="mb-2 overflow-hidden rounded-2xl">
      <View className="absolute inset-0 flex-row items-center justify-between bg-card px-5">
        <Text className="font-semibold text-accent">Confirm</Text>
        <Text className="font-semibold text-red-400">Dismiss</Text>
      </View>
      <Animated.View style={{ transform: [{ translateX: x }] }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}
