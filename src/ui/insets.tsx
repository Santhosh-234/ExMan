import { type ReactNode } from 'react';
import { ScrollView, type ScrollViewProps, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * The app draws edge to edge, so the status bar, display cut-outs and the navigation bar (three buttons or the gesture pill) all sit on
 * top of our content. Their sizes differ per phone and per navigation mode, so nothing may assume a fixed number: read them here.
 */
export function useInsets() {
  const i = useSafeAreaInsets();
  return { top: i.top, bottom: i.bottom, left: i.left, right: i.right };
}

const GUTTER = 16;

/** Padding for a screen body: clears the status bar, and (unless the tab bar already does) the navigation bar. */
export function usePagePadding(tab = false): ViewStyle {
  const i = useInsets();
  return {
    paddingTop: i.top + 24,
    paddingBottom: tab ? 0 : Math.max(i.bottom, 12),
    paddingLeft: Math.max(i.left, GUTTER),
    paddingRight: Math.max(i.right, GUTTER),
  };
}

/** Full-screen container for pushed and tab screens. `tab` screens leave the bottom to the tab bar. */
export function Page({ tab, children, style }: { tab?: boolean; children: ReactNode; style?: ViewStyle }) {
  return <View className="flex-1 bg-base" style={[usePagePadding(tab), style]}>{children}</View>;
}

/** Scrolling screen body; content ends above the navigation bar, so a last button is never covered. */
export function PageScroll({ tab, contentContainerStyle, ...rest }: ScrollViewProps & { tab?: boolean }) {
  const p = usePagePadding(tab);
  return (
    <ScrollView
      className="flex-1 bg-base"
      showsVerticalScrollIndicator={false}
      {...rest}
      contentContainerStyle={[{ paddingTop: p.paddingTop, paddingBottom: (tab ? 24 : (p.paddingBottom as number) + 24), paddingLeft: p.paddingLeft, paddingRight: p.paddingRight }, contentContainerStyle]}
    />
  );
}

/** Pinned action bar at the bottom of a screen that is not wrapped in `Page` (the Add screen). */
export function useBarPadding(): ViewStyle {
  const i = useInsets();
  return { paddingBottom: Math.max(i.bottom, 12) + 4, paddingLeft: Math.max(i.left, GUTTER), paddingRight: Math.max(i.right, GUTTER) };
}
