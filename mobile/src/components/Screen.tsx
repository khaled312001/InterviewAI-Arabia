import { ReactNode, RefObject } from 'react';
import {
  View, ScrollView, StyleSheet, RefreshControl, ViewStyle,
  KeyboardAvoidingView, Platform, StyleProp,
} from 'react-native';
import { SafeAreaView, Edge } from 'react-native-safe-area-context';
import { useAppTheme, useResponsive } from '../theme/useTheme';

interface Props {
  children: ReactNode;
  /** Wrap content in a ScrollView. Off for screens that own a FlatList. */
  scroll?: boolean;
  /**
   * Handle on the ScrollView this shell owns.
   *
   * Exposed for one reason only: a form whose submit button reports a missing
   * field further up the page has to be able to take the user *to* that field.
   * Printing an error under a button the user cannot see the cause of is how a
   * screen ends up looking broken rather than incomplete.
   */
  scrollRef?: RefObject<ScrollView>;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Remove the default horizontal padding (for edge-to-edge heroes). */
  bleed?: boolean;
  /** Use the wider content cap — for dashboards and stats. */
  wide?: boolean;
  edges?: readonly Edge[];
  /** Content rendered outside the width cap, e.g. a full-bleed header. */
  header?: ReactNode;
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  /** Extra bottom padding so content clears a floating CTA. */
  bottomInset?: number;
  keyboardAvoiding?: boolean;
  testID?: string;
}

/**
 * Screen shell.
 *
 * Owns three things every screen was previously re-solving (differently):
 * safe-area edges, horizontal padding, and — critically for the web build —
 * capping content width. Without the cap, the Expo web export renders a
 * phone layout stretched across a 1920px monitor, which is the single most
 * obvious "this is not a real product" tell on desktop.
 */
export function Screen({
  children,
  scroll = false,
  scrollRef,
  refreshing,
  onRefresh,
  bleed = false,
  wide = false,
  edges = ['top'],
  header,
  footer,
  style,
  contentStyle,
  bottomInset = 0,
  keyboardAvoiding = false,
  testID,
}: Props) {
  const theme = useAppTheme();
  const { maxWidth, maxWideWidth, screenPadding } = useResponsive();
  const cap = wide ? maxWideWidth : maxWidth;

  const inner = (
    <View
      style={[
        styles.capped,
        cap ? { maxWidth: cap } : null,
        !bleed ? { paddingHorizontal: screenPadding } : null,
        contentStyle,
      ]}
    >
      {children}
    </View>
  );

  const body = scroll ? (
    <ScrollView
      ref={scrollRef}
      style={styles.fill}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: theme.spacing['3xl'] + bottomInset },
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
            progressBackgroundColor={theme.colors.surface}
          />
        ) : undefined
      }
    >
      {header}
      {inner}
    </ScrollView>
  ) : (
    <View style={styles.fill}>
      {header}
      {inner}
    </View>
  );

  const content = keyboardAvoiding ? (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {body}
    </KeyboardAvoidingView>
  ) : (
    body
  );

  return (
    <SafeAreaView
      testID={testID}
      edges={edges}
      style={[styles.fill, { backgroundColor: theme.colors.bg }, style]}
    >
      {content}
      {footer}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  // `alignSelf: center` + maxWidth is what centres the column on wide
  // viewports; width:100% keeps it full-bleed below the breakpoint.
  capped: { width: '100%', alignSelf: 'center', flexGrow: 1 },
});
