import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';
import Svg, { Circle, G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { useReducedMotion } from '@/ui/motion';
import { Text } from '@/ui/Text';
import { useTheme } from '@/ui/theme';
import { rupees } from '@/utils/format';

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
        <Pressable onPress={(e) => onSelect(Math.max(0, Math.min(data.length - 1, Math.floor(e.nativeEvent.locationX / slot))))} accessibilityRole="adjustable" accessibilityLabel={`${label}. Tap a bar to select a month.`}>{svg}</Pressable>
      ) : svg}
    </View>
  );
}
