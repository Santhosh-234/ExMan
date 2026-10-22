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


// --- glass look: text is drawn on translucent panes over a gradient, so check against every backdrop stop
import { GLASS_BACKDROP, GLASS_OVERRIDES, paletteFor } from './palettes';

type RGBA = [number, number, number, number];
const parse = (c: string): RGBA => {
  const m = c.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).concat(1) as RGBA;
};
const over = (top: RGBA, below: RGBA): RGBA => {
  const a = top[3] + below[3] * (1 - top[3]);
  return [0, 1, 2].map((i) => (top[i] * top[3] + below[i] * below[3] * (1 - top[3])) / a).concat(a) as RGBA;
};
const hex = ([r, g, b]: RGBA) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

for (const scheme of ['light', 'dark'] as const) {
  const p = paletteFor(scheme, true);
  test(`${scheme} glass: text meets AA on cards and chips over every backdrop stop`, () => {
    for (const stop of GLASS_BACKDROP[scheme].stops) {
      const card = over(parse(p.surface), parse(stop));
      const chip = over(parse(p.surface2), card);
      for (const bg of [parse(stop), card, chip])
        for (const fg of [p.fg, p.muted, p.accent, p.danger, p.warn, p.income])
          assert.ok(contrast(fg, hex(bg)) >= 4.5, `${scheme} glass ${fg} on ${hex(bg)} (stop ${stop}) = ${contrast(fg, hex(bg)).toFixed(2)}`);
      assert.ok(contrast(p.onaccent, p.accent) >= 4.5);
    }
  });
  test(`${scheme} glass: overlays that must hide content stay opaque`, () => {
    assert.equal(parse(p.solid)[3], 1);
    assert.ok(parse(p.sheet)[3] >= 0.94);
    assert.ok(parse(GLASS_OVERRIDES[scheme].sheet!)[3] >= 0.94);
  });
}
