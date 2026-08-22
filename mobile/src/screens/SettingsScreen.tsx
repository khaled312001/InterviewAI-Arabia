/**
 * SettingsScreen — grouped preferences.
 *
 * Structure follows the "one card per concern" rule: appearance, language,
 * notifications, legal, support, account. Every row is a real `ListRow`, so
 * touch targets, chevron direction, and pressed states are consistent instead
 * of being re-derived per screen (the previous version shipped chips with a
 * 34px target and hardcoded Arabic labels that never translated).
 *
 * The master "إشعارات" switch is real: it registers or detaches this device's
 * FCM token against `/user/push/*`, and it is one of only two places in the app
 * allowed to raise the system permission prompt (see src/push/registration.ts
 * for why that matters). It shows the *effective* state — a stored preference
 * of "on" against a permission revoked in system settings reads as off, because
 * that is what the user will actually experience.
 *
 * The three topic switches below it are still local-only — the API has no
 * per-topic endpoint yet — so they persist per device via AsyncStorage.
 */

import { memo, useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Pressable, Switch, Linking, Platform, Alert, AppState, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

import { setAppLanguage } from '../i18n';
import { useAuth } from '../store/auth';
import { disablePush, enablePush, isPushSupported, pushSnapshot, type PushSnapshot } from '../push';
import { useAppTheme, useThemePreference } from '../theme/useTheme';
import { Screen, Text, Card, Badge, ListRow, SectionHeader, Skeleton, Button, Input } from '../components';
import { api } from '../api/client';

/* Public pages owned by the marketing site — not localisable copy.
 * These MUST be Interprova's own policies, not Barmagly's: barmagly.tech/privacy
 * is the agency's policy and says nothing about interview recordings, AI
 * providers or this app's data. Google Play compares the policy against the
 * app's actual behaviour, and `/privacy#delete-account` is the deletion URL
 * declared in the Data safety form. */
const WEBSITE_URL = 'https://interview.khaledahmed.net';
const PRIVACY_URL = 'https://interview.khaledahmed.net/privacy';
const TERMS_URL = 'https://interview.khaledahmed.net/terms';

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

  /* ---- push ---- */

  // `supported` is known synchronously, so the row is in the layout from the
  // first frame — reading it from the async snapshot instead makes the whole
  // notifications card jump a row taller once the promise lands.
  const [push, setPush] = useState<PushSnapshot>({
    supported: isPushSupported, enabled: false, permission: 'undetermined',
  });
  const [pushBusy, setPushBusy] = useState(false);

  /**
   * Re-read on mount and on every return to the foreground.
   *
   * Focus is not enough: sending the user to system settings to un-block
   * notifications never unmounts or re-focuses this screen, so without the
   * AppState listener the switch still reads "off" after they came back having
   * turned it on — and they conclude the app is broken.
   */
  useEffect(() => {
    let cancelled = false;
    const read = () => {
      pushSnapshot()
        .then((snapshot) => { if (!cancelled) setPush(snapshot); })
        .catch(() => {});
    };
    read();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') read();
    });
    return () => { cancelled = true; sub.remove(); };
  }, []);

  const onTogglePush = useCallback(async () => {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      if (push.enabled) {
        await disablePush();
        return;
      }
      const result = await enablePush();
      if (result.ok) return;
      if (result.permission === 'blocked') {
        // The system prompt is spent. Nothing in this app can raise it again,
        // so the only honest response is to point at the one place that can.
        Alert.alert(t('settings.pushBlockedTitle'), t('settings.pushBlockedBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('settings.pushOpenSettings'),
            onPress: () => { Linking.openSettings().catch(() => {}); },
          },
        ]);
      } else if (result.reason === 'network' || result.reason === 'no-token') {
        // Offline, or the device could not be issued a token. Both are
        // recoverable and both are worth saying out loud — a switch that snaps
        // back with no explanation reads as a bug.
        Alert.alert(t('settings.notifications'), t('settings.pushFailed'));
      }
    } finally {
      // Always from the source of truth, never from the tap: the OS gets the
      // final say on whether this switch is on.
      setPush(await pushSnapshot());
      setPushBusy(false);
    }
  }, [push.enabled, pushBusy, t]);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const logout = useAuth((st) => st.logout);

  const onPickTheme = useCallback((p: ThemePreference) => setPreference(p), [setPreference]);
  const onPickLanguage = useCallback((lng: 'ar' | 'en') => { setAppLanguage(lng); }, []);
  const onOpenSubscription = useCallback(() => navigation.navigate('Subscription'), [navigation]);

  /**
   * Account deletion. Google Play requires this to be reachable *inside* the
   * app, not only as a support email.
   *
   * Two steps on purpose: a destructive confirm, then the password. Re-asking
   * for the password means a phone left unlocked on a desk cannot erase
   * someone's history, and it is the same check the API enforces.
   */
  const onDeleteAccount = useCallback(() => {
    confirmDestructive({
      title: t('settings.deleteConfirmTitle'),
      body: t('settings.deleteConfirmBody'),
      confirmLabel: t('settings.deleteConfirmCta'),
      cancelLabel: t('common.cancel'),
      onConfirm: () => {
        setDeletePassword('');
        setDeleteError(null);
        setDeleteOpen(true);
      },
    });
  }, [t]);

  /**
   * An account created through Google has no password to re-enter, so asking
   * for one would make it undeletable — and Play requires in-app deletion.
   * The server draws the same distinction and still demands the password from
   * every account that has one; this only removes a prompt that cannot be
   * answered. `!== false` on purpose: an older backend omits the field, and
   * the safe reading of "unknown" is "ask".
   */
  const needsPassword = user?.hasPassword !== false;

  const submitDeletion = useCallback(async () => {
    if (needsPassword && !deletePassword) {
      setDeleteError(t('settings.deletePasswordRequired'));
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      // axios sends a body on DELETE only under `data`.
      await api.delete('/user/me', { data: needsPassword ? { password: deletePassword } : {} });
      setDeleteOpen(false);
      // The account is gone; the stored tokens now authenticate nothing.
      await logout();
    } catch (err: any) {
      const code = err?.response?.data?.code;
      setDeleteError(
        code === 'BAD_PASSWORD'
          ? t('settings.deleteWrongPassword')
          : err?.response?.data?.error || t('settings.deleteFailed'),
      );
    } finally {
      setDeleting(false);
    }
  }, [deletePassword, needsPassword, logout, t]);

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
          {/* Hidden rather than disabled on web: browser push needs a service
              worker and a VAPID key this deployment does not have, and the
              backend only speaks FCM device tokens. A switch that can never do
              anything is worse than no switch. */}
          {push.supported ? (
            <NotificationRow
              icon="notifications-outline"
              title={t('settings.pushEnabled')}
              hint={t('settings.pushEnabledHint')}
              value={push.enabled}
              onToggle={() => { void onTogglePush(); }}
              divider
            />
          ) : null}
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

      <Modal
        visible={deleteOpen}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!deleting) setDeleteOpen(false); }}
      >
        <View style={[styles.modalScrim, { padding: theme.spacing.lg }]}>
          <Card
            style={{ width: '100%', maxWidth: 420, gap: theme.spacing.md }}
          >
            <Text role="h4" weight="bold">{t('settings.deleteConfirmTitle')}</Text>
            <Text role="bodySm" tone="muted">
              {needsPassword ? t('settings.deletePasswordPrompt') : t('settings.deleteNoPasswordPrompt')}
            </Text>

            {needsPassword ? (
              <Input
                label={t('auth.password')}
                value={deletePassword}
                onChangeText={(v) => { setDeletePassword(v); setDeleteError(null); }}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="current-password"
                editable={!deleting}
                error={deleteError ?? undefined}
                testID="delete-password"
              />
            ) : deleteError ? (
              <Text role="bodySm" tone="danger">{deleteError}</Text>
            ) : null}

            <View style={{ gap: theme.spacing.sm }}>
              <Button
                title={t('settings.deleteConfirmCta')}
                variant="danger"
                loading={deleting}
                onPress={() => { void submitDeletion(); }}
                testID="delete-submit"
              />
              <Button
                title={t('common.cancel')}
                variant="ghost"
                disabled={deleting}
                onPress={() => setDeleteOpen(false)}
              />
            </View>
          </Card>
        </View>
      </Modal>

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
  modalScrim: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6,11,22,0.66)' },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  planIcon: { alignItems: 'center', justifyContent: 'center' },
  tileRow: { flexDirection: 'row' },
  tile: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
