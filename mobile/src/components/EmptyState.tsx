import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { Button } from './Button';
import { useAppTheme } from '../theme/useTheme';

interface Props {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'neutral' | 'danger';
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Empty / error state.
 *
 * The old screens rendered a bare sentence of muted text in a card for every
 * empty list. An empty state is a conversion opportunity — it should name the
 * situation and offer the next action, which is what `actionLabel` is for.
 */
export function EmptyState({
  icon = 'sparkles-outline',
  title,
  description,
  actionLabel,
  onAction,
  tone = 'neutral',
  compact,
  style,
}: Props) {
  const theme = useAppTheme();
  const accent = tone === 'danger' ? theme.colors.danger : theme.colors.primary;
  const accentBg = tone === 'danger' ? theme.colors.dangerMuted : theme.colors.primaryMuted;

  return (
    <View
      style={[
        styles.wrap,
        {
          paddingVertical: compact ? theme.spacing['2xl'] : theme.spacing['5xl'],
          paddingHorizontal: theme.spacing.xl,
          gap: theme.spacing.md,
        },
        style,
      ]}
    >
      <View
        style={[
          styles.iconWrap,
          {
            width: compact ? 56 : 72,
            height: compact ? 56 : 72,
            borderRadius: compact ? 28 : 36,
            backgroundColor: accentBg,
          },
        ]}
      >
        <Ionicons name={icon} size={compact ? 26 : 34} color={accent} />
      </View>

      <Text role={compact ? 'h4' : 'h3'} weight="bold" align="center">
        {title}
      </Text>

      {description ? (
        <Text role="bodySm" tone="muted" align="center" style={styles.description}>
          {description}
        </Text>
      ) : null}

      {actionLabel && onAction ? (
        <Button
          title={actionLabel}
          onPress={onAction}
          variant={tone === 'danger' ? 'outline' : 'primary'}
          size="md"
          fullWidth={false}
          style={{ marginTop: theme.spacing.xs }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  description: { maxWidth: 340 },
});
