import { useState } from 'react';
import { TextInput, View, Text, StyleSheet, TextInputProps, Platform } from 'react-native';
import { useAppTheme } from '../theme/useTheme';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
  helperText?: string;
}

export function Input({ label, error, helperText, style, onFocus, onBlur, ...rest }: Props) {
  const theme = useAppTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? theme.colors.danger
    : focused
      ? theme.colors.primary
      : theme.colors.border;

  return (
    <View style={{ gap: 6 }}>
      {label && (
        <Text style={[styles.label, {
          color: theme.colors.textMuted,
          fontFamily: theme.typography.fontFamily,
        }]}>
          {label}
        </Text>
      )}
      <TextInput
        placeholderTextColor={theme.colors.textMuted}
        {...rest}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        style={[
          styles.input,
          {
            backgroundColor: theme.colors.bgMuted,
            color: theme.colors.text,
            borderColor,
            fontFamily: theme.typography.fontFamily,
            textAlign: 'right',
          },
          focused && Platform.select({
            ios: { shadowColor: theme.colors.primary, shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
            default: { boxShadow: '0 0 0 3px rgba(45,108,224,0.15)' },
          }),
          style,
        ]}
      />
      {(helperText || error) && (
        <Text style={{
          color: error ? theme.colors.danger : theme.colors.textMuted,
          fontFamily: theme.typography.fontFamily,
          fontSize: 12,
        }}>
          {error || helperText}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13 },
  input: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    minHeight: 50,
  },
});
