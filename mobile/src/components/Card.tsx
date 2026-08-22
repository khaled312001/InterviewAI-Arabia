import { ReactNode } from 'react';
import { View, Pressable, StyleSheet, StyleProp, ViewStyle, Platform, LayoutChangeEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '../theme/useTheme';

export type CardVariant = 'elevated' | 'outlined' | 'filled' | 'ghost';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

interface Props {
  children: ReactNode;
  variant?: CardVariant;
  padding?: CardPadding;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Passed straight through, so a form can find this card's offset. */
  onLayout?: (event: LayoutChangeEvent) => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

/**
 * Surface container.
 *
 * `variant` replaces the previous pattern of passing ad-hoc `style` overrides
 * to a single card shape — that's how the app ended up with cards at four
 * different radii and three different border treatments on one screen.
 *
 * When `onPress` is supplied the card becomes a real button for assistive
 * tech, which the old `<Pressable><Card/></Pressable>` nesting never was.
 */
export function Card({
  children,
  variant = 'elevated',
  padding = 'md',
  onPress,
  disabled,
  style,
  onLayout,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: Props) {
  const theme = useAppTheme();

  const pad = {
    none: 0,
    sm: theme.spacing.md,
    md: theme.spacing.lg,
    lg: theme.spacing.xl,
  }[padding];

  const surface: ViewStyle =
    variant === 'elevated' ? {
      backgroundColor: theme.colors.surface,
      borderWidth: theme.layout.hairline,
      borderColor: theme.colors.border,
      ...(theme.shadow.md as ViewStyle),
    }
    : variant === 'outlined' ? {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    }
    : variant === 'filled' ? {
      backgroundColor: theme.colors.surfaceAlt,
      borderWidth: theme.layout.hairline,
      borderColor: theme.colors.divider,
    }
    : { backgroundColor: 'transparent' };

  const base: StyleProp<ViewStyle> = [
    styles.card,
    { borderRadius: theme.radii.lg, padding: pad },
    surface,
    style,
  ];

  if (!onPress) return <View style={base} onLayout={onLayout} testID={testID}>{children}</View>;

  return (
    <Pressable
      testID={testID}
      onLayout={onLayout}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      onPress={() => {
        if (Platform.OS !== 'web') {
          Haptics.selectionAsync().catch(() => {});
        }
        onPress();
      }}
      style={({ pressed }) => [
        base,
        {
          opacity: disabled ? 0.5 : 1,
          transform: [{ scale: pressed && !disabled ? 0.985 : 1 }],
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
});
