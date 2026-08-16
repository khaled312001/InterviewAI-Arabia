import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  useSharedValue, useAnimatedProps, withTiming, Easing,
} from 'react-native-reanimated';
import { Text } from './Text';
import { useAppTheme } from '../theme/useTheme';
import { scoreColor, scoreTone } from '../theme/tokens';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  /** Score on a 0–10 scale. */
  score: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  /** Skip the entrance animation (e.g. in a long list). */
  animate?: boolean;
}

/**
 * Circular score indicator.
 *
 * The score is the single most important number in the product — it deserves
 * a real visualisation rather than the coloured text pill the old screens
 * used. Colour comes from `scoreTone` so the threshold for "good" is defined
 * once in the tokens rather than re-implemented per screen.
 */
export function ScoreRing({ score, size = 88, strokeWidth = 8, label, animate = true }: Props) {
  const theme = useAppTheme();
  const clamped = Math.max(0, Math.min(10, Number.isFinite(score) ? score : 0));

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = useSharedValue(animate ? 0 : clamped / 10);

  useEffect(() => {
    if (!animate) {
      progress.value = clamped / 10;
      return;
    }
    progress.value = withTiming(clamped / 10, {
      duration: theme.motion.duration.deliberate,
      easing: Easing.out(Easing.cubic),
    });
  }, [clamped, animate, progress, theme.motion.duration.deliberate]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.value),
  }));

  const color = scoreColor(clamped, theme);

  return (
    <View
      style={[styles.wrap, { width: size, height: size }]}
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? 'التقييم'}
      accessibilityValue={{ min: 0, max: 10, now: Math.round(clamped * 10) / 10 }}
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={theme.colors.surfaceSunken}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          animatedProps={animatedProps}
          // Start the arc at 12 o'clock instead of 3 o'clock.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>

      <View style={styles.center}>
        <Text
          role={size >= 80 ? 'numeric' : 'h4'}
          weight="bold"
          tone="inherit"
          style={{ color }}
        >
          {clamped % 1 === 0 ? clamped.toFixed(0) : clamped.toFixed(1)}
        </Text>
        {label && size >= 80 ? (
          <Text role="micro" tone="muted">{label}</Text>
        ) : null}
      </View>
    </View>
  );
}

/** Horizontal variant for dense lists where a ring is too heavy. */
export function ScoreBar({ score, width = 120 }: { score: number; width?: number }) {
  const theme = useAppTheme();
  const clamped = Math.max(0, Math.min(10, Number.isFinite(score) ? score : 0));
  const color = scoreColor(clamped, theme);
  const tone = scoreTone(clamped);

  return (
    <View style={{ gap: theme.spacing.xs, width }}>
      <View
        style={{
          height: 6,
          borderRadius: theme.radii.pill,
          backgroundColor: theme.colors[`${tone}Muted` as const],
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${clamped * 10}%`,
            height: '100%',
            borderRadius: theme.radii.pill,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
