import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { Text } from './Text';
import { ThemeToggle } from './ThemeToggle';
import { useAppTheme, useDirection, useResponsive } from '../theme/useTheme';

/**
 * The header every pushed screen shares, drawn in React rather than by the
 * platform.
 *
 * The native header lays itself out by the PROCESS's direction, which is fixed
 * at launch — so after switching to English it kept its back arrow on the
 * Arabic side until the app was restarted, while the screen under it had
 * already flipped. A JS header is laid out by the same root `direction` as
 * everything else and flips with it. It also carries the theme toggle, so the
 * light/dark switch is reachable from every screen instead of only from
 * Settings.
 */
export function AppHeader({ navigation, options, back, route }: NativeStackHeaderProps) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { chevronBack } = useDirection();
  const { maxWidth, screenPadding } = useResponsive();

  const title = typeof options.headerTitle === 'string'
    ? options.headerTitle
    : options.title ?? route.name;
  const right = options.headerRight?.({ canGoBack: Boolean(back), tintColor: theme.colors.text });

  return (
    <View
      style={{
        paddingTop: insets.top,
        backgroundColor: theme.colors.bg,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
      }}
    >
      <View
        style={[
          styles.row,
          {
            minHeight: theme.layout.touchTarget + theme.spacing.md,
            paddingHorizontal: screenPadding - theme.spacing.xs,
            gap: theme.spacing.xs,
            maxWidth: maxWidth ?? undefined,
          },
        ]}
      >
        {back ? (
          <Pressable
            onPress={navigation.goBack}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            hitSlop={theme.spacing.xs}
            style={({ pressed }) => [
              styles.iconBtn,
              {
                width: theme.layout.touchTarget,
                height: theme.layout.touchTarget,
                borderRadius: theme.radii.pill,
                backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent',
              },
            ]}
          >
            <Ionicons name={chevronBack} size={theme.layout.icon.lg} color={theme.colors.text} />
          </Pressable>
        ) : (
          <View style={{ width: theme.spacing.sm }} />
        )}

        <Text role="h4" weight="bold" numberOfLines={1} flex accessibilityRole="header">
          {title}
        </Text>

        {right ? <View style={styles.right}>{right}</View> : null}
        <ThemeToggle />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', width: '100%', alignSelf: 'center' },
  iconBtn: { alignItems: 'center', justifyContent: 'center' },
  right: { flexDirection: 'row', alignItems: 'center' },
});
