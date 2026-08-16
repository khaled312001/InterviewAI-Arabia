import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, Modal } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';

import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { setAppLanguage } from '../i18n';
import { useAppTheme } from '../theme/useTheme';
import {
  Screen, Text, Card, Badge, Button, Input, ListRow, SectionHeader,
} from '../components';
import { formatMonthYear } from './mainShared';

type Lang = 'ar' | 'en';

/**
 * How long the "changes saved" badge stays up.
 *
 * Not a motion token: `theme.motion.duration.*` describes how long an
 * animation runs (90–520ms), not how long a confirmation dwells before it is
 * dismissed. There is no dwell/toast-duration token yet — see the report.
 */
const SAVED_BADGE_MS = 2600;

/** `GET /user/me` returns createdAt; the store's AppUser type predates it. */
type ProfileUser = {
  id: string; email: string; name: string;
  language: Lang; plan: 'free' | 'premium';
  dailyQuestionsUsed: number;
  createdAt?: string;
};

/* ------------------------------------------------------------------ *
 * Language selector
 * ------------------------------------------------------------------ */

function LanguageChip({
  label, active, value, onPress,
}: { label: string; active: boolean; value: Lang; onPress: (v: Lang) => void }) {
  const theme = useAppTheme();
  const press = useCallback(() => onPress(value), [onPress, value]);

  return (
    <Pressable
      onPress={press}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={[styles.chipTap, { minHeight: theme.layout.touchTarget }]}
    >
      {({ pressed }: { pressed: boolean }) => (
        <View
          style={[
            styles.chip,
            {
              height: theme.layout.control.sm,
              paddingHorizontal: theme.spacing.lg,
              borderRadius: theme.radii.pill,
              borderWidth: theme.layout.hairline,
              borderColor: active ? theme.colors.primary : theme.colors.border,
              backgroundColor: active ? theme.colors.primaryMuted : theme.colors.surface,
              opacity: pressed ? 0.75 : 1,
            },
          ]}
        >
          <Text role="bodySm" weight="bold" tone={active ? 'primary' : 'secondary'}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ *
 * Destructive confirm
 *
 * `Alert.alert` renders through `window.alert` on react-native-web, which has
 * no buttons — so the destructive callback never fired and logout silently did
 * nothing on the web build. A real Modal behaves identically on both targets.
 * ------------------------------------------------------------------ */

function ConfirmDialog({
  visible, title, body, confirmLabel, onConfirm, onCancel,
}: {
  visible: boolean; title: string; body: string; confirmLabel: string;
  onConfirm: () => void; onCancel: () => void;
}) {
  const theme = useAppTheme();
  const { t } = useTranslation();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      accessibilityViewIsModal
    >
      <Pressable
        style={[styles.overlay, { backgroundColor: theme.colors.overlay, padding: theme.spacing.xl }]}
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel={t('common.cancel')}
      >
        {/* Swallow taps inside the sheet so only the backdrop dismisses.
            `accessible={false}` is required: Pressable defaults it to true,
            which would collapse the whole dialog — title, body, confirm and
            cancel — into one unlabelled accessibility node and make the
            buttons unreachable by a screen reader. */}
        <Pressable
          onPress={() => {}}
          accessible={false}
          importantForAccessibility="no"
          // No dialog-width token exists yet (see report); half the content cap
          // is the closest sanctioned value rather than an invented number.
          style={[styles.dialogWrap, { maxWidth: theme.layout.maxContentWidth / 2 }]}
        >
          <MotiView
            from={{ opacity: 0, translateY: theme.spacing.lg, scale: 0.98 }}
            animate={{ opacity: 1, translateY: 0, scale: 1 }}
            transition={{ type: 'timing', duration: theme.motion.duration.fast }}
          >
            <Card padding="lg" style={{ gap: theme.spacing.md }}>
              <View
                style={[
                  styles.dialogIcon,
                  {
                    width: theme.layout.avatar.md,
                    height: theme.layout.avatar.md,
                    borderRadius: theme.layout.avatar.md / 2,
                    backgroundColor: theme.colors.dangerMuted,
                  },
                ]}
              >
                <Ionicons
                  name="log-out-outline"
                  size={theme.layout.icon.lg}
                  color={theme.colors.danger}
                />
              </View>

              <Text role="h3" weight="bold">{title}</Text>
              <Text role="bodySm" tone="muted">{body}</Text>

              <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
                <Button title={confirmLabel} variant="danger" onPress={onConfirm} />
                <Button title={t('common.cancel')} variant="ghost" onPress={onCancel} />
              </View>
            </Card>
          </MotiView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export function ProfileScreen({ navigation }: any) {
  const theme = useAppTheme();
  const { t, i18n } = useTranslation();

  const user = useAuth((s) => s.user) as ProfileUser | null;
  const logout = useAuth((s) => s.logout);
  const refreshMe = useAuth((s) => s.refreshMe);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name ?? '');
  const [language, setLanguage] = useState<Lang>((user?.language as Lang) ?? 'ar');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  const isPremium = user?.plan === 'premium';
  const initial = (user?.name?.trim()?.[0] ?? '?').toUpperCase();
  const memberSince = useMemo(
    () => formatMonthYear(user?.createdAt, i18n.language),
    [user?.createdAt, i18n.language],
  );

  const openEditor = useCallback(() => {
    setName(user?.name ?? '');
    setLanguage((user?.language as Lang) ?? 'ar');
    setError(null);
    setEditing(true);
  }, [user?.name, user?.language]);

  const closeEditor = useCallback(() => {
    setEditing(false);
    setError(null);
  }, []);

  const onSave = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError(t('profile.nameTooShort'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await api.patch('/user/me', { name: trimmed, language });
      await refreshMe();
      if (language !== i18n.language) await setAppLanguage(language);

      setEditing(false);
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), SAVED_BADGE_MS);
    } catch {
      setError(t('profile.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [name, language, refreshMe, i18n.language, t]);

  const onConfirmLogout = useCallback(() => {
    setConfirming(false);
    logout();
  }, [logout]);

  const goSubscription = useCallback(() => navigation.navigate('Subscription'), [navigation]);
  const goSettings = useCallback(() => navigation.navigate('Settings'), [navigation]);

  return (
    <Screen
      scroll
      contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.xl }}
      // Rendered outside the ScrollView: react-native-web's Modal lays out in
      // place, and a fixed overlay nested in a scroller misbehaves on web.
      footer={
        <ConfirmDialog
          visible={confirming}
          title={t('profile.logoutTitle')}
          body={t('profile.logoutBody')}
          confirmLabel={t('profile.logout')}
          onConfirm={onConfirmLogout}
          onCancel={() => setConfirming(false)}
        />
      }
    >
      {/* ---------------------------- identity --------------------------- */}
      <Card padding="lg">
        <View style={[styles.row, { gap: theme.spacing.lg }]}>
          <View
            style={[
              styles.avatar,
              {
                width: theme.layout.avatar.lg,
                height: theme.layout.avatar.lg,
                borderRadius: theme.layout.avatar.lg / 2,
                backgroundColor: theme.colors.primaryMuted,
              },
            ]}
          >
            <Text role="h2" weight="bold" tone="primary">{initial}</Text>
          </View>

          <View style={[styles.grow, { gap: theme.spacing.xxs }]}>
            <Text role="h3" weight="bold" numberOfLines={1}>{user?.name ?? '—'}</Text>
            <Text role="bodySm" tone="muted" numberOfLines={1}>{user?.email ?? ''}</Text>
            {memberSince ? (
              <Text role="caption" tone="muted" numberOfLines={1}>
                {t('profile.memberSince', { date: memberSince })}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={[styles.row, { gap: theme.spacing.sm, marginTop: theme.spacing.lg }]}>
          <Badge
            tone={isPremium ? 'accent' : 'neutral'}
            size="md"
            icon={isPremium ? 'star' : undefined}
            label={isPremium ? t('plan.premium') : t('plan.free')}
          />
          {saved ? (
            <MotiView
              from={{ opacity: 0, translateY: -theme.spacing.xs }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: theme.motion.duration.fast }}
            >
              <Badge tone="success" icon="checkmark-circle" label={t('profile.saved')} />
            </MotiView>
          ) : null}
          <View style={styles.grow} />
          {!editing ? (
            <Button
              title={t('profile.edit')}
              onPress={openEditor}
              variant="secondary"
              size="sm"
              fullWidth={false}
              accessibilityHint={t('profile.editSubtitle')}
            />
          ) : null}
        </View>
      </Card>

      {/* ----------------------------- editor ---------------------------- */}
      {editing ? (
        <MotiView
          from={{ opacity: 0, translateY: -theme.spacing.sm }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: theme.motion.duration.normal }}
        >
          <Card padding="lg" style={{ gap: theme.spacing.lg }}>
            <View>
              <Text role="h4" weight="bold">{t('profile.editTitle')}</Text>
              <Text role="caption" tone="muted" style={{ marginTop: theme.spacing.xxs }}>
                {t('profile.editSubtitle')}
              </Text>
            </View>

            <Input
              label={t('auth.name')}
              value={name}
              onChangeText={setName}
              iconLeft="person-outline"
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={onSave}
              editable={!saving}
              error={error ?? undefined}
              maxLength={120}
            />

            <View style={{ gap: theme.spacing.sm }}>
              <Text role="bodySm" weight="bold" tone="secondary">{t('profile.language')}</Text>
              <View
                style={[styles.row, { gap: theme.spacing.sm }]}
                accessibilityRole="radiogroup"
                accessibilityLabel={t('profile.language')}
              >
                {/* Endonyms come from the resource files so the label set stays
                    in one place rather than being inlined per screen. */}
                <LanguageChip
                  label={t('settings.languages.ar')}
                  value="ar"
                  active={language === 'ar'}
                  onPress={setLanguage}
                />
                <LanguageChip
                  label={t('settings.languages.en')}
                  value="en"
                  active={language === 'en'}
                  onPress={setLanguage}
                />
              </View>
            </View>

            <View style={{ gap: theme.spacing.sm }}>
              <Button title={t('common.save')} onPress={onSave} loading={saving} />
              <Button
                title={t('common.cancel')}
                onPress={closeEditor}
                variant="ghost"
                disabled={saving}
              />
            </View>
          </Card>
        </MotiView>
      ) : null}

      {/* ------------------------------ plan ----------------------------- */}
      <View>
        <SectionHeader title={t('home.yourPlan')} />
        {isPremium ? (
          <Card padding="lg">
            <View style={[styles.row, { gap: theme.spacing.md }]}>
              <View
                style={[
                  styles.avatar,
                  {
                    width: theme.layout.avatar.md,
                    height: theme.layout.avatar.md,
                    borderRadius: theme.radii.md,
                    backgroundColor: theme.colors.accentMuted,
                  },
                ]}
              >
                <Ionicons name="star" size={theme.layout.icon.md} color={theme.colors.accentText} />
              </View>
              <View style={styles.grow}>
                <Text role="body" weight="bold">{t('plan.premium')}</Text>
                <Text role="caption" tone="muted">{t('plan.premiumTagline')}</Text>
              </View>
              <Button
                title={t('plan.manage')}
                onPress={goSubscription}
                variant="outline"
                size="sm"
                fullWidth={false}
              />
            </View>
          </Card>
        ) : (
          <Card padding="lg" style={{ gap: theme.spacing.md }}>
            <View style={[styles.row, { gap: theme.spacing.md }]}>
              <View
                style={[
                  styles.avatar,
                  {
                    width: theme.layout.avatar.md,
                    height: theme.layout.avatar.md,
                    borderRadius: theme.radii.md,
                    backgroundColor: theme.colors.accentMuted,
                  },
                ]}
              >
                <Ionicons
                  name="sparkles"
                  size={theme.layout.icon.md}
                  color={theme.colors.accentText}
                />
              </View>
              <View style={styles.grow}>
                <Text role="body" weight="bold">{t('plan.unlockTitle')}</Text>
                <Text role="caption" tone="muted">{t('plan.unlockBody')}</Text>
              </View>
            </View>
            <Button title={t('plan.upgradeLong')} onPress={goSubscription} variant="accent" />
          </Card>
        )}
      </View>

      {/* ----------------------------- account --------------------------- */}
      <View>
        <SectionHeader title={t('profile.account')} />
        <Card padding="none">
          <ListRow
            icon="star-outline"
            iconTone="accent"
            title={t('subscription.title')}
            onPress={goSubscription}
            divider
          />
          <ListRow
            icon="settings-outline"
            title={t('settings.title')}
            onPress={goSettings}
            divider
          />
          <ListRow
            icon="log-out-outline"
            title={t('profile.logout')}
            danger
            showChevron={false}
            onPress={() => setConfirming(true)}
          />
        </Card>
      </View>

      <Text role="caption" tone="muted" align="center">{t('profile.company')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  chipTap: { justifyContent: 'center' },
  chip: { alignItems: 'center', justifyContent: 'center' },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dialogWrap: { width: '100%' },
  dialogIcon: { alignItems: 'center', justifyContent: 'center' },
});
