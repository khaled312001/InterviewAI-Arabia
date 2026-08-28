import { useEffect, useState } from 'react';
import { I18nManager, Platform, Text, View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as WebBrowser from 'expo-web-browser';
import './src/i18n';
import { RootNavigator } from './src/navigation/RootNavigator';
import { navigationRef, onNavigationReady } from './src/navigation/navigationRef';
import { usePushNotifications } from './src/push';
import { useAuth } from './src/store/auth';
import { colors } from './src/theme/tokens';

/*
 * Finish an OAuth redirect that landed in this window, then get out of the way.
 *
 * On web the Google popup comes back to `/app/`, which boots a SECOND copy of
 * the whole app inside that popup. `maybeCompleteAuthSession()` recognises the
 * redirect, writes the result to localStorage, and posts it to the opener.
 *
 * What it does NOT do is close the window — the library leaves that to the
 * opener, which closes the popup when it receives that message. And the message
 * never arrives, because Google's pages carry `Cross-Origin-Opener-Policy`:
 * navigating through them severs `window.opener`, so by the time the popup is
 * back on our origin the reference is null. The library then falls back to
 * `window.opener ?? window.parent` — and for a top-level window `window.parent`
 * is the window itself, so the popup posts the result to nobody and sits there
 * showing the onboarding slides on top of the page that opened it.
 *
 * So we close it ourselves. The result is already in localStorage before this
 * point, and the opener has a focus-driven fallback that reads it from there —
 * which is why closing is enough to complete the sign-in rather than abandon it.
 *
 * `authPopupDone` is exported so the app can render a bare "you can close this"
 * panel instead of the full UI, for the case where the browser refuses the
 * close (a window a script did not open cannot be closed by script).
 */
const authResult = WebBrowser.maybeCompleteAuthSession();
export const authPopupDone = authResult?.type === 'success';

if (authPopupDone && typeof window !== 'undefined') {
  try { window.close(); } catch { /* browser refused; the panel below covers it */ }
}

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const [ready, setReady] = useState(false);
  const hydrate = useAuth((s) => s.hydrate);

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
  if (authPopupDone) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center',
                     backgroundColor: colors.bgLight, padding: 24 }}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.textLight, textAlign: 'center' }}>
          تم تسجيل الدخول
        </Text>
        <Text style={{ marginTop: 8, fontSize: 14, color: colors.textMutedLight, textAlign: 'center' }}>
          يمكنك إغلاق هذه النافذة والعودة إلى Interprova.
        </Text>
        <Text style={{ marginTop: 16, fontSize: 13, color: colors.textMutedLight, textAlign: 'center' }}>
          Signed in — you can close this window.
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
