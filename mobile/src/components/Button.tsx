import { Pressable, Text, ActivityIndicator, StyleSheet, View, Platform } from 'react-native';
import { MotiView } from 'moti';
import { useAppTheme } from '../theme/useTheme';

interface Props {
  title: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
  size?: 'md' | 'lg';
}

export function Button({
  title, onPress, loading, disabled,
  variant = 'primary', iconLeft, iconRight, fullWidth = true, size = 'md',
}: Props) {
  const theme = useAppTheme();

  const bg =
    variant === 'primary' ? theme.colors.primary
    : variant === 'secondary' ? theme.colors.accent
    : variant === 'danger' ? theme.colors.danger
    : variant === 'outline' ? 'transparent'
    : 'transparent';
  const fg =
    variant === 'ghost' ? theme.colors.primary
    : variant === 'outline' ? theme.colors.primary
    : '#fff';
  const borderColor = variant === 'outline' ? theme.colors.primary : 'transparent';
  const paddingY = size === 'lg' ? 16 : 13;
  const fontSize = size === 'lg' ? 16 : 15;

  return (
    <MotiView
      from={{ opacity: 0, translateY: 4 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 200 }}
      style={fullWidth ? { alignSelf: 'stretch' } : undefined}
    >
      <Pressable
        onPress={onPress}
        disabled={disabled || loading}
        style={({ pressed }) => [
          styles.base,
          {
            backgroundColor: bg,
            borderColor,
            borderWidth: variant === 'outline' ? 1.5 : 0,
            paddingVertical: paddingY,
            opacity: disabled ? 0.5 : pressed ? 0.88 : 1,
            transform: [{ scale: pressed && !disabled ? 0.985 : 1 }],
          },
          variant === 'primary' && styles.primaryShadow,
        ]}
      >
        <View style={styles.row}>
          {loading ? (
            <ActivityIndicator color={fg} />
          ) : (
            <>
              {iconLeft}
              <Text style={[styles.text, { color: fg, fontFamily: theme.typography.fontFamilyBold, fontSize }]}>
                {title}
              </Text>
              {iconRight}
            </>
          )}
        </View>
      </Pressable>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: 20,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  text: {},
  primaryShadow: Platform.select({
    ios: { shadowColor: '#2D6CE0', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
    android: { elevation: 4 },
    default: { boxShadow: '0 6px 18px rgba(45,108,224,0.35)' },
  }),
});
