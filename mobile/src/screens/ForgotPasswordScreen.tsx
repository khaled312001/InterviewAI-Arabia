/**
 * Forgot password.
 *
 * The previous version fired `Alert.alert` and immediately `goBack()`, so on
 * the web build — where `Alert` is a no-op — the screen just vanished with no
 * feedback whatsoever. Success is now a real, persistent confirmation state
 * that names the address we sent to and offers the next step, with a resend
 * cooldown so an impatient user cannot hammer the endpoint into a 429.
 */

import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { Button, Card, EmptyState, Input, Screen, Text } from '../components';
import { useAppTheme, useDirection } from '../theme/useTheme';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESEND_COOLDOWN_SECONDS = 30;

function resetErrorKey(err: any): string {
  const status: number | undefined = err?.response?.status;
  if (status === 429) return 'auth.errors.tooManyAttempts';
  if (status === 400) return 'auth.errors.emailInvalid';
  if (status && status >= 500) return 'auth.errors.server';
  if (!err?.response) return 'auth.errors.network';
  return 'auth.errors.unexpected';
}

export function ForgotPasswordScreen({ navigation }: any) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const { chevronBack } = useDirection();

  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // One timeout per tick, torn down by the effect's own cleanup — no interval
  // ref to leak if the screen unmounts mid-countdown.
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const emailProblem = !email.trim()
    ? 'auth.errors.emailRequired'
    : !EMAIL_RE.test(email.trim())
      ? 'auth.errors.emailInvalid'
      : null;

  const submit = useCallback(async () => {
    setTouched(true);
    setFormError(null);
    if (emailProblem) return;

    const address = email.trim().toLowerCase();
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: address });
      setSentTo(address);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setFormError(t(resetErrorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [email, emailProblem, t]);

  // Both the header chevron and the "back to log in" buttons land here. A bare
  // goBack() silently no-ops when this screen is the only entry in the stack
  // (a refreshed /forgot-password URL on the web build), stranding the user
  // with no way out — so fall back to an explicit replace.
  const goBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.replace('Login');
  }, [navigation]);
  const editEmail = useCallback(() => { setSentTo(null); setFormError(null); }, []);

  const header = (
    <View style={[styles.headerRow, { paddingBottom: theme.spacing.sm }]}>
      <Pressable
        onPress={goBack}
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        hitSlop={theme.spacing.sm}
        style={({ pressed }) => [
          styles.backBtn,
          {
            width: theme.layout.touchTarget,
            height: theme.layout.touchTarget,
            borderRadius: theme.radii.md,
            opacity: pressed ? 0.6 : 1,
          },
        ]}
      >
        <Ionicons name={chevronBack} size={theme.layout.icon.lg} color={theme.colors.text} />
      </Pressable>
    </View>
  );

  /* ---------------- confirmation ---------------- */

  if (sentTo) {
    return (
      <Screen scroll edges={['top', 'bottom']} testID="forgot-password-sent">
        <StatusBar style="auto" />
        {header}

        <MotiView
          from={{ opacity: 0, translateY: theme.spacing.md }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: theme.motion.duration.normal }}
          style={{ gap: theme.spacing.lg }}
        >
          <EmptyState
            icon="mail-open-outline"
            title={t('auth.reset.sentTitle')}
            description={t('auth.reset.sentBody', { email: sentTo })}
          />

          <View style={{ gap: theme.spacing.md }}>
            <Button
              title={t('auth.reset.backToLogin')}
              onPress={goBack}
              size="lg"
              testID="forgot-password-back"
            />

            <Button
              title={cooldown > 0
                ? t('auth.reset.resendIn', { seconds: cooldown })
                : t('auth.reset.resend')}
              onPress={submit}
              variant="outline"
              disabled={cooldown > 0}
              loading={loading}
              accessibilityHint={t('auth.reset.spamHint')}
              testID="forgot-password-resend"
            />

            <Pressable
              onPress={editEmail}
              accessibilityRole="button"
              accessibilityLabel={t('auth.reset.changeEmail')}
              hitSlop={theme.spacing.sm}
              style={({ pressed }) => [
                styles.centerLink,
                { minHeight: theme.layout.touchTarget, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text role="bodySm" weight="bold" tone="primary">
                {t('auth.reset.changeEmail')}
              </Text>
            </Pressable>
          </View>

          <Text role="caption" tone="muted" align="center">
            {t('auth.reset.spamHint')}
          </Text>
        </MotiView>
      </Screen>
    );
  }

  /* ---------------- request form ---------------- */

  return (
    <Screen scroll keyboardAvoiding edges={['top', 'bottom']} testID="forgot-password">
      <StatusBar style="auto" />
      {header}

      <MotiView
        from={{ opacity: 0, translateY: theme.spacing.md }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: theme.motion.duration.normal }}
        style={{ gap: theme.spacing.xl, paddingTop: theme.spacing.lg }}
      >
        <View style={{ gap: theme.spacing.md }}>
          <View
            style={[
              styles.iconTile,
              {
                width: theme.layout.avatar.lg,
                height: theme.layout.avatar.lg,
                borderRadius: theme.radii.lg,
                backgroundColor: theme.colors.primaryMuted,
              },
            ]}
          >
            <Ionicons
              name="key-outline"
              size={theme.layout.icon.xl}
              color={theme.colors.primary}
            />
          </View>

          <View style={{ gap: theme.spacing.xs }}>
            <Text role="h2" weight="bold" accessibilityRole="header">
              {t('auth.resetTitle')}
            </Text>
            <Text role="body" tone="secondary">{t('auth.resetDescription')}</Text>
          </View>
        </View>

        <Card variant="elevated" padding="lg">
          <View style={{ gap: theme.spacing.lg }}>
            {formError ? (
              <View
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={[
                  styles.banner,
                  {
                    backgroundColor: theme.colors.dangerMuted,
                    borderRadius: theme.radii.sm,
                    padding: theme.spacing.md,
                    gap: theme.spacing.sm,
                  },
                ]}
              >
                <Ionicons
                  name="alert-circle"
                  size={theme.layout.icon.md}
                  color={theme.colors.danger}
                />
                <Text role="bodySm" tone="danger" flex>{formError}</Text>
              </View>
            ) : null}

            <Input
              label={t('auth.email')}
              placeholder={t('auth.emailPlaceholder')}
              iconLeft="mail-outline"
              value={email}
              onChangeText={(v) => { setEmail(v); if (formError) setFormError(null); }}
              onBlur={() => setTouched(true)}
              error={touched && emailProblem ? t(emailProblem) : undefined}
              keyboardType="email-address"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="send"
              onSubmitEditing={submit}
              required
              testID="forgot-password-email"
            />

            <Button
              title={t('auth.reset.submit')}
              onPress={submit}
              loading={loading}
              size="lg"
              testID="forgot-password-submit"
            />
          </View>
        </Card>

        <Pressable
          onPress={goBack}
          accessibilityRole="link"
          accessibilityLabel={t('auth.reset.backToLogin')}
          hitSlop={theme.spacing.sm}
          style={({ pressed }) => [
            styles.centerLink,
            { minHeight: theme.layout.touchTarget, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text role="bodySm" weight="bold" tone="primary">
            {t('auth.reset.backToLogin')}
          </Text>
        </Pressable>
      </MotiView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  backBtn: { alignItems: 'center', justifyContent: 'center' },
  iconTile: { alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'flex-start' },
  centerLink: { alignItems: 'center', justifyContent: 'center' },
});
