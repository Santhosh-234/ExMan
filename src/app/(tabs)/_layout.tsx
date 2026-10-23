import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { BarChart3, Home, ListOrdered, Settings } from 'lucide-react-native';

import { useInsets } from '@/ui/insets';
import { useTheme } from '@/ui/theme';

const tab = (title: string, Icon: typeof Home) => ({
  title,
  tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => <Icon color={color} size={size} />,
});

export default function TabsLayout() {
  const { colors } = useTheme();
  const { bottom } = useInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, borderTopWidth: 1, height: 60 + bottom, paddingTop: 6, paddingBottom: 6 + bottom, elevation: 0 },
        tabBarLabelStyle: { fontFamily: 'Manrope_600SemiBold', fontSize: 11, letterSpacing: 0.2 },
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen name="index" options={tab('Home', Home)} />
      <Tabs.Screen name="activity" options={tab('Activity', ListOrdered)} />
      <Tabs.Screen name="insights" options={tab('Insights', BarChart3)} />
      <Tabs.Screen name="settings" options={tab('Settings', Settings)} />
    </Tabs>
  );
}
