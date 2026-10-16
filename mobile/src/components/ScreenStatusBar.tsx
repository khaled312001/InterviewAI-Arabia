import { StatusBar } from 'expo-status-bar';
import { useIsFocused } from '@react-navigation/native';
import { useAppTheme } from '../theme/useTheme';

/**
 * The status bar style a screen wants, applied only while that screen is the
 * one on top.
 *
 * `onBrand`: light icons, for a coloured hero drawn behind the status bar.
 * `theme`: whatever the page background needs — dark icons on light, light on dark.
 *
 * Mounting a bare <StatusBar> in a screen is not enough: tab screens and the
 * screens under a push stay MOUNTED, and expo-status-bar honours the most
 * recently mounted one. Home's light icons stayed in force on the History and
 * Stats tabs, where they drew white on white. Rendering nothing while
 * unfocused hands control back to the screen that is actually visible.
 */
export function ScreenStatusBar({ tone = 'theme' }: { tone?: 'onBrand' | 'theme' }) {
  const focused = useIsFocused();
  const theme = useAppTheme();
  if (!focused) return null;
  return <StatusBar style={tone === 'onBrand' || theme.isDark ? 'light' : 'dark'} />;
}
