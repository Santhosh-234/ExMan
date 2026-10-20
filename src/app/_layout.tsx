import '../global.css';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';

import { migrate } from '@/db/schema';
import { Ingest } from '@/ingest/Ingest';

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName="vibe.db" onInit={migrate}>
      <StatusBar style="light" />
      <Ingest />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#090D16' } }} />
    </SQLiteProvider>
  );
}
