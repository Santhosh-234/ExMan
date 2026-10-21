import '../global.css';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';

import { migrate } from '@/db/schema';
import { Ingest } from '@/ingest/Ingest';
import { SnackbarProvider } from '@/ui/Snackbar';
import { ThemeProvider, useTheme } from '@/ui/theme';

function Shell() {
  const { scheme, colors } = useTheme();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Ingest />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="review" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
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
