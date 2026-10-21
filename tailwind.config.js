/** @type {import('tailwindcss').Config} */
// Semantic colour tokens resolve to CSS variables set by ThemeProvider (src/ui/theme.tsx), so every
// screen follows light/dark with no per-component branching.
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        base: 'var(--c-bg)',
        card: 'var(--c-surface)',
        card2: 'var(--c-surface2)',
        line: 'var(--c-line)',
        fg: 'var(--c-fg)',
        muted: 'var(--c-muted)',
        accent: 'var(--c-accent)',
        onaccent: 'var(--c-onaccent)',
        danger: 'var(--c-danger)',
        warn: 'var(--c-warn)',
      },
    },
  },
  plugins: [],
};
