import { Pressable, Text, ActivityIndicator, StyleSheet, View } from 'react-native';
import { MotiView } from 'moti';
import { useAppTheme } from '../theme/useTheme';

interface Props {
  title: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  iconLeft?: React.ReactNode;
  fullWidth?: boolean;
}

export function Button({
  title, onPress, loading, disabled,
  variant = 'primary', iconLeft, fullWidth = true,
}: Props) {
  const theme = useAppTheme();
  const bg = {
    primary: theme.colors.primary,
    secondary: theme.colors.secondary,
    ghost: 'transparent',
    danger: theme.colors.danger,
  }[variant];
  const color = variant === 'ghost' ? theme.colors.primary : '#fff';

  return (
    <MotiView
      from={{ opacity: 0, translateY: 6 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 220 }}
      style={fullWidth ? { alignSelf: 'stretch' } : undefined}
    >
      <Pressable
        onPress={onPress}
        disabled={disabled || loading}
        style={({ pressed }) => [
          styles.base,
          {
            backgroundColor: bg,
            borderColor: theme.colors.primary,
            borderWidth: variant === 'ghost' ? 1.5 : 0,
            opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          },
        ]}
      >
        <View style={styles.row}>
          {loading ? (
            <ActivityIndicator color={color} />
          ) : (
            <>
              {iconLeft}
              <Text style={[styles.text, { color, fontFamily: theme.typography.fontFamilyBold }]}>
                {title}
              </Text>
            </>
          )}
        </View>
      </Pressable>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  base: { paddingVertical: 14, paddingHorizontal: 20, borderRadius: 12, alignItems: 'center' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  text: { fontSize: 16 },
});
