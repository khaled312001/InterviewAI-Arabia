import { useEffect } from 'react';
import { View, StyleSheet, StyleProp, ViewStyle, DimensionValue } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, cancelAnimation,
} from 'react-native-reanimated';
import { useAppTheme } from '../theme/useTheme';

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Shimmer placeholder.
 *
 * Every previous screen showed a centred spinner while loading, which tells
 * the user nothing about what is coming and makes the app feel slower than it
 * is — the layout jumps into existence all at once. Skeletons that match the
 * final layout make the same wait read as fast, and remove the content shift.
 */
export function Skeleton({ width = '100%', height = 16, radius, style }: SkeletonProps) {
  const theme = useAppTheme();
  const progress = useSharedValue(0.5);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => cancelAnimation(progress);
  }, [progress]);

  const animated = useAnimatedStyle(() => ({ opacity: progress.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width,
          height,
          borderRadius: radius ?? theme.radii.xs,
          backgroundColor: theme.colors.skeleton,
        },
        animated,
        style,
      ]}
    />
  );
}

/** Skeleton shaped like a stat/summary card. */
export function SkeletonCard({ lines = 2, height = 96 }: { lines?: number; height?: number }) {
  const theme = useAppTheme();
  return (
    <View
      style={[
        styles.card,
        {
          height,
          borderRadius: theme.radii.lg,
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderWidth: theme.layout.hairline,
          padding: theme.spacing.lg,
          gap: theme.spacing.sm,
        },
      ]}
    >
      <Skeleton width="55%" height={14} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '70%' : '90%'} height={11} />
      ))}
    </View>
  );
}

/** Skeleton shaped like a list row (icon + two lines + trailing pill). */
export function SkeletonRow() {
  const theme = useAppTheme();
  return (
    <View
      style={[
        styles.row,
        {
          borderRadius: theme.radii.lg,
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderWidth: theme.layout.hairline,
          padding: theme.spacing.lg,
          gap: theme.spacing.md,
        },
      ]}
    >
      <Skeleton width={44} height={44} radius={theme.radii.sm} />
      <View style={{ flex: 1, gap: theme.spacing.sm }}>
        <Skeleton width="60%" height={13} />
        <Skeleton width="40%" height={11} />
      </View>
      <Skeleton width={44} height={30} radius={theme.radii.sm} />
    </View>
  );
}

/** Skeleton shaped like a category grid tile. */
export function SkeletonTile() {
  const theme = useAppTheme();
  return (
    <View
      style={{
        minHeight: 140,
        borderRadius: theme.radii.lg,
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderWidth: theme.layout.hairline,
        padding: theme.spacing.lg,
        gap: theme.spacing.md,
        justifyContent: 'space-between',
      }}
    >
      <Skeleton width={46} height={46} radius={theme.radii.sm} />
      <View style={{ gap: theme.spacing.xs }}>
        <Skeleton width="75%" height={14} />
        <Skeleton width="45%" height={11} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
});
