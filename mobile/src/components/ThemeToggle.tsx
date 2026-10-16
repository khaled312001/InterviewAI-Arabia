import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { MotiView } from 'moti';
import { useAppTheme, useThemeMode, useThemePreference } from '../theme/useTheme';

interface Props {
  /**
   * `onBrand`: glass chip for a gradient hero (white glyph, translucent fill).
   * `surface`: quiet chip for a plain header on the page background.
   */
  tone?: 'onBrand' | 'surface';
}

/**
 * One tap between light and dark, from wherever the reader is.
 *
 * Settings keeps the three-way choice (light / dark / follow the system); this
 * is the shortcut, so it only ever flips between the two modes the reader can
 * SEE — pressing it while following a dark system selects light, not "system
 * again". The icon shows where the tap will take you, which is the convention
 * people already know from every other app.
 */
export function ThemeToggle({ tone = 'surface' }: Props) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const mode = useThemeMode();
  const setPreference = useThemePreference((s) => s.setPreference);

  const next = mode === 'dark' ? 'light' : 'dark';
  const onBrand = tone === 'onBrand';

  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        setPreference(next);
      }}
      accessibilityRole="switch"
      accessibilityState={{ checked: mode === 'dark' }}
      accessibilityLabel={t(next === 'dark' ? 'settings.switchToDark' : 'settings.switchToLight')}
      hitSlop={theme.spacing.xs}
      style={({ pressed }) => [
        styles.chip,
        {
          width: theme.layout.touchTarget - 4,
          height: theme.layout.touchTarget - 4,
          borderRadius: theme.radii.pill,
          backgroundColor: onBrand ? theme.colors.onBrandMuted : theme.colors.surface,
          borderWidth: 1,
          borderColor: onBrand ? theme.colors.onBrandBorder : theme.colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <MotiView
        key={mode}
        from={{ rotate: '-90deg', scale: 0.6, opacity: 0 }}
        animate={{ rotate: '0deg', scale: 1, opacity: 1 }}
        transition={{ type: 'timing', duration: theme.motion.duration.normal }}
      >
        <Ionicons
          name={mode === 'dark' ? 'sunny' : 'moon'}
          size={theme.layout.icon.md}
          color={onBrand ? theme.colors.onBrandText : mode === 'dark' ? theme.colors.accent : theme.colors.primary}
        />
      </MotiView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { alignItems: 'center', justifyContent: 'center' },
});
