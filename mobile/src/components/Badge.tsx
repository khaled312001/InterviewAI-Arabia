import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { useAppTheme } from '../theme/useTheme';

export type BadgeTone =
  | 'neutral' | 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'onDark';
export type BadgeSize = 'sm' | 'md';

interface Props {
  label: string;
  tone?: BadgeTone;
  size?: BadgeSize;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
}

/**
 * Small status pill — plan tiers, difficulty, premium markers, scores.
 *
 * Previously each screen built its own pill inline with slightly different
 * padding and its own `theme.colors.accent + '22'` alpha hack, which produces
 * a different result per colour and breaks entirely in dark mode. Tones map to
 * the pre-computed `*Muted` roles instead.
 */
export function Badge({ label, tone = 'neutral', size = 'sm', icon, style }: Props) {
  const theme = useAppTheme();

  const spec = {
    neutral: { bg: theme.colors.surfaceSunken, fg: theme.colors.textSecondary },
    primary: { bg: theme.colors.primaryMuted,  fg: theme.colors.primary },
    accent:  { bg: theme.colors.accentMuted,   fg: theme.colors.accentText },
    success: { bg: theme.colors.successMuted,  fg: theme.colors.success },
    warning: { bg: theme.colors.warningMuted,  fg: theme.colors.warning },
    danger:  { bg: theme.colors.dangerMuted,   fg: theme.colors.danger },
    onDark:  { bg: theme.colors.onBrandMuted,  fg: theme.colors.onBrandText },
  }[tone] as { bg: string; fg: string };

  const py = size === 'md' ? theme.spacing.xs + 2 : theme.spacing.xxs + 1;
  const px = size === 'md' ? theme.spacing.md : theme.spacing.sm + 2;

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: spec.bg,
          borderRadius: theme.radii.pill,
          paddingVertical: py,
          paddingHorizontal: px,
          gap: theme.spacing.xs,
        },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={size === 'md' ? 13 : 11} color={spec.fg} /> : null}
      <Text role={size === 'md' ? 'caption' : 'micro'} weight="bold" tone="inherit" style={{ color: spec.fg }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
});
