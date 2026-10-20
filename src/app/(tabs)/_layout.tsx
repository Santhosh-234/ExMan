import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { BarChart3, Inbox, LayoutDashboard, Settings } from 'lucide-react-native';

const tab = (title: string, Icon: typeof Inbox) => ({
  title,
  tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => <Icon color={color} size={size} />,
});

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#10B981',
        tabBarInactiveTintColor: '#6B7280',
        tabBarStyle: { backgroundColor: '#090D16', borderTopColor: '#1F2937' },
      }}>
      <Tabs.Screen name="index" options={tab('Dashboard', LayoutDashboard)} />
      <Tabs.Screen name="inbox" options={tab('Inbox', Inbox)} />
      <Tabs.Screen name="analytics" options={tab('Analytics', BarChart3)} />
      <Tabs.Screen name="settings" options={tab('Settings', Settings)} />
    </Tabs>
  );
}
