import { ReactNode, useCallback } from 'react';
import {
  Pressable, ActivityIndicator, StyleSheet, View, Platform,
  StyleProp, ViewStyle, AccessibilityRole,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Text } from './Text';
import { useAppTheme } from '../theme/useTheme';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface Props {
  title: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
  /** Suppress the tap haptic (e.g. inside a rapidly-tapped stepper). */
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

/**
 * Primary action control.
 *
 * Heights come from `layout.control` rather than from padding maths, so a
 * button, an input, and a select in the same row line up exactly. The old
 * version derived height from `paddingVertical`, which is why controls were
 * consistently 2–4px out of alignment with each other.
 */
export function Button({
  title, onPress, loading, disabled,
  variant = 'primary', size = 'md',
  iconLeft, iconRight, fullWidth = true,
  haptic = true, style,
  accessibilityLabel, accessibilityHint, testID,
}: Props) {
  const theme = useAppTheme();
  const isDisabled = disabled || loading;

  const handlePress = useCallback(() => {
    if (isDisabled) return;
    if (haptic && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    onPress?.();
  }, [isDisabled, haptic, onPress]);

  const spec = {
    primary:   { bg: theme.colors.primary,   fg: theme.colors.onPrimary, border: 'transparent',           elevated: true },
    accent:    { bg: theme.colors.accent,    fg: theme.colors.onAccent,  border: 'transparent',           elevated: true },
    secondary: { bg: theme.colors.primaryMuted, fg: theme.colors.primary, border: 'transparent',          elevated: false },
    outline:   { bg: 'transparent',          fg: theme.colors.primary,   border: theme.colors.primaryBorder, elevated: false },
    ghost:     { bg: 'transparent',          fg: theme.colors.primary,   border: 'transparent',           elevated: false },
    danger:    { bg: theme.colors.danger,    fg: theme.colors.onBrandText, border: 'transparent',         elevated: false },
  }[variant];

  const height = theme.layout.control[size];
  const role = size === 'lg' ? 'bodyLg' : size === 'sm' ? 'bodySm' : 'body';
  const paddingH = size === 'sm' ? theme.spacing.md : theme.spacing.xl;

  return (
    <Pressable
      onPress={handlePress}
      disabled={isDisabled}
      accessibilityRole={'button' as AccessibilityRole}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        {
          height,
          paddingHorizontal: paddingH,
          backgroundColor: spec.bg,
          borderColor: spec.border,
          borderWidth: variant === 'outline' ? 1.5 : 0,
          borderRadius: theme.radii.md,
          opacity: isDisabled ? 0.45 : 1,
          transform: [{ scale: pressed && !isDisabled ? 0.97 : 1 }],
        },
        fullWidth ? styles.fullWidth : styles.auto,
        spec.elevated && !isDisabled ? (variant === 'primary' ? theme.shadow.brand : theme.shadow.md) : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={spec.fg} size="small" />
      ) : (
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          {iconLeft}
          <Text role={role} weight="bold" tone="inherit" style={{ color: spec.fg }} numberOfLines={1}>
            {title}
          </Text>
          {iconRight}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  fullWidth: { alignSelf: 'stretch' },
  auto: { alignSelf: 'flex-start' },
});
