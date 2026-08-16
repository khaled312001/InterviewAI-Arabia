/**
 * Sign up — the conversion screen.
 *
 * Same validation/error model as LoginScreen (blur-time inline errors, an
 * in-page banner for server failures) plus a live password-strength meter, so
 * the user learns the 8-character rule while typing rather than by being
 * rejected. The old version discovered it with an `Alert` after submit, which
 * never rendered at all on the web build.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../store/auth';
import { Badge, Button, Card, Input, Logo, Screen, Text } from '../components';
import { useAppTheme, useDirection, useResponsive } from '../theme/useTheme';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'SignUp'>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 8;
const MIN_NAME = 2;
const STRENGTH_STEPS = 4;

function authErrorKey(err: any): string {
  const status: number | undefined = err?.response?.status;
  if (status === 409) return 'auth.errors.emailTaken';
  if (status === 429) return 'auth.errors.tooManyAttempts';
  if (status === 401) return 'auth.errors.invalidCredentials';
  if (status === 400) return 'auth.errors.checkFields';
  if (status && status >= 500) return 'auth.errors.server';
  if (!err?.response) return 'auth.errors.network';
  return 'auth.errors.unexpected';
}

/** 0 = empty, 1 = weak … 4 = strong. Length first, then character variety. */
function passwordScore(pw: string): number {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= MIN_PASSWORD) score += 1;
  if (pw.length >= 12) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^\p{L}\p{N}]/u.test(pw)) score += 1;
  return Math.max(1, Math.min(STRENGTH_STEPS, score));
}

