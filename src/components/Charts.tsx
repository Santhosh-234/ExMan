import { View } from 'react-native';
import { useTheme } from '@/ui/theme';
import { rupees } from '@/utils/format';
import Svg, { Circle, G, Rect, Text as SvgText } from 'react-native-svg';

export type Slice = { label: string; value: number; color: string };

/** Donut chart via stroke-dasharray on circles. */
export function Pie({ data, size = 180, label = 'Spending by category' }: { data: Slice[]; size?: number; label?: string }) {
  const { colors } = useTheme();
  const total = data.reduce((a, d) => a + d.value, 0);
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const summary = `${label}: ${data.map((d) => `${d.label} ${rupees(d.value)}`).join(', ') || 'no data'}`;
  return (
    <Svg width={size} height={size} accessible accessibilityLabel={summary}>
      <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
        {total === 0 ? (
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surface2} strokeWidth={24} fill="none" />
        ) : (
          data.map((d) => {
            const len = (d.value / total) * c;
            const el = (
              <Circle
                key={d.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                stroke={d.color}
                strokeWidth={24}
                fill="none"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })
        )}
      </G>
    </Svg>
  );
}

export function Bars({ data, height = 140, width = 320, label = 'Chart' }: { data: { label: string; value: number }[]; height?: number; width?: number; label?: string }) {
  const { colors } = useTheme();
  const max = Math.max(1, ...data.map((d) => d.value));
  const slot = width / Math.max(1, data.length);
  const bw = slot * 0.55;
  return (
    <View accessible accessibilityLabel={`${label}: ${data.map((d) => `${d.label} ${rupees(d.value)}`).join(', ')}`}>
      <Svg width={width} height={height + 22}>
        {data.map((d, i) => {
          const h = (d.value / max) * height;
          return (
            <G key={d.label}>
              <Rect x={i * slot + (slot - bw) / 2} y={height - h} width={bw} height={Math.max(h, 2)} rx={4} fill={colors.accent} />
              <SvgText x={i * slot + slot / 2} y={height + 16} fill={colors.muted} fontSize={11} textAnchor="middle">
                {d.label}
              </SvgText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}
