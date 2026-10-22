export type Scheme = 'light' | 'dark';

// WCAG AA text contrast on bg/surface in both schemes (muted >= 4.5:1, accent text >= 4.5:1).
export type Palette = {
  bg: string; surface: string; surface2: string; line: string; fg: string; muted: string; accent: string; onaccent: string; danger: string; warn: string; income: string;
  /** opaque page colour even in the glass look (for overlays that must hide what is behind them) */
  solid: string;
  /** bottom sheets: the card colour, but nearly opaque in the glass look so text stays readable over busy content */
  sheet: string;
};

export const PALETTES: Record<Scheme, Palette> = {
  // Calm and refined: warm paper and ink in light, deep blue-grey in dark, one teal accent. Text tokens stay >= 4.5:1.
  light: {
    bg: '#F6F5F1', surface: '#FFFFFF', surface2: '#EEECE6', line: '#E3E0D8',
    fg: '#15191F', muted: '#586070', accent: '#0F766E', onaccent: '#FFFFFF', danger: '#B3261E', warn: '#8A5300', income: '#14783A',
    solid: '#F6F5F1', sheet: '#FFFFFF',
  },
  dark: {
    bg: '#0B0F14', surface: '#141A21', surface2: '#1D2530', line: '#232C37',
    fg: '#EEF1F5', muted: '#9AA5B4', accent: '#3CCBB5', onaccent: '#04211C', danger: '#F28B82', warn: '#E9B24E', income: '#4ADE80',
    solid: '#0B0F14', sheet: '#141A21',
  },
};

/**
 * "Glass" look: the page becomes a soft gradient backdrop and cards are translucent panes with a bright hairline edge. Text colours are the
 * solid palette's, so contrast is checked against the backdrop stops (palettes.test.ts). There is no real blur (that needs a native module),
 * so panes are kept fairly opaque to stay readable.
 */
export const GLASS_OVERRIDES: Record<Scheme, Partial<Palette>> = {
  light: { bg: 'rgba(0,0,0,0)', muted: '#4F586A', surface: 'rgba(255,255,255,0.68)', surface2: 'rgba(30,45,70,0.07)', line: 'rgba(255,255,255,0.85)', sheet: 'rgba(255,255,255,0.94)' },
  dark: { bg: 'rgba(0,0,0,0)', muted: '#B3BDCA', danger: '#FFA59E', warn: '#F2BE63', surface: 'rgba(255,255,255,0.07)', surface2: 'rgba(255,255,255,0.10)', line: 'rgba(255,255,255,0.16)', sheet: 'rgba(24,32,44,0.96)' },
};

/** Backdrop gradient stops (top-left, middle, bottom-right) and the glow colours drawn over them. */
export const GLASS_BACKDROP: Record<Scheme, { stops: [string, string, string]; glows: [string, string, string] }> = {
  light: { stops: ['#E2EEF6', '#EFE8F6', '#F7EDE0'], glows: ['#7FD6C8', '#9DB8F5', '#F5B7A6'] },
  dark: { stops: ['#08101A', '#0F1E2D', '#17102B'], glows: ['#1E8F86', '#3B4FA8', '#7B3FA0'] },
};

export const paletteFor = (scheme: Scheme, glass: boolean): Palette => (glass ? { ...PALETTES[scheme], ...GLASS_OVERRIDES[scheme] } : PALETTES[scheme]);
