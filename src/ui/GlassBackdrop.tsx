import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { GLASS_BACKDROP, type Scheme } from './palettes';

/** The page behind everything in the glass look: a soft three-stop gradient with three blurred-looking glows. Static, so it costs nothing while scrolling. */
export function GlassBackdrop({ scheme }: { scheme: Scheme }) {
  const { stops, glows } = GLASS_BACKDROP[scheme];
  const glow = scheme === 'dark' ? 0.55 : 0.5;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none" width="100%" height="100%" preserveAspectRatio="none" accessible={false} importantForAccessibility="no-hide-descendants">
      <Defs>
        <LinearGradient id="base" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={stops[0]} />
          <Stop offset="0.55" stopColor={stops[1]} />
          <Stop offset="1" stopColor={stops[2]} />
        </LinearGradient>
        {glows.map((c, i) => (
          <RadialGradient key={i} id={`g${i}`} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor={c} stopOpacity={glow} />
            <Stop offset="1" stopColor={c} stopOpacity={0} />
          </RadialGradient>
        ))}
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#base)" />
      <Rect x="-30%" y="-12%" width="100%" height="55%" fill="url(#g0)" />
      <Rect x="35%" y="30%" width="95%" height="50%" fill="url(#g1)" />
      <Rect x="-25%" y="62%" width="100%" height="55%" fill="url(#g2)" />
    </Svg>
  );
}
