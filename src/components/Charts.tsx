import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { useReducedMotion } from '@/ui/motion';
import { Text } from '@/ui/Text';
import { useTheme } from '@/ui/theme';
import { rupees } from '@/utils/format';

/**
 * Touch and drag to pick a point on a chart. A touch picks where it lands, dragging sideways keeps picking as the finger moves (with a light
 * tick at each new point), and a vertical swipe is left to the page so it still scrolls. Screen readers get increment/decrement instead.
 */
function useScrub(indexAt: (x: number) => number, count: number, current: number, onSelect?: (i: number) => void) {
  const live = useRef({ indexAt, onSelect, count, last: -1, startX: 0, drag: false });
  live.current.indexAt = indexAt; live.current.onSelect = onSelect; live.current.count = count;
  const pick = (x: number) => {
    const r = live.current;
    const i = Math.max(0, Math.min(r.count - 1, r.indexAt(x)));
    if (i === r.last || !r.onSelect) return;
    r.last = i; r.onSelect(i);
    void Haptics.selectionAsync().catch(() => {});
  };
  // Dragging only starts once the finger has clearly moved sideways. A touch that starts a vertical swipe belongs to the page, so a chart in
  // the middle of a scrolling screen never gets in its way; a plain tap is handled separately (see `tap`).
  const horizontal = (g: { dx: number; dy: number }) => !!live.current.onSelect && Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5;
  const handlers = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_e, g) => horizontal(g),
    onMoveShouldSetPanResponderCapture: (_e, g) => horizontal(g),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e, g) => { const r = live.current; r.drag = true; r.last = -1; r.startX = e.nativeEvent.locationX - g.dx; pick(r.startX + g.dx); },
    onPanResponderMove: (_e, g) => { pick(live.current.startX + g.dx); },
    onPanResponderRelease: () => { live.current.drag = false; },
    onPanResponderTerminate: () => { live.current.drag = false; },
  }).panHandlers, []);
  const tap = (x: number) => { live.current.last = -1; pick(x); };
  const a11y = onSelect ? {
    accessibilityActions: [{ name: 'increment' as const }, { name: 'decrement' as const }],
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => onSelect(Math.max(0, Math.min(count - 1, current + (e.nativeEvent.actionName === 'increment' ? 1 : -1)))),
  } : {};
  return { handlers, a11y, tap };
}

export type Slice = { label: string; value: number; color: string };

/** 0 -> 1 over `ms`, restarting whenever `key` changes; jumps straight to 1 when the phone asks for reduced motion. */
function useGrow(key: unknown, ms = 700) {
  const reduced = useReducedMotion();
  const [p, setP] = useState(reduced ? 1 : 0);
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) { setP(1); return; }
    v.setValue(0);
    const id = v.addListener(({ value }) => setP(value));
    Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    return () => v.removeListener(id);
  }, [key, v, ms, reduced]);
  return p;
}

/** Which slice a touch landed on (by angle), or null when it landed off the ring. Slices run clockwise from 12 o'clock. */
export function sliceAt(data: Slice[], size: number, stroke: number, x: number, y: number): string | null {
  const total = data.reduce((a, d) => a + d.value, 0);
  if (total <= 0) return null;
  const r = size / 2 - stroke / 2 - 2;
  const dx = x - size / 2, dy = y - size / 2;
  const dist = Math.hypot(dx, dy);
  if (dist < r - stroke / 2 - 12 || dist > r + stroke / 2 + 12) return null;
  let ang = Math.atan2(dy, dx) + Math.PI / 2;
  if (ang < 0) ang += 2 * Math.PI;
  const f = ang / (2 * Math.PI);
  let acc = 0;
  for (const d of data) { acc += d.value / total; if (f <= acc + 1e-9) return d.label; }
  return data[data.length - 1]?.label ?? null;
}

