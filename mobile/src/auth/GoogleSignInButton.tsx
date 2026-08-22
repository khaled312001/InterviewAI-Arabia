/**
 * The "sign in with Google" button, plus the divider that introduces it.
 *
 * Renders NOTHING when Google sign-in is not configured for the deployment —
 * not a disabled button, not a greyed row. A control that is visible and
 * cannot work is the same failure as the interview screen's dead CTA: the user
 * presses it, nothing happens, and the app looks broken rather than
 * unconfigured.
 *
 * Google's branding guidelines are not optional here — an app that ships a
 * home-made Google button can have its OAuth client suspended. The required
 * shape is: the official four-colour mark at 18dp, on white (or on the dark
 * variant), with the exact wording "Sign in with Google" / its localisation,
 * minimum 40dp height, and the mark never recoloured or cropped.
 */

import { View, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTranslation } from 'react-i18next';

import { Text } from '../components';
import { useAppTheme } from '../theme/useTheme';

/**
 * The Google "G", drawn rather than fetched.
 *
 * A remote image would put a third-party request on the sign-in screen — the
 * one screen that must work before the user trusts us with anything — and the
 * four fixed brand colours are exactly the case where hardcoding hex is
 * correct: they are someone else's identity, not our theme.
 */
function GoogleMark({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <Path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <Path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <Path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </Svg>
  );
}

interface Props {
  available: boolean;
  busy: boolean;
  /** The surrounding form is submitting; the button must not start a second flow. */
  disabled?: boolean;
  onPress: () => void;
  /** `signIn` on the login screen, `signUp` on registration. */
  variant?: 'signIn' | 'signUp';
}

export function GoogleSignInButton({
  available, busy, disabled, onPress, variant = 'signIn',
}: Props) {
  const theme = useAppTheme();
  const { t } = useTranslation();

  if (!available) return null;

  const blocked = busy || !!disabled;

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <View style={[styles.divider, { gap: theme.spacing.md }]}>
        <View style={{ flex: 1, height: theme.layout.hairline, backgroundColor: theme.colors.divider }} />
        <Text role="micro" tone="muted">{t('auth.orDivider')}</Text>
        <View style={{ flex: 1, height: theme.layout.hairline, backgroundColor: theme.colors.divider }} />
      </View>

      <Pressable
        onPress={onPress}
        disabled={blocked}
        accessibilityRole="button"
        accessibilityState={{ disabled: blocked, busy }}
        accessibilityLabel={t(variant === 'signUp' ? 'auth.googleSignUp' : 'auth.googleSignIn')}
        style={({ pressed }) => [
          styles.button,
          {
            gap: theme.spacing.md,
            // Google's guidelines set a 40dp floor; the app's own large control
            // height is taller, and matching it keeps the two CTAs the same size.
            minHeight: theme.layout.control.lg,
            paddingHorizontal: theme.spacing.lg,
            borderRadius: theme.radii.md,
            borderWidth: 1,
            // White with a grey rule, per the guidelines, in BOTH themes. This
            // is the one control on the screen that must not follow our
            // palette: recolouring it is what gets an OAuth client flagged.
            backgroundColor: '#FFFFFF',
            borderColor: '#DADCE0',
            opacity: blocked ? 0.6 : pressed ? 0.9 : 1,
          },
        ]}
      >
        {busy
          ? <ActivityIndicator size="small" color="#3C4043" />
          : <GoogleMark size={theme.layout.icon.lg} />}
        <Text role="body" weight="bold" tone="inherit" style={{ color: '#3C4043' }}>
          {t(variant === 'signUp' ? 'auth.googleSignUp' : 'auth.googleSignIn')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { flexDirection: 'row', alignItems: 'center' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
