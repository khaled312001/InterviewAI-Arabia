import { TextInput, View, Text, StyleSheet, TextInputProps } from 'react-native';
import { useAppTheme } from '../theme/useTheme';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
}

export function Input({ label, error, style, ...rest }: Props) {
  const theme = useAppTheme();
  return (
    <View style={{ gap: 6 }}>
      {label && (
        <Text style={{ color: theme.colors.textMuted, fontFamily: theme.typography.fontFamily, fontSize: 13 }}>
          {label}
        </Text>
      )}
      <TextInput
        placeholderTextColor={theme.colors.textMuted}
        {...rest}
        style={[
          styles.input,
          {
            backgroundColor: theme.colors.surface,
            color: theme.colors.text,
            borderColor: error ? theme.colors.danger : theme.colors.border,
            fontFamily: theme.typography.fontFamily,
            textAlign: 'right',
          },
          style,
        ]}
      />
      {error && (
        <Text style={{ color: theme.colors.danger, fontFamily: theme.typography.fontFamily, fontSize: 12 }}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 48,
  },
});
