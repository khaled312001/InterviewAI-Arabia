import { Text as RNText, TextProps as RNTextProps, StyleSheet } from 'react-native';
import { useAppTheme } from '../theme/useTheme';
import type { TextRole } from '../theme/tokens';

type Tone =
  | 'default'
  | 'secondary'
  | 'muted'
  | 'disabled'
  | 'primary'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'onBrand'
  | 'inherit';

/**
 * `role` is omitted from the RN props: React Native reuses that name for the
 * ARIA role, and our typographic role would otherwise have to satisfy that
 * union. Accessibility roles are still available via `accessibilityRole`.
 */
export interface TextProps extends Omit<RNTextProps, 'role'> {
  /** Typographic role from the scale — never pass a raw fontSize. */
  role?: TextRole;
  weight?: 'regular' | 'bold';
  tone?: Tone;
  align?: 'auto' | 'left' | 'right' | 'center';
  /** Convenience for the very common "flex: 1" text-in-a-row case. */
  flex?: boolean;
}

/**
 * The only text primitive screens should use.
 *
 * Every previous screen hand-wrote `{ fontSize: 15, fontFamily: theme.typography.fontFamily }`,
 * which is how the app ended up with nine different body sizes. Going through
 * a role here means a change to the scale propagates everywhere at once.
 *
 * `align` defaults to `auto`, which lets React Native resolve start/end from
 * the active writing direction. Hardcoding `right` — as the old Input did —
 * looks correct in Arabic and breaks the moment a user switches to English.
 */
export function Text({
  role = 'body',
  weight = 'regular',
  tone = 'default',
  align = 'auto',
  flex,
  style,
  ...rest
}: TextProps) {
  const theme = useAppTheme();

  const color =
    tone === 'inherit'   ? undefined
    : tone === 'secondary' ? theme.colors.textSecondary
    : tone === 'muted'    ? theme.colors.textMuted
    : tone === 'disabled' ? theme.colors.textDisabled
    : tone === 'primary'  ? theme.colors.primary
    : tone === 'accent'   ? theme.colors.accent
    : tone === 'success'  ? theme.colors.success
    : tone === 'warning'  ? theme.colors.warning
    : tone === 'danger'   ? theme.colors.danger
    : tone === 'onBrand'  ? theme.colors.textOnBrand
    : theme.colors.text;

  return (
    <RNText
      {...rest}
      style={[
        theme.text(role, weight),
        color ? { color } : null,
        align !== 'auto' ? { textAlign: align } : null,
        flex ? styles.flex : null,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
