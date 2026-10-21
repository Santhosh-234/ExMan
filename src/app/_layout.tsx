import '../global.css';
import { Stack, usePathname, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef } from 'react';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';

import { migrate } from '@/db/schema';
import { Ingest } from '@/ingest/Ingest';
import { LockGate } from '@/security/LockGate';
import { installErrorReporting, track } from '@/telemetry';
import { SnackbarProvider } from '@/ui/Snackbar';
import { ThemeProvider, useTheme } from '@/ui/theme';
import { screenOf } from '@/utils/screens';

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
  useEffect(() => installErrorReporting(() => screenOf(path.current)), []);
  // how long each screen takes to show after navigation (only the screen's name and the milliseconds are recorded)
  useEffect(() => {
    const t0 = Date.now();
    let f2 = 0;
    // two frames: the first lets the new screen render, the second is when it is first painted
    const f1 = requestAnimationFrame(() => { f2 = requestAnimationFrame(() => track('screen_load', { screen: screenOf(current), ms: Date.now() - t0 })); });
    return () => { cancelAnimationFrame(f1); cancelAnimationFrame(f2); };
  }, [current]);
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Ingest />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="review" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="welcome" options={{ gestureEnabled: false }} />
        <Stack.Screen name="add" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      </Stack>
      <LockGate />
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
