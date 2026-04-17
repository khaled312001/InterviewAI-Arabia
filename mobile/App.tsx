import { useEffect, useState } from 'react';
import { I18nManager, Platform, View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import './src/i18n';
import { RootNavigator } from './src/navigation/RootNavigator';
import { useAuth } from './src/store/auth';
import { colors } from './src/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const [ready, setReady] = useState(false);
  const hydrate = useAuth((s) => s.hydrate);

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
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
