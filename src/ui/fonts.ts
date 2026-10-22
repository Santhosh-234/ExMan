// Manrope (SIL Open Font License, see fonts/OFL.txt), bundled as JS assets so it ships by update, not just by APK.
export const FONT_FILES = {
  Manrope_400Regular: require('./fonts/Manrope_400Regular.ttf'),
  Manrope_500Medium: require('./fonts/Manrope_500Medium.ttf'),
  Manrope_600SemiBold: require('./fonts/Manrope_600SemiBold.ttf'),
  Manrope_700Bold: require('./fonts/Manrope_700Bold.ttf'),
} as const;

export type Weight = 400 | 500 | 600 | 700;
export const FAMILY: Record<Weight, string> = { 400: 'Manrope_400Regular', 500: 'Manrope_500Medium', 600: 'Manrope_600SemiBold', 700: 'Manrope_700Bold' };

/** Which bundled weight a text should use, from an explicit fontWeight or a font-* utility class. */
export function weightOf(className: string | undefined, fontWeight: unknown): Weight {
  const w = String(fontWeight ?? '');
  if (w === 'bold' || w === '700' || w === '800' || w === '900') return 700;
  if (w === '600') return 600;
  if (w === '500') return 500;
  if (w) return 400;
  if (!className) return 400;
  if (/(^|\s)font-(bold|extrabold|black)(\s|$)/.test(className)) return 700;
  if (/(^|\s)font-semibold(\s|$)/.test(className)) return 600;
  if (/(^|\s)font-medium(\s|$)/.test(className)) return 500;
  return 400;
}
