import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { onRaw } from '../../modules/vibe-listener';
import { ingest } from './run';

/** Mount once under SQLiteProvider: drains on launch, on foreground, and on live events. */
export function Ingest() {
  const db = useSQLiteContext();
  useEffect(() => {
    const run = () => void ingest(db).catch((e) => console.warn('ingest failed', e));
    run();
    const sub = onRaw(run);
    const app = AppState.addEventListener('change', (s) => s === 'active' && run());
    return () => {
      sub.remove();
      app.remove();
    };
  }, [db]);
  return null;
}
