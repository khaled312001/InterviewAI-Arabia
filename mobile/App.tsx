import { useEffect, useState } from 'react';
import { I18nManager, Platform, Text, View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import './src/i18n';
// Side-effect import: completes an OAuth redirect before anything renders.
import { authRedirectLanded } from './src/auth/completeAuthSession';
import { RootNavigator } from './src/navigation/RootNavigator';
import { navigationRef, onNavigationReady } from './src/navigation/navigationRef';
import { usePushNotifications } from './src/push';
import { useAuth } from './src/store/auth';
import { colors } from './src/theme/tokens';

/*
 * The OAuth popup case is handled entirely by ./src/auth/completeAuthSession,
 * which calls maybeCompleteAuthSession() exactly once for the whole program.
 * It is imported for its side effect and re-exported so nothing else has to
 * know where it lives.
 *
 * It MUST NOT be called here as well. It is single-use, and a second call
 * returns `failed` — which is precisely the bug that made the popup render the
 * whole app on top of the page that opened it. See that file for the full
 * ordering story.
 */
export { authRedirectLanded } from './src/auth/completeAuthSession';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const [ready, setReady] = useState(false);
  const hydrate = useAuth((s) => s.hydrate);

  /*
   * This window landed on an OAuth redirect. completeAuthSession has already
   * written the token to the relay and asked the window to close.
   *
   * Show a neutral "finishing sign-in" state rather than the full app: booting
   * the onboarding carousel on top of the page the reader was actually using
   * was the whole complaint.
   *
   * But only BRIEFLY. If the close was refused — a window script did not open
   * cannot be closed by script — a permanent "you can close this window" panel
   * would be a dead end, because there would be no other window to go back to.
   * So after a moment it falls through to the normal app, where the relay value
   * this same window just wrote signs it in on the spot. Either way the person
   * ends up signed in; the only difference is which window they end up in.
   */
  const [finishingAuth, setFinishingAuth] = useState(authRedirectLanded);
  useEffect(() => {
    if (!authRedirectLanded) return undefined;
    const t = setTimeout(() => setFinishingAuth(false), 1400);
    return () => clearTimeout(t);
  }, []);

  // Above the `!ready` early return on purpose — hooks cannot be conditional,
  // and the notification listeners have to be attached before the first render
  // anyway: a tap that launched the app is delivered while the splash screen is
  // still up. Nothing here prompts for permission; see src/push/registration.ts
  // for the two moments where we are allowed to ask.
  usePushNotifications();

  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === 'web') {
          // Web: set RTL at the document level AND tell react-native-web so it
          // flips logical styles (marginStart/End, textAlign: 'start', etc.).
          if (typeof document !== 'undefined') {
            document.documentElement.setAttribute('dir', 'rtl');
            document.documentElement.setAttribute('lang', 'ar');
            // Inject the Cairo Google Fonts stylesheet once. Loading TTFs via
            // expo-font's Font.loadAsync 404s because Google rotates asset
            // hashes; the CSS2 API is the stable, canonical loader.
            if (!document.getElementById('cairo-font')) {
              const link = document.createElement('link');
              link.id = 'cairo-font';
              link.rel = 'stylesheet';
              link.href = 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap';
              document.head.appendChild(link);
            }
            // Alias Cairo-Regular / Cairo-Bold → local Cairo weights, so the
            // font family names used across the RN theme work natively on web.
            if (!document.getElementById('cairo-aliases')) {
              const style = document.createElement('style');
              style.id = 'cairo-aliases';
              style.textContent = `
                @font-face { font-family: 'Cairo-Regular'; src: local('Cairo'); font-weight: 400; font-style: normal; }
                @font-face { font-family: 'Cairo-Bold';    src: local('Cairo'); font-weight: 700; font-style: normal; }
                html, body, #root { font-family: 'Cairo','IBM Plex Sans Arabic',system-ui,sans-serif; }
              `;
              document.head.appendChild(style);
            }
          }
          I18nManager.allowRTL(true);
          I18nManager.forceRTL(true);
        } else if (!I18nManager.isRTL) {
          I18nManager.allowRTL(true);
          I18nManager.forceRTL(true);
        }
        await hydrate();
      } finally {
        setReady(true);
        await SplashScreen.hideAsync().catch(() => {});
      }
    })();
  }, [hydrate]);

  /*
   * This window exists only to hand a token back. `window.close()` has already
   * been attempted at module scope; if the browser refused it, showing the whole
   * signed-out app — onboarding slides and all — on top of the page the reader
   * was actually using is the worst possible answer. Say what happened instead.
   */
  if (finishingAuth) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center',
                     backgroundColor: colors.bgLight, padding: 24 }}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ marginTop: 14, fontSize: 16, fontWeight: '700',
                       color: colors.textLight, textAlign: 'center' }}>
          جارٍ إتمام تسجيل الدخول…
        </Text>
        <Text style={{ marginTop: 6, fontSize: 13, color: colors.textMutedLight, textAlign: 'center' }}>
          Finishing sign-in…
        </Text>
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer ref={navigationRef} onReady={onNavigationReady}>
        <RootNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
