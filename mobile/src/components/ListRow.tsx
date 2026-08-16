import { ReactNode } from 'react';
import { View, Pressable, StyleSheet, StyleProp, ViewStyle, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Text } from './Text';
import { useAppTheme, useDirection } from '../theme/useTheme';

interface Props {
  title: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Icon tint + matching muted background. */
  iconTone?: 'primary' | 'success' | 'warning' | 'danger' | 'accent' | 'neutral';
  /** Anything rendered at the trailing edge — a Badge, a score, a Switch. */
  trailing?: ReactNode;
  /** Show the directional chevron. Defaults to true when `onPress` is set. */
  showChevron?: boolean;
  onPress?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Hairline separator below the row — for grouped rows inside one card. */
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Standard tappable row.
 *
 * Guarantees the 48px minimum touch target that the old hand-built rows
 * missed (they were 14px padding around a 22px icon ≈ 44px on Android, and
 * the chevron always pointed `chevron-back` regardless of direction, so it
 * pointed the wrong way in English).
 */
export function ListRow({
  title, subtitle, icon, iconTone = 'primary', trailing,
  showChevron, onPress, danger, disabled, divider, style, testID,
}: Props) {
  const theme = useAppTheme();
  const { chevronForward } = useDirection();

  const tone = danger ? 'danger' : iconTone;
  const iconColor = tone === 'neutral' ? theme.colors.textSecondary : theme.colors[tone];
  const iconBg =
    tone === 'neutral' ? theme.colors.surfaceSunken : theme.colors[`${tone}Muted` as const];

  const chevron = showChevron ?? !!onPress;

  const content = (
    <View
      style={[
        styles.row,
        {
          minHeight: theme.layout.touchTarget,
          paddingVertical: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          gap: theme.spacing.md,
          borderBottomWidth: divider ? theme.layout.hairline : 0,
          borderBottomColor: theme.colors.divider,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      {icon ? (
        <View
          style={[
            styles.iconWrap,
            { width: 40, height: 40, borderRadius: theme.radii.sm, backgroundColor: iconBg },
          ]}
        >
          <Ionicons name={icon} size={theme.layout.icon.md} color={iconColor} />
        </View>
      ) : null}

      <View style={styles.textCol}>
        <Text role="body" weight="bold" tone={danger ? 'danger' : 'default'} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text role="caption" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {trailing}

      {chevron ? (
        <Ionicons name={chevronForward} size={theme.layout.icon.md} color={theme.colors.textDisabled} />
      ) : null}
    </View>
  );

  if (!onPress) return <View testID={testID}>{content}</View>;

  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      accessibilityState={{ disabled: !!disabled }}
      onPress={() => {
        if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={({ pressed }) => ({
        backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
      })}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  textCol: { flex: 1, justifyContent: 'center' },
});