export function SignUpScreen({ navigation }: Props) {
  const { t, i18n } = useTranslation();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { maxWidth, screenPadding } = useResponsive();
  const { chevronBack } = useDirection();

  const register = useAuth((s) => s.register);
  const loading = useAuth((s) => s.loading);

  const nameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState({ name: false, email: false, password: false });
  const [formError, setFormError] = useState<string | null>(null);

  const nameProblem = !name.trim()
    ? 'auth.errors.nameRequired'
    : name.trim().length < MIN_NAME
      ? 'auth.errors.nameShort'
      : null;
  const emailProblem = !email.trim()
    ? 'auth.errors.emailRequired'
    : !EMAIL_RE.test(email.trim())
      ? 'auth.errors.emailInvalid'
      : null;
  const passwordProblem = !password
    ? 'auth.errors.passwordRequired'
    : password.length < MIN_PASSWORD
      ? 'auth.errors.passwordShort'
      : null;

  const score = useMemo(() => passwordScore(password), [password]);
  const strength = useMemo(() => {
    const spec = [
      { label: 'auth.strength.weak', color: theme.colors.danger },
      { label: 'auth.strength.fair', color: theme.colors.warning },
      { label: 'auth.strength.good', color: theme.colors.success },
      { label: 'auth.strength.strong', color: theme.colors.success },
    ];
    return spec[Math.max(0, score - 1)];
  }, [score, theme.colors.danger, theme.colors.success, theme.colors.warning]);

  const onSubmit = useCallback(async () => {
    setTouched({ name: true, email: true, password: true });
    setFormError(null);

    if (nameProblem) { nameRef.current?.focus(); return; }
    if (emailProblem) { emailRef.current?.focus(); return; }
    if (passwordProblem) { passwordRef.current?.focus(); return; }

    try {
      await register(
        email.trim().toLowerCase(),
        password,
        name.trim(),
        i18n.language === 'en' ? 'en' : 'ar',
      );
    } catch (err) {
      setFormError(t(authErrorKey(err)));
    }
  }, [email, emailProblem, i18n.language, name, nameProblem, password, passwordProblem, register, t]);

  const goLogin = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.replace('Login');
  }, [navigation]);
  const goBack = useCallback(() => navigation.goBack(), [navigation]);

  const canGoBack = navigation.canGoBack();
  const clearBanner = useCallback(() => setFormError((e) => (e ? null : e)), []);

  const hero = (
    <LinearGradient
      colors={[theme.gradients.hero[0], theme.gradients.hero[1]]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.hero,
        {
          paddingTop: insets.top + theme.spacing.lg,
          paddingBottom: theme.spacing['4xl'],
          borderBottomLeftRadius: theme.radii['2xl'],
          borderBottomRightRadius: theme.radii['2xl'],
        },
      ]}
    >
      <View
        pointerEvents="none"
        style={[
          styles.bloom,
          {
            width: theme.layout.maxContentWidth * 0.34,
            height: theme.layout.maxContentWidth * 0.34,
            borderRadius: theme.radii.pill,
            backgroundColor: theme.colors.textOnBrand,
            top: -theme.spacing['5xl'],
            start: -theme.spacing['4xl'],
          },
        ]}
      />

      <View
        style={[
          styles.heroInner,
          { maxWidth, paddingHorizontal: screenPadding, gap: theme.spacing.md },
        ]}
      >
        {canGoBack ? (
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
            <Ionicons
              name={chevronBack}
              size={theme.layout.icon.lg}
              color={theme.colors.textOnBrand}
            />
          </Pressable>
        ) : null}

        <MotiView
          from={{ opacity: 0, translateY: -theme.spacing.sm }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: theme.motion.duration.slow }}
          style={[styles.brand, { gap: theme.spacing.md }]}
        >
          <View
            style={[
              styles.logoTile,
              {
                borderRadius: theme.radii.lg,
                backgroundColor: theme.colors.surface,
                padding: theme.spacing.sm,
              },
              theme.shadow.lg,
            ]}
          >
            <Logo size={theme.layout.avatar.md} />
          </View>

          <Text role="h3" weight="bold" tone="onBrand" align="center">
            {t('app.name')}
          </Text>

          <Badge label={t('auth.freeBadge')} tone="onDark" size="md" icon="shield-checkmark" />
        </MotiView>
      </View>
    </LinearGradient>
  );

  return (
    <Screen scroll keyboardAvoiding edges={['bottom']} header={hero} testID="signup">
      <StatusBar style="light" />

      <MotiView
        from={{ opacity: 0, translateY: theme.spacing.lg }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: theme.motion.duration.normal, delay: theme.motion.stagger * 2 }}
        style={{ marginTop: -theme.spacing['3xl'] }}
      >
        <Card variant="elevated" padding="lg">
          <View style={{ gap: theme.spacing.xxs, marginBottom: theme.spacing.xl }}>
            <Text role="h3" weight="bold" accessibilityRole="header">
              {t('auth.registerTitle')}
            </Text>
            <Text role="bodySm" tone="muted">{t('auth.registerSubtitle')}</Text>
          </View>

          {formError ? (
            <MotiView
              from={{ opacity: 0, translateY: -theme.spacing.xs }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: theme.motion.duration.fast }}
              style={{ marginBottom: theme.spacing.lg }}
            >
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
            </MotiView>
          ) : null}

          <View style={{ gap: theme.spacing.lg }}>
            <Input
              ref={nameRef}
              label={t('auth.name')}
              placeholder={t('auth.namePlaceholder')}
              iconLeft="person-outline"
              value={name}
              onChangeText={(v) => { setName(v); clearBanner(); }}
              onBlur={() => setTouched((s) => ({ ...s, name: true }))}
              error={touched.name && nameProblem ? t(nameProblem) : undefined}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => emailRef.current?.focus()}
              required
              testID="signup-name"
            />

            <Input
              ref={emailRef}
              label={t('auth.email')}
              placeholder={t('auth.emailPlaceholder')}
              iconLeft="mail-outline"
              value={email}
              onChangeText={(v) => { setEmail(v); clearBanner(); }}
              onBlur={() => setTouched((s) => ({ ...s, email: true }))}
              error={touched.email && emailProblem ? t(emailProblem) : undefined}
              keyboardType="email-address"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => passwordRef.current?.focus()}
              required
              testID="signup-email"
            />

            <View style={{ gap: theme.spacing.sm }}>
              <Input
                ref={passwordRef}
                label={t('auth.password')}
                placeholder={t('auth.passwordPlaceholder')}
                iconLeft="lock-closed-outline"
                passwordToggle
                value={password}
                onChangeText={(v) => { setPassword(v); clearBanner(); }}
                onBlur={() => setTouched((s) => ({ ...s, password: true }))}
                error={touched.password && passwordProblem ? t(passwordProblem) : undefined}
                helperText={t('auth.passwordHint')}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="go"
                onSubmitEditing={onSubmit}
                required
                testID="signup-password"
              />

              {password ? (
                <View
                  style={{ gap: theme.spacing.xs }}
                  // Without `accessible`, iOS treats this as a plain container
                  // and the label is never announced — the four bars would read
                  // as four anonymous views instead of one strength readout.
                  accessible
                  accessibilityLabel={`${t('auth.strengthLabel')}: ${t(strength.label)}`}
                >
                  <View style={[styles.meter, { gap: theme.spacing.xs }]}>
                    {Array.from({ length: STRENGTH_STEPS }).map((_, i) => (
                      <MotiView
                        key={i}
                        animate={{ backgroundColor: i < score ? strength.color : theme.colors.border }}
                        transition={{ type: 'timing', duration: theme.motion.duration.fast }}
                        style={{
                          flex: 1,
                          height: theme.spacing.xs,
                          borderRadius: theme.radii.pill,
                        }}
                      />
                    ))}
                  </View>
                  <View style={styles.meterRow}>
                    <Text role="micro" tone="muted" flex>{t('auth.strengthLabel')}</Text>
                    <Text role="micro" weight="bold" tone="inherit" style={{ color: strength.color }}>
                      {t(strength.label)}
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>

            <Button
              title={t('auth.register')}
              onPress={onSubmit}
              loading={loading}
              size="lg"
              accessibilityLabel={t('auth.register')}
              testID="signup-submit"
            />

            <Text role="micro" tone="muted" align="center">{t('auth.terms')}</Text>
          </View>

          <View
            style={[
              styles.divider,
              {
                height: theme.layout.hairline,
                backgroundColor: theme.colors.divider,
                marginVertical: theme.spacing.xl,
              },
            ]}
          />

          <View style={[styles.footerRow, { gap: theme.spacing.xs, minHeight: theme.layout.touchTarget }]}>
            <Text role="bodySm" tone="muted">{t('auth.hasAccountPrefix')}</Text>
            <Pressable
              onPress={goLogin}
              accessibilityRole="link"
              accessibilityLabel={t('auth.signInInstead')}
              hitSlop={theme.spacing.sm}
              style={({ pressed }) => [
                styles.footerLink,
                { minHeight: theme.layout.touchTarget, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text role="bodySm" weight="bold" tone="primary">{t('auth.signInInstead')}</Text>
            </Pressable>
          </View>
        </Card>
      </MotiView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { overflow: 'hidden' },
  bloom: { position: 'absolute', opacity: 0.1 },
  heroInner: { width: '100%', alignSelf: 'center' },
  backBtn: { alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  brand: { alignItems: 'center' },
  logoTile: { alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'flex-start' },
  meter: { flexDirection: 'row', alignItems: 'center' },
  meterRow: { flexDirection: 'row', alignItems: 'center' },
  // Centres the label inside the 48px target without moving it optically.
  footerLink: { justifyContent: 'center' },
  divider: { width: '100%' },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
});
