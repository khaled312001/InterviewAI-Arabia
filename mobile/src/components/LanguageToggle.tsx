import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { setAppLanguage, useLanguage } from '../i18n';
import { useAppTheme } from '../theme/useTheme';
import { Text } from './Text';

interface Props {
  /** Same two tones as ThemeToggle, so the pair sits together on either background. */
  tone?: 'onBrand' | 'surface';
}

/**
 * Arabic ⇄ English, before sign-in.
 *
 * A first launch is Arabic whatever the device says, and the full language
 * picker lives in Settings — which a signed-out reader cannot reach. So an
 * English speaker used to meet three onboarding slides, a sign-up form and a
 * Google button all in a language they may not read, with no way out. This is
 * the way out, on the first screens they see.
 *
 * The chip names the language it switches TO, written in that language
 * ("English" / "العربية"): that is the word the person who needs it can read.
 */
export function LanguageToggle({ tone = 'surface' }: Props) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const { language } = useLanguage();

  const next = language === 'ar' ? 'en' : 'ar';
  const onBrand = tone === 'onBrand';
  const color = onBrand ? theme.colors.onBrandText : theme.colors.primary;

  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        void setAppLanguage(next);
      }}
      accessibilityRole="button"
      accessibilityLabel={t('settings.switchLanguage')}
      accessibilityLanguage={next}
      hitSlop={theme.spacing.xs}
      testID="language-toggle"
      style={({ pressed }) => [
        styles.chip,
        {
          height: theme.layout.touchTarget - 4,
          paddingHorizontal: theme.spacing.md,
          gap: theme.spacing.xs,
          borderRadius: theme.radii.pill,
          backgroundColor: onBrand ? theme.colors.onBrandMuted : theme.colors.surface,
          borderWidth: 1,
          borderColor: onBrand ? theme.colors.onBrandBorder : theme.colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Ionicons name="language" size={theme.layout.icon.sm} color={color} />
      <Text role="bodySm" weight="bold" style={{ color }} numberOfLines={1}>
        {next === 'en' ? 'English' : 'العربية'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