/** Donut chart that sweeps in. Tap a slice to select it (its name and amount move to the centre); tap the middle or empty space to clear. */
export function Pie({ data, size = 190, label = 'Spending by category', center, selected, onSelect }: { data: Slice[]; size?: number; label?: string; center?: { title: string; value: string }; selected?: string | null; onSelect?: (label: string | null) => void }) {
  const { colors } = useTheme();
  const total = data.reduce((a, d) => a + d.value, 0);
  const grow = useGrow(data.map((d) => `${d.label}:${d.value}`).join('|'));
  const stroke = 22;
  const r = size / 2 - stroke / 2 - 2;
  const c = 2 * Math.PI * r;
  const gap = data.length > 1 ? 3 : 0; // small gaps between slices
  const sel = selected ? data.find((d) => d.label === selected) : undefined;
  let offset = 0;
  const summary = `${label}: ${data.map((d) => `${d.label} ${rupees(d.value)}`).join(', ') || 'no data'}`;
  const shownCenter = sel ? { title: sel.label, value: rupees(sel.value) } : center;
  const svg = (
    <Svg width={size} height={size} accessible accessibilityLabel={summary}>
      <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surface2} strokeWidth={stroke} fill="none" />
        {total > 0 && data.map((d) => {
          const len = (d.value / total) * c * grow;
          const on = !sel || sel.label === d.label;
          const el = (
            <Circle key={d.label} cx={size / 2} cy={size / 2} r={r} stroke={d.color} strokeWidth={sel?.label === d.label ? stroke + 8 : stroke} fill="none" opacity={on ? 1 : 0.35}
              strokeDasharray={`${Math.max(0, len - gap)} ${c - Math.max(0, len - gap)}`} strokeDashoffset={-offset} />
          );
          offset += len;
          return el;
        })}
      </G>
      {shownCenter ? (
        <>
          <SvgText x={size / 2} y={size / 2 - 4} fill={colors.muted} fontSize={12} fontFamily="Manrope_600SemiBold" textAnchor="middle">{shownCenter.title.length > 16 ? `${shownCenter.title.slice(0, 15)}…` : shownCenter.title}</SvgText>
          <SvgText x={size / 2} y={size / 2 + 20} fill={colors.fg} fontSize={22} fontFamily="Manrope_700Bold" textAnchor="middle">{shownCenter.value}</SvgText>
        </>
      ) : null}
    </Svg>
  );
  if (!onSelect) return svg;
  return (
    <Pressable onPress={(e) => { const hit = sliceAt(data, size, stroke, e.nativeEvent.locationX, e.nativeEvent.locationY); onSelect(hit === selected ? null : hit); }} accessible={false}>
      {svg}
    </Pressable>
  );
}

/** Bar chart that fills the width it is given (measured), draws its bars up, and highlights one bar (the latest by default). Tap a bar to select it. */
export function Bars({ data, height = 140, width: fixed, label = 'Chart', selected, onSelect, format = rupees }: { data: { label: string; value: number }[]; height?: number; width?: number; label?: string; selected?: number | null; onSelect?: (index: number) => void; format?: (v: number) => string }) {
  const { colors } = useTheme();
  const [measured, setMeasured] = useState(0);
  const width = measured || fixed || 300;
  const grow = useGrow(data.map((d) => d.value).join(','), 600);
  const max = Math.max(1, ...data.map((d) => d.value));
  const slot = width / Math.max(1, data.length);
  const bw = Math.min(28, slot * 0.58);
  const hi = selected ?? data.length - 1;
  const scrub = useScrub((x) => Math.floor(x / slot), data.length, hi, onSelect);
  if (!measured && !fixed) return <View onLayout={(e) => setMeasured(Math.floor(e.nativeEvent.layout.width))} style={{ height: height + 24 }} />; // draw once the real width is known, not at a guess
  const svg = (
    <Svg width={width} height={height + 24}>
      {[0.5, 1].map((f) => <Line key={f} x1={0} x2={width} y1={height - height * f * 0.92} y2={height - height * f * 0.92} stroke={colors.line} strokeWidth={1} strokeDasharray="3 5" />)}
      {data.map((d, i) => {
        const h = Math.max(d.value > 0 ? 3 : 1, (d.value / max) * height * 0.92 * grow);
        const x = i * slot + (slot - bw) / 2;
        return (
          <G key={`${d.label}${i}`}>
            <Rect x={x} y={height - h} width={bw} height={h} rx={Math.min(8, bw / 2)} fill={colors.accent} opacity={i === hi ? 1 : 0.38} />
            <SvgText x={i * slot + slot / 2} y={height + 17} fill={i === hi ? colors.fg : colors.muted} fontSize={11} fontFamily={i === hi ? 'Manrope_700Bold' : 'Manrope_500Medium'} textAnchor="middle">{d.label}</SvgText>
          </G>
        );
      })}
    </Svg>
  );
  const picked = data[hi];
  return (
    <View accessible={!onSelect} accessibilityLabel={`${label}: ${data.map((d) => `${d.label} ${format(d.value)}`).join(', ')}`} onLayout={(e) => setMeasured(Math.floor(e.nativeEvent.layout.width))}>
      {onSelect && picked ? <Text className="mb-1 text-sm text-muted" accessibilityLiveRegion="polite">{picked.label}: <Text className="font-semibold text-fg">{format(picked.value)}</Text></Text> : null}
      {onSelect ? (
        <View {...scrub.handlers} {...scrub.a11y} accessible accessibilityRole="adjustable" accessibilityLabel={`${label}. ${picked ? `${picked.label}: ${format(picked.value)}` : ''}`}><Pressable onPress={(e) => scrub.tap(e.nativeEvent.locationX)}><View pointerEvents="none">{svg}</View></Pressable></View>
      ) : svg}
    </View>
  );
}

