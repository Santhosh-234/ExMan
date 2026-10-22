import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PALETTES } from './palettes';

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

for (const scheme of ['light', 'dark'] as const) {
  const p = PALETTES[scheme];
  test(`${scheme}: text tokens meet WCAG AA (4.5:1) on bg and surface`, () => {
    for (const bg of [p.bg, p.surface, p.surface2])
      for (const fg of [p.fg, p.muted, p.accent, p.danger, p.warn, p.income])
        assert.ok(contrast(fg, bg) >= 4.5, `${scheme} ${fg} on ${bg} = ${contrast(fg, bg).toFixed(2)}`);
  });
  test(`${scheme}: accent button text is readable`, () => {
    assert.ok(contrast(p.onaccent, p.accent) >= 4.5, `${contrast(p.onaccent, p.accent).toFixed(2)}`);
  });
}
