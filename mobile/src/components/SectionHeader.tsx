import { View, Pressable, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { useAppTheme, useDirection } from '../theme/useTheme';

interface Props {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Section title + optional "see all" affordance.
 *
 * Extracted because every screen was rebuilding this row with its own margins
 * (14 / 16 / 12 px on three different screens), which is exactly the kind of
 * drift that reads as sloppy even when no single screen looks wrong.
 */
export function SectionHeader({ title, subtitle, actionLabel, onAction, style }: Props) {
  const theme = useAppTheme();
  const { chevronForward } = useDirection();

  return (
    <View style={[styles.row, { marginBottom: theme.spacing.md, gap: theme.spacing.md }, style]}>
      <View style={styles.titleCol}>
        <Text role="h4" weight="bold">{title}</Text>
        {subtitle ? (
          <Text role="caption" tone="muted" style={{ marginTop: 2 }}>{subtitle}</Text>
        ) : null}
      </View>

      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1, gap: 2 }]}
        >
          <Text role="bodySm" weight="bold" tone="primary">{actionLabel}</Text>
          <Ionicons name={chevronForward} size={14} color={theme.colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  titleCol: { flex: 1 },
  action: { flexDirection: 'row', alignItems: 'center' },
});
