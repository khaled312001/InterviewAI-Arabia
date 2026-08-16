/**
 * Log in.
 *
 * The old version validated nothing, surfaced backend failures through
 * `Alert.alert` (which is a no-op on react-native-web, so the web build simply
 * swallowed every login error), and hardcoded its Arabic copy. This version
 * validates on blur, keeps the error next to the field that caused it, and
 * renders server failures as an in-page banner mapped to friendly copy.
 */

import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../store/auth';
import { Button, Card, Input, Logo, Screen, Text } from '../components';
import { useAppTheme, useDirection, useResponsive } from '../theme/useTheme';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

/** Deliberately permissive — the server is the authority, this only catches typos. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 8;

/**
 * Maps a failed request onto an i18n key. Axios reports network failures with
 * no `response` at all, which the old code rendered as the raw string
 * "Network Error" in the middle of an Arabic screen.
 */
function authErrorKey(err: any): string {
  const status: number | undefined = err?.response?.status;
  if (status === 401) return 'auth.errors.invalidCredentials';
  if (status === 409) return 'auth.errors.emailTaken';
  if (status === 429) return 'auth.errors.tooManyAttempts';
  if (status === 400) return 'auth.errors.checkFields';
  if (status && status >= 500) return 'auth.errors.server';
  if (!err?.response) return 'auth.errors.network';
  return 'auth.errors.unexpected';
}

export function LoginScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { maxWidth, screenPadding } = useResponsive();
  const { chevronBack } = useDirection();

  const login = useAuth((s) => s.login);
  const loading = useAuth((s) => s.loading);

  const passwordRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState({ email: false, password: false });
  const [formError, setFormError] = useState<string | null>(null);

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

  const emailError = touched.email && emailProblem ? t(emailProblem) : undefined;
  const passwordError = touched.password && passwordProblem ? t(passwordProblem) : undefined;

  const onSubmit = useCallback(async () => {
    setTouched({ email: true, password: true });
    setFormError(null);

    if (emailProblem) { emailRef.current?.focus(); return; }
    if (passwordProblem) { passwordRef.current?.focus(); return; }

    try {
      await login(email.trim().toLowerCase(), password);
      // No navigation call: RootNavigator swaps stacks once a token exists.
    } catch (err) {
      setFormError(t(authErrorKey(err)));
    }
  }, [email, emailProblem, login, password, passwordProblem, t]);

  const goSignUp = useCallback(() => navigation.navigate('SignUp'), [navigation]);
  const goForgot = useCallback(() => navigation.navigate('ForgotPassword'), [navigation]);
  const goBack = useCallback(() => navigation.goBack(), [navigation]);

  const canGoBack = navigation.canGoBack();

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
      {/* Decorative light blooms — depth without a second gradient layer. */}
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
            end: -theme.spacing['4xl'],
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.bloom,
          {
            width: theme.layout.maxContentWidth * 0.2,
            height: theme.layout.maxContentWidth * 0.2,
            borderRadius: theme.radii.pill,
            backgroundColor: theme.colors.textOnBrand,
            bottom: -theme.spacing['3xl'],
            start: -theme.spacing['2xl'],
            opacity: 0.06,
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

          <View style={{ gap: theme.spacing.xxs }}>
            <Text role="h2" weight="bold" tone="onBrand" align="center">
              {t('app.name')}
            </Text>
            <Text role="bodySm" tone="onBrand" align="center" style={styles.tagline}>
              {t('app.tagline')}
            </Text>
          </View>
        </MotiView>
      </View>
    </LinearGradient>
  );

  return (
    <Screen scroll keyboardAvoiding edges={['bottom']} header={hero} testID="login">
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
              {t('auth.loginTitle')}
            </Text>
            <Text role="bodySm" tone="muted">{t('auth.loginSubtitle')}</Text>
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
              ref={emailRef}
              label={t('auth.email')}
              placeholder={t('auth.emailPlaceholder')}
              iconLeft="mail-outline"
              value={email}
              onChangeText={(v) => { setEmail(v); if (formError) setFormError(null); }}
              onBlur={() => setTouched((s) => ({ ...s, email: true }))}
              error={emailError}
              keyboardType="email-address"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => passwordRef.current?.focus()}
              testID="login-email"
            />

            <View style={{ gap: theme.spacing.sm }}>
              <Input
                ref={passwordRef}
                label={t('auth.password')}
                placeholder={t('auth.passwordPlaceholder')}
                iconLeft="lock-closed-outline"
                passwordToggle
                value={password}
                onChangeText={(v) => { setPassword(v); if (formError) setFormError(null); }}
                onBlur={() => setTouched((s) => ({ ...s, password: true }))}
                error={passwordError}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={onSubmit}
                testID="login-password"
              />

              <Pressable
                onPress={goForgot}
                accessibilityRole="link"
                accessibilityLabel={t('auth.forgotPassword')}
                hitSlop={theme.spacing.sm}
                style={({ pressed }) => [
                  styles.forgot,
                  { minHeight: theme.layout.touchTarget, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Text role="bodySm" weight="bold" tone="primary">
                  {t('auth.forgotPassword')}
                </Text>
              </Pressable>
            </View>

            <Button
              title={t('auth.login')}
              onPress={onSubmit}
              loading={loading}
              size="lg"
              accessibilityLabel={t('auth.login')}
              testID="login-submit"
            />
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
            <Text role="bodySm" tone="muted">{t('auth.noAccountPrefix')}</Text>
            <Pressable
              onPress={goSignUp}
              accessibilityRole="link"
              accessibilityLabel={t('auth.createAccount')}
              hitSlop={theme.spacing.sm}
              style={({ pressed }) => [
                styles.footerLink,
                { minHeight: theme.layout.touchTarget, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text role="bodySm" weight="bold" tone="primary">{t('auth.createAccount')}</Text>
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
  tagline: { opacity: 0.85 },
  banner: { flexDirection: 'row', alignItems: 'flex-start' },
  // `justifyContent` centres the label inside the 48px target so the link
  // keeps its optical position while the tappable box grows around it.
  forgot: { alignSelf: 'flex-start', justifyContent: 'center' },
  footerLink: { justifyContent: 'center' },
  divider: { width: '100%' },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
});
