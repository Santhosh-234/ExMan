export type Scheme = 'light' | 'dark';

// WCAG AA text contrast on bg/surface in both schemes (muted >= 4.5:1, accent text >= 4.5:1).
export type Palette = {
  bg: string; surface: string; surface2: string; line: string; fg: string; muted: string; accent: string; onaccent: string; danger: string; warn: string; income: string;
};

export const PALETTES: Record<Scheme, Palette> = {
  // Calm and refined: warm paper and ink in light, deep blue-grey in dark, one teal accent. Text tokens stay >= 4.5:1.
  light: {
    bg: '#F6F5F1', surface: '#FFFFFF', surface2: '#EEECE6', line: '#E3E0D8',
    fg: '#15191F', muted: '#586070', accent: '#0F766E', onaccent: '#FFFFFF', danger: '#B3261E', warn: '#8A5300', income: '#14783A',
  },
  dark: {
    bg: '#0B0F14', surface: '#141A21', surface2: '#1D2530', line: '#232C37',
    fg: '#EEF1F5', muted: '#9AA5B4', accent: '#3CCBB5', onaccent: '#04211C', danger: '#F28B82', warn: '#E9B24E', income: '#4ADE80',
  },
};
