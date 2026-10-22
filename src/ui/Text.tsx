import { type Ref, useState } from 'react';
import { StyleSheet, Text as RNText, TextInput as RNTextInput, type TextInputInstance, type TextInputProps, type TextProps } from 'react-native';

import { FAMILY, weightOf } from './fonts';
import { useTheme } from './theme';

/** Drop-in replacement for react-native's Text: same props, but uses the bundled typeface at the weight the classes ask for. */
export function Text({ className, style, ...rest }: TextProps & { className?: string }) {
  const flat = StyleSheet.flatten(style) as { fontWeight?: unknown } | undefined;
  // fontWeight is neutralised because each weight is its own font file; leaving it would make Android fake-bold on top
  return <RNText {...rest} className={className} style={[{ fontFamily: FAMILY[weightOf(className, flat?.fontWeight)] }, style, { fontWeight: 'normal' }]} />;
}

/** Text field in the bundled typeface. Fields drawn as filled boxes get a hairline border that turns accent-coloured while focused. */
export type TextInputHandle = TextInputInstance;
export function TextInput({ className, style, onFocus, onBlur, ref, ...rest }: TextInputProps & { className?: string; ref?: Ref<TextInputHandle> }) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const boxed = !!className && /\bbg-card2?\b/.test(className) && /\brounded-/.test(className);
  return (
    <RNTextInput
      ref={ref}
      selectionColor={colors.accent}
      cursorColor={colors.accent}
      {...rest}
      className={className}
      onFocus={(e) => { setFocused(true); onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      style={[{ fontFamily: FAMILY[400] }, boxed ? { borderWidth: 1, borderColor: focused ? colors.accent : colors.line } : null, style]}
    />
  );
}
