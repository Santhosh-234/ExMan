import { useSQLiteContext } from 'expo-sqlite';
import { vars } from 'nativewind';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, View, useColorScheme } from 'react-native';

import { GlassBackdrop } from './GlassBackdrop';
import { type Palette, type Scheme, paletteFor } from './palettes';

export type Mode = 'system' | 'light' | 'dark';

const toVars = (p: Palette) =>
  vars({
    '--c-bg': p.bg, '--c-surface': p.surface, '--c-surface2': p.surface2, '--c-line': p.line,
    '--c-fg': p.fg, '--c-muted': p.muted, '--c-accent': p.accent, '--c-onaccent': p.onaccent,
    '--c-danger': p.danger, '--c-warn': p.warn, '--c-income': p.income, '--c-solid': p.solid, '--c-sheet': p.sheet,
  });

type Ctx = { mode: Mode; scheme: Scheme; colors: Palette; glass: boolean; setMode: (m: Mode) => void; setGlass: (g: boolean) => void };
const ThemeContext = createContext<Ctx | null>(null);

export const useTheme = () => {
  const c = useContext(ThemeContext);
  if (!c) throw new Error('useTheme outside ThemeProvider');
  return c;
};

/** Persists the chosen mode in the settings table; 'system' follows the OS and updates live. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const system = useColorScheme();
  const [mode, setModeState] = useState<Mode>(() => {
    try {
      const v = db.getFirstSync<{ value: string }>("SELECT value FROM settings WHERE key = 'theme'")?.value;
      return v === 'light' || v === 'dark' ? v : 'system';
    } catch {
      return 'system';
    }
  });
  const [glass, setGlassState] = useState<boolean>(() => {
    try { return db.getFirstSync<{ value: string }>("SELECT value FROM settings WHERE key = 'glass'")?.value === '1'; } catch { return false; }
  });
  const scheme: Scheme = mode === 'system' ? (system === 'light' ? 'light' : 'dark') : mode;

  // keeps native chrome (dialogs, keyboard, status bar) in sync with the in-app choice
  useEffect(() => {
    Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  }, [mode]);

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    db.runAsync(
      "INSERT INTO settings (key, value) VALUES ('theme', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", m,
    ).catch(() => {});
  }, [db]);

  const setGlass = useCallback((g: boolean) => {
    setGlassState(g);
    db.runAsync("INSERT INTO settings (key, value) VALUES ('glass', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", g ? '1' : '0').catch(() => {});
  }, [db]);

  const colors = useMemo(() => paletteFor(scheme, glass), [scheme, glass]);
  const value = useMemo(() => ({ mode, scheme, colors, glass, setMode, setGlass }), [mode, scheme, colors, glass, setMode, setGlass]);
  return (
    <ThemeContext.Provider value={value}>
      <View style={[{ flex: 1, backgroundColor: colors.solid }, toVars(colors)]}>
        {glass ? <GlassBackdrop scheme={scheme} /> : null}
        {children}
      </View>
    </ThemeContext.Provider>
  );
}
