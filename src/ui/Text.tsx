import { StyleSheet, Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps } from 'react-native';

import { FAMILY, weightOf } from './fonts';

/** Drop-in replacement for react-native's Text: same props, but uses the bundled typeface at the weight the classes ask for. */
export function Text({ className, style, ...rest }: TextProps & { className?: string }) {
  const flat = StyleSheet.flatten(style) as { fontWeight?: unknown } | undefined;
  // fontWeight is neutralised because each weight is its own font file; leaving it would make Android fake-bold on top
  return <RNText {...rest} className={className} style={[{ fontFamily: FAMILY[weightOf(className, flat?.fontWeight)] }, style, { fontWeight: 'normal' }]} />;
}

export function TextInput({ className, style, ...rest }: TextInputProps & { className?: string }) {
  return <RNTextInput {...rest} className={className} style={[{ fontFamily: FAMILY[400] }, style]} />;
}
