export type Scheme = 'light' | 'dark';

// WCAG AA text contrast on bg/surface in both schemes (muted >= 4.5:1, accent text >= 4.5:1).
export const PALETTES = {
  light: {
    bg: '#F4F6F9', surface: '#FFFFFF', surface2: '#EAEDF2', line: '#DDE1E8',
    fg: '#0B1220', muted: '#566074', accent: '#047857', onaccent: '#FFFFFF', danger: '#B91C1C', warn: '#92400E',
  },
  dark: {
    bg: '#090D16', surface: '#111827', surface2: '#1F2937', line: '#1F2937',
    fg: '#F3F4F6', muted: '#9CA3AF', accent: '#10B981', onaccent: '#04251A', danger: '#F87171', warn: '#FBBF24',
  },
} as const;
export type Palette = (typeof PALETTES)[Scheme];


