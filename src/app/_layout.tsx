import '../global.css';
import { Stack, usePathname, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef } from 'react';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';

import { migrate } from '@/db/schema';
import { Ingest } from '@/ingest/Ingest';
import { installErrorReporting } from '@/telemetry';
import { SnackbarProvider } from '@/ui/Snackbar';
import { ThemeProvider, useTheme } from '@/ui/theme';

const SCREEN_OF: [RegExp, string][] = [[/^\/$/, 'home'], [/activity/, 'activity'], [/insights/, 'insights'], [/settings/, 'settings'], [/review/, 'review'], [/txn\//, 'detail'], [/add/, 'add'], [/account/, 'accounts'], [/merchants/, 'merchants'], [/rules/, 'rules'], [/categories/, 'categories'], [/unrecognised/, 'unrecognised'], [/teach/, 'teach'], [/privacy|telemetry/, 'privacy']];

function Shell() {
  const { scheme, colors } = useTheme();
  const db = useSQLiteContext();
  const router = useRouter();
  const path = useRef('/');
  const current = usePathname();
  path.current = current;
  // first run: show the walkthrough once (also where the usage-data notice is shown)
  useEffect(() => {
    void db.getFirstAsync("SELECT 1 FROM settings WHERE key = 'onboarded'").then((r) => { if (!r) router.replace('/welcome'); });
  }, [db, router]);
  // only the screen's name is reported with an error, never route params
  useEffect(() => installErrorReporting(() => SCREEN_OF.find(([re]) => re.test(path.current))?.[1] ?? 'unknown'), []);
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Ingest />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="review" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="welcome" options={{ gestureEnabled: false }} />
        <Stack.Screen name="add" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName="vibe.db" onInit={migrate}>
      <ThemeProvider>
        <SnackbarProvider>
          <Shell />
        </SnackbarProvider>
      </ThemeProvider>
    </SQLiteProvider>
  );
}
