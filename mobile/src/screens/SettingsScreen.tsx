/**
 * SettingsScreen — grouped preferences.
 *
 * Structure follows the "one card per concern" rule: appearance, language,
 * notifications, legal, support, account. Every row is a real `ListRow`, so
 * touch targets, chevron direction, and pressed states are consistent instead
 * of being re-derived per screen (the previous version shipped chips with a
 * 34px target and hardcoded Arabic labels that never translated).
 *
 * Notification preferences are stored locally — the API has no endpoint for
 * them yet — so the switches persist per device via AsyncStorage.
 */

import { memo, useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Pressable, Switch, Linking, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

import { setAppLanguage } from '../i18n';
import { useAuth } from '../store/auth';
import { useAppTheme, useThemePreference } from '../theme/useTheme';
import { Screen, Text, Card, Badge, ListRow, SectionHeader, Skeleton } from '../components';

/* Public pages owned by the marketing site — not localisable copy. */
const WEBSITE_URL = 'https://barmagly.tech';
const PRIVACY_URL = 'https://barmagly.tech/privacy';
const TERMS_URL = 'https://barmagly.tech/terms';

const NOTIF_STORAGE_KEY = 'settings:notifications';

type IconName = keyof typeof Ionicons.glyphMap;
type ThemePreference = 'system' | 'light' | 'dark';
type NotificationKey = 'practice' | 'weekly' | 'product';
type NotificationPrefs = Record<NotificationKey, boolean>;

const DEFAULT_NOTIFS: NotificationPrefs = { practice: true, weekly: true, product: false };

const NOTIFICATION_ROWS: {
  key: NotificationKey;
  icon: IconName;
  titleKey: string;
  hintKey: string;
}[] = [
  { key: 'practice', icon: 'alarm-outline', titleKey: 'settings.notifyPractice', hintKey: 'settings.notifyPracticeHint' },
  { key: 'weekly', icon: 'stats-chart-outline', titleKey: 'settings.notifyWeekly', hintKey: 'settings.notifyWeeklyHint' },
  { key: 'product', icon: 'megaphone-outline', titleKey: 'settings.notifyProduct', hintKey: 'settings.notifyProductHint' },
];

function openUrl(url: string) {
  Linking.openURL(url).catch(() => {});
}

/**
 * Cross-platform destructive confirm.
 * react-native-web routes `Alert.alert` to `window.alert`, which has no
 * buttons — so the destructive callback would never fire on the web build.
 */
function confirmDestructive(opts: {
  title: string; body: string; confirmLabel: string; cancelLabel: string; onConfirm: () => void;
}) {
  if (Platform.OS === 'web') {
    const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(`${opts.title}\n\n${opts.body}`)
      : false;
    if (ok) opts.onConfirm();
    return;
  }
  Alert.alert(opts.title, opts.body, [
    { text: opts.cancelLabel, style: 'cancel' },
    { text: opts.confirmLabel, style: 'destructive', onPress: opts.onConfirm },
  ]);
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

const OptionTile = memo(function OptionTile({
  icon, label, selected, onPress, hint,
}: {
  icon: IconName;
  label: string;
  selected: boolean;
  onPress: () => void;
  hint: string;
}) {
  const theme = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.tile,
        {
          minHeight: theme.layout.touchTarget + theme.spacing.xl,
          borderRadius: theme.radii.md,
          borderWidth: 1.5,
          borderColor: selected ? theme.colors.primary : theme.colors.border,
          backgroundColor: selected ? theme.colors.primaryMuted : theme.colors.surface,
          paddingVertical: theme.spacing.md,
          paddingHorizontal: theme.spacing.sm,
          gap: theme.spacing.xs,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      <Ionicons
        name={icon}
        size={theme.layout.icon.md}
        color={selected ? theme.colors.primary : theme.colors.textMuted}
      />
      <Text
        role="caption"
        weight={selected ? 'bold' : 'regular'}
        tone={selected ? 'primary' : 'secondary'}
        align="center"
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
});

const NotificationRow = memo(function NotificationRow({
  icon, title, hint, value, onToggle, divider,
}: {
  icon: IconName;
  title: string;
  hint: string;
  value: boolean;
  onToggle: () => void;
  divider: boolean;
}) {
  const theme = useAppTheme();

  return (
    <ListRow
      icon={icon}
      iconTone="primary"
      title={title}
      subtitle={hint}
      divider={divider}
      showChevron={false}
      trailing={
        <Switch
          value={value}
          onValueChange={onToggle}
          accessibilityLabel={title}
          accessibilityHint={hint}
          trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primary }}
          thumbColor={Platform.OS === 'android' ? theme.colors.surface : undefined}
          ios_backgroundColor={theme.colors.borderStrong}
        />
      }
    />
  );
});

function SettingsSkeleton() {
  const theme = useAppTheme();
  return (
    <View style={{ gap: theme.spacing['2xl'], paddingTop: theme.spacing.lg }}>
      <Skeleton height={92} radius={theme.radii.lg} />
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ gap: theme.spacing.sm }}>
          <Skeleton width="40%" height={16} />
          <Skeleton height={140} radius={theme.radii.lg} />
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const theme = useAppTheme();
  const navigation = useNavigation<any>();
  const user = useAuth((s) => s.user);
  const { preference, setPreference } = useThemePreference();

  const [notifs, setNotifs] = useState<NotificationPrefs>(DEFAULT_NOTIFS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(NOTIF_STORAGE_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw);
        setNotifs({ ...DEFAULT_NOTIFS, ...parsed });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  const toggleNotif = useCallback((key: NotificationKey) => {
    setNotifs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      AsyncStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const onPickTheme = useCallback((p: ThemePreference) => setPreference(p), [setPreference]);
  const onPickLanguage = useCallback((lng: 'ar' | 'en') => { setAppLanguage(lng); }, []);
  const onOpenSubscription = useCallback(() => navigation.navigate('Subscription'), [navigation]);

  const onDeleteAccount = useCallback(() => {
    confirmDestructive({
      title: t('settings.deleteConfirmTitle'),
      body: t('settings.deleteConfirmBody'),
      confirmLabel: t('settings.deleteConfirmCta'),
      cancelLabel: t('common.cancel'),
      onConfirm: () => {
        // No DELETE /user/me endpoint exists yet, so the request goes to the
        // support inbox rather than silently doing nothing.
        const to = t('settings.supportEmail');
        const subject = encodeURIComponent(t('settings.deleteRequestSubject'));
        const body = encodeURIComponent(t('settings.deleteRequestBody', { email: user?.email ?? '' }));
        openUrl(`mailto:${to}?subject=${subject}&body=${body}`);
      },
    });
  }, [t, user?.email]);

  const isPremium = user?.plan === 'premium';
  const appVersion = (Constants.expoConfig?.version as string | undefined) ?? '—';

  if (!ready) {
    return (
      <Screen scroll edges={['bottom']} testID="settings-loading">
        <SettingsSkeleton />
      </Screen>
    );
  }

  return (
    <Screen scroll edges={['bottom']} testID="settings">
      {/* ------------------------------ Plan ------------------------------ */}
      <MotiView
        from={{ opacity: 0, translateY: 12 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: theme.motion.duration.normal }}
        style={{ marginTop: theme.spacing.lg }}
      >
        <Card
          variant="elevated"
          padding="md"
          onPress={onOpenSubscription}
          accessibilityLabel={isPremium ? t('settings.managePlan') : t('settings.upgradePlan')}
          accessibilityHint={t('subscription.subtitle')}
          style={isPremium ? { borderColor: theme.colors.accentBorder, borderWidth: 1.5 } : null}
        >
          <View style={[styles.row, { gap: theme.spacing.md }]}>
            <View
              style={[
                styles.planIcon,
                {
                  width: theme.layout.avatar.md,
                  height: theme.layout.avatar.md,
                  borderRadius: theme.radii.md,
                  backgroundColor: isPremium ? theme.colors.accentMuted : theme.colors.primaryMuted,
                },
              ]}
            >
              <Ionicons
                name={isPremium ? 'star' : 'sparkles'}
                size={theme.layout.icon.lg}
                color={isPremium ? theme.colors.accent : theme.colors.primary}
              />
            </View>

            <View style={styles.flex}>
              <Text role="caption" tone="muted">{t('settings.plan')}</Text>
              <Text role="h4" weight="bold" style={{ marginTop: theme.spacing.xxs }}>
                {isPremium ? t('settings.planPremium') : t('settings.planFree')}
              </Text>
            </View>

            <Badge
              label={isPremium ? t('settings.managePlan') : t('settings.upgradePlan')}
              tone={isPremium ? 'accent' : 'primary'}
              size="md"
            />
          </View>
        </Card>
      </MotiView>

      {/* --------------------------- Appearance --------------------------- */}
      <View style={{ marginTop: theme.spacing['2xl'] }}>
        <SectionHeader title={t('settings.appearance')} subtitle={t('settings.themeHint')} />
        <Card variant="outlined" padding="sm">
          <View
            style={[styles.tileRow, { gap: theme.spacing.sm }]}
            accessibilityRole="radiogroup"
            accessibilityLabel={t('settings.darkMode')}
          >
            <OptionTile
              icon="phone-portrait-outline"
              label={t('settings.system')}
              hint={t('settings.themeHint')}
              selected={preference === 'system'}
              onPress={() => onPickTheme('system')}
            />
            <OptionTile
              icon="sunny-outline"
              label={t('settings.light')}
              hint={t('settings.darkMode')}
              selected={preference === 'light'}
              onPress={() => onPickTheme('light')}
            />
            <OptionTile
              icon="moon-outline"
              label={t('settings.dark')}
              hint={t('settings.darkMode')}
              selected={preference === 'dark'}
              onPress={() => onPickTheme('dark')}
            />
          </View>
        </Card>
      </View>

      {/* ---------------------------- Language ---------------------------- */}
      <View style={{ marginTop: theme.spacing['2xl'] }}>
        <SectionHeader title={t('settings.language')} subtitle={t('settings.languageHint')} />
        <Card variant="outlined" padding="sm">
          <View
            style={[styles.tileRow, { gap: theme.spacing.sm }]}
            accessibilityRole="radiogroup"
            accessibilityLabel={t('settings.language')}
          >
            <OptionTile
              icon="language-outline"
              label={t('settings.languages.ar')}
              hint={t('settings.languageHint')}
              selected={i18n.language === 'ar'}
              onPress={() => onPickLanguage('ar')}
            />
            <OptionTile
              icon="globe-outline"
              label={t('settings.languages.en')}
              hint={t('settings.languageHint')}
              selected={i18n.language === 'en'}
              onPress={() => onPickLanguage('en')}
            />
          </View>
        </Card>
      </View>

      {/* -------------------------- Notifications ------------------------- */}
      <View style={{ marginTop: theme.spacing['2xl'] }}>
        <SectionHeader title={t('settings.notifications')} />
        <Card variant="outlined" padding="none">
          {NOTIFICATION_ROWS.map((row, i) => (
            <NotificationRow
              key={row.key}
              icon={row.icon}
              title={t(row.titleKey)}
              hint={t(row.hintKey)}
              value={notifs[row.key]}
              onToggle={() => toggleNotif(row.key)}
              divider={i < NOTIFICATION_ROWS.length - 1}
            />
          ))}
        </Card>
      </View>

      {/* ------------------------------ Legal ----------------------------- */}
      <View style={{ marginTop: theme.spacing['2xl'] }}>
        <SectionHeader title={t('settings.legal')} />
        <Card variant="outlined" padding="none">
          <ListRow
            icon="shield-checkmark-outline"
            title={t('settings.privacy')}
            divider
            onPress={() => openUrl(PRIVACY_URL)}
          />
          <ListRow
            icon="document-text-outline"
            title={t('settings.terms')}
            onPress={() => openUrl(TERMS_URL)}
          />
        </Card>
      </View>

      {/* ----------------------------- Support ---------------------------- */}
      <View style={{ marginTop: theme.spacing['2xl'] }}>
        <SectionHeader title={t('settings.support')} />
        <Card variant="outlined" padding="none">
          <ListRow
            icon="globe-outline"
            title={t('settings.website')}
            subtitle={t('settings.websiteValue')}
            divider
            onPress={() => openUrl(WEBSITE_URL)}
          />
          <ListRow
            icon="mail-outline"
            title={t('settings.email')}
            subtitle={t('settings.supportEmail')}
            divider
            onPress={() => openUrl(`mailto:${t('settings.supportEmail')}`)}
          />
          <ListRow
            icon="call-outline"
            title={t('settings.phone')}
            subtitle={t('settings.phoneValue')}
            onPress={() => openUrl(`tel:${t('settings.phoneValue')}`)}
          />
        </Card>
      </View>

      {/* ----------------------------- Account ---------------------------- */}
      <View style={{ marginTop: theme.spacing['2xl'] }}>
        <SectionHeader title={t('settings.account')} />
        <Card variant="outlined" padding="none">
          <ListRow
            icon="star-outline"
            iconTone="accent"
            title={isPremium ? t('settings.managePlan') : t('settings.upgradePlan')}
            subtitle={t('subscription.subtitle')}
            divider
            onPress={onOpenSubscription}
          />
          <ListRow
            icon="trash-outline"
            title={t('settings.deleteAccount')}
            subtitle={t('settings.deleteAccountHint')}
            danger
            showChevron={false}
            onPress={onDeleteAccount}
          />
        </Card>
      </View>

      {/* ----------------------------- Version ---------------------------- */}
      <View style={{ marginTop: theme.spacing['2xl'] }}>
        <Card variant="filled" padding="none">
          <ListRow
            icon="information-circle-outline"
            iconTone="neutral"
            title={t('settings.version')}
            showChevron={false}
            trailing={<Text role="caption" tone="muted">{appVersion}</Text>}
          />
        </Card>
        <Text role="micro" tone="muted" align="center" style={{ marginTop: theme.spacing.lg }}>
          {t('settings.builtBy')}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  planIcon: { alignItems: 'center', justifyContent: 'center' },
  tileRow: { flexDirection: 'row' },
  tile: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
