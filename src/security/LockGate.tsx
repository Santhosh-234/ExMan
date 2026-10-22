import * as LocalAuthentication from 'expo-local-authentication';
import { useSQLiteContext } from 'expo-sqlite';
import { Lock } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { Text } from '@/ui/Text';
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from 'expo-screen-capture';

import { Button } from '@/ui/kit';
import { useTheme } from '@/ui/theme';
import { shouldLockOnReturn } from './lock';
import { loadSecurity, useSecurity } from './store';

/**
 * Covers the app with an opaque screen until the user authenticates (biometrics, or the phone's PIN/pattern).
 * Also applies "block screenshots / hide in recent apps", which is always on while the lock is on, because
 * otherwise the recent-apps preview would show the data the lock is protecting.
 */
export function LockGate() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const sec = useSecurity();
  const [locked, setLocked] = useState(true); // closed until settings are read, so nothing flashes on launch
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const left = useRef<number | null>(null);

  useEffect(() => { void loadSecurity(db); }, [db]);

  const unlock = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setNote('');
    try {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock ExMan', cancelLabel: 'Cancel', disableDeviceFallback: false });
      if (r.success) setLocked(false);
      else setNote(r.error === 'user_cancel' || r.error === 'system_cancel' ? '' : 'Could not verify it is you. Try again.');
    } catch {
      setNote('Authentication is not available. Check your phone\'s screen lock settings.');
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // first read of settings: lock on launch only if the lock is enabled
  useEffect(() => {
    if (!sec.loaded) return;
    if (!sec.lock) setLocked(false);
    else void unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sec.loaded, sec.lock]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') left.current = Date.now();
      if (s === 'active') {
        if (shouldLockOnReturn(sec.lock, left.current, Date.now(), sec.timeoutMs)) { setLocked(true); void unlock(); }
        left.current = null;
      }
    });
    return () => sub.remove();
  }, [sec.lock, sec.timeoutMs, unlock]);

  useEffect(() => {
    if (!sec.loaded) return;
    if (sec.capture) void preventScreenCaptureAsync('exman');
    else void allowScreenCaptureAsync('exman');
  }, [sec.capture, sec.loaded]);

  if (!locked) return null;
  return (
    <View className="absolute inset-0 z-50 items-center justify-center bg-base px-8" accessibilityViewIsModal>
      <Lock size={48} color={colors.accent} />
      <Text className="mt-4 text-2xl font-bold text-fg" accessibilityRole="header">ExMan is locked</Text>
      <Text className="mt-1 text-center text-muted">Your money data is hidden until you unlock.</Text>
      {note ? <Text className="mt-3 text-center text-danger">{note}</Text> : null}
      <Button className="mt-6 self-stretch" label={busy ? 'Waiting…' : 'Unlock'} disabled={busy || !sec.loaded} onPress={unlock} />
    </View>
  );
}