/**
 * A filled line over time (net worth, projected balance). Draws in from the left; touching it moves a marker and calls `onSelect`.
 * Values may be negative; the vertical range always fits the data.
 */
export function AreaChart({ data, height = 120, label = 'Trend', selected, onSelect, format = rupees, color, dashedFrom }: {
  data: { label: string; value: number }[]; height?: number; label?: string; selected?: number | null; onSelect?: (index: number) => void; format?: (v: number) => string; color?: string; dashedFrom?: number;
}) {
  const { colors } = useTheme();
  const stroke = color ?? colors.accent;
  const [measured, setMeasured] = useState(0);
  const width = measured || 300;
  const grow = useGrow(data.map((d) => d.value).join(','), 800);
  const n = data.length;
  const selIdx = selected ?? n - 1;
  const scrub = useScrub((x) => Math.round(((x - 8) / Math.max(1, width - 16)) * (n - 1)), n, selIdx, onSelect);
  if (!measured) return <View onLayout={(e) => setMeasured(Math.floor(e.nativeEvent.layout.width))} style={{ height: height + 22 }} />;
  if (n === 0) return <View onLayout={(e) => setMeasured(Math.floor(e.nativeEvent.layout.width))} style={{ height: height + 22 }} />;
  const vals = data.map((d) => d.value);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.18, Math.abs(hi) * 0.02, 1);
  const min = lo - pad, max = hi + pad;
  const x = (i: number) => (n === 1 ? width / 2 : (i / (n - 1)) * (width - 16) + 8);
  const y = (v: number) => height - ((v - min) / (max - min)) * height;
  const shown = Math.max(1, Math.round(n * grow)); // points revealed so far
  const pts = data.slice(0, shown).map((d, i) => [x(i), y(d.value)] as const);
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const area = pts.length > 1 ? `${line} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z` : '';
  const sel = selected ?? n - 1;
  const gid = `g${Math.abs(vals.reduce((a, v) => (a * 31 + Math.round(v)) | 0, 7))}`;
  const svg = (
    <Svg width={width} height={height + 22}>
      <Defs>
        <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={stroke} stopOpacity={0.28} />
          <Stop offset="1" stopColor={stroke} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {[0.33, 0.66].map((f) => <Line key={f} x1={0} x2={width} y1={height * f} y2={height * f} stroke={colors.line} strokeWidth={1} strokeDasharray="3 5" />)}
      {area ? <Path d={area} fill={`url(#${gid})`} /> : null}
      {dashedFrom != null && dashedFrom < pts.length - 1 ? (
        <>
          <Path d={pts.slice(0, dashedFrom + 1).map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ')} stroke={stroke} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          <Path d={pts.slice(dashedFrom).map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ')} stroke={stroke} strokeWidth={2.5} fill="none" strokeDasharray="2 6" strokeLinejoin="round" strokeLinecap="round" />
        </>
      ) : <Path d={line} stroke={stroke} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />}
      {sel < pts.length ? (
        <G>
          <Line x1={pts[sel][0]} x2={pts[sel][0]} y1={pts[sel][1]} y2={height} stroke={stroke} strokeWidth={1} opacity={0.35} />
          <Circle cx={pts[sel][0]} cy={pts[sel][1]} r={5.5} fill={colors.surface} stroke={stroke} strokeWidth={2.5} />
        </G>
      ) : null}
      {data.map((d, i) => (i % Math.ceil(n / 6) === 0 || i === n - 1) ? (
        <SvgText key={`${d.label}${i}`} x={x(i)} y={height + 16} fill={i === sel ? colors.fg : colors.muted} fontSize={11} fontFamily={i === sel ? 'Manrope_700Bold' : 'Manrope_500Medium'} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{d.label}</SvgText>
      ) : null)}
    </Svg>
  );
  const picked = data[sel];
  return (
    <View accessible={!onSelect} accessibilityLabel={`${label}: ${data.map((d) => `${d.label} ${format(d.value)}`).join(', ')}`} onLayout={(e) => setMeasured(Math.floor(e.nativeEvent.layout.width))}>
      {onSelect ? (
        <View {...scrub.handlers} {...scrub.a11y} accessible accessibilityRole="adjustable" accessibilityLabel={`${label}. ${picked ? `${picked.label}: ${format(picked.value)}` : ''}`}><Pressable onPress={(e) => scrub.tap(e.nativeEvent.locationX)}><View pointerEvents="none">{svg}</View></Pressable></View>
      ) : svg}
    </View>
  );
}
