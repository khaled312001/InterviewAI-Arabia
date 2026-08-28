import { ReactNode, useState } from 'react';
import { View, Pressable, StyleSheet, StyleProp, ViewStyle, Platform, LayoutChangeEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import { MotiView } from 'moti';
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
  /**
   * Press with real depth: the card tips away from the finger on a perspective
   * projection instead of only shrinking.
   *
   * Opt-in rather than the default. It belongs on a small number of focal,
   * card-shaped targets — the category grid — and nowhere else: a list where
   * every row tilts is not tactile, it is seasick. The repo's own
   * micro-interaction rule says the same thing about magnetic hover ("not more
   * than 1-2 focal elements per screen; it becomes noisy").
   */
  depth?: boolean;
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
  depth = false,
}: Props) {
  const theme = useAppTheme();
  const [pressedIn, setPressedIn] = useState(false);

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

  const press = () => {
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync().catch(() => {});
    }
    onPress?.();
  };

  if (!onPress) return <View style={base} onLayout={onLayout} testID={testID}>{children}</View>;

  if (!depth) {
    return (
      <Pressable
        testID={testID}
        onLayout={onLayout}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: !!disabled }}
        onPress={press}
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

  /*
   * The transform lives on an inner MotiView rather than in Pressable's own
   * `style` callback, because that callback re-renders between two fixed
   * values — it can only snap. The tilt has to be sprung to read as a physical
   * object, and a spring needs somewhere to hold its velocity.
   *
   * `perspective` must come FIRST in the transform list: React Native applies
   * these as an ordered matrix multiplication, so a rotation written before the
   * projection is applied flat and the card simply squashes instead of tipping.
   */
  const down = pressedIn && !disabled;

  return (
    <Pressable
      testID={testID}
      onLayout={onLayout}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      onPressIn={() => setPressedIn(true)}
      onPressOut={() => setPressedIn(false)}
      onPress={press}
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <MotiView
        animate={{
          scale: down ? 0.965 : 1,
          rotateX: down ? '7deg' : '0deg',
          translateY: down ? 2 : 0,
        }}
        transition={
          theme.motion.reduced
            ? { type: 'timing', duration: theme.motion.duration.instant }
            : { type: 'spring', ...theme.motion.easing.spring }
        }
        style={[base, { transform: [{ perspective: 900 }] }]}
      >
        {children}
      </MotiView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
});
