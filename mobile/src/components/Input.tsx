import { ReactNode, forwardRef, useState } from 'react';
import {
  TextInput, View, StyleSheet, TextInputProps, Pressable,
  StyleProp, ViewStyle, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Text } from './Text';
import { useAppTheme, useDirection } from '../theme/useTheme';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
  helperText?: string;
  iconLeft?: keyof typeof Ionicons.glyphMap;
  /** Renders a show/hide toggle and manages secureTextEntry itself. */
  passwordToggle?: boolean;
  required?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  rightAdornment?: ReactNode;
}

/**
 * Text field.
 *
 * Two things the previous version got wrong:
 *
 * 1. It hardcoded `textAlign: 'right'`, so English input rendered
 *    right-aligned with the caret in the wrong place. Alignment now follows
 *    the writing direction, and `writingDirection` is left unset so mixed
 *    Arabic/Latin content (emails, passwords) resolves per-character.
 * 2. Height came from vertical padding, so inputs never matched button
 *    heights. Both now read `layout.control`.
 */
export const Input = forwardRef<TextInput, Props>(function Input(
  {
    label, error, helperText, iconLeft, passwordToggle, required,
    containerStyle, rightAdornment, style, onFocus, onBlur,
    secureTextEntry, editable = true, ...rest
  },
  ref,
) {
  const theme = useAppTheme();
  const { isRTL } = useDirection();
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);

  const isSecure = passwordToggle ? hidden : secureTextEntry;

  const borderColor = error
    ? theme.colors.danger
    : focused
      ? theme.colors.primary
      : theme.colors.border;

  return (
    <View style={[{ gap: theme.spacing.xs }, containerStyle]}>
      {label ? (
        <Text role="bodySm" weight="bold" tone="secondary">
          {label}
          {required ? <Text role="bodySm" tone="danger"> *</Text> : null}
        </Text>
      ) : null}

      <View
        style={[
          styles.field,
          {
            minHeight: theme.layout.control.md,
            borderRadius: theme.radii.sm,
            borderColor,
            borderWidth: 1.5,
            // A tinted fill is the focus cue that is safe on every platform.
            backgroundColor: !editable
              ? theme.colors.surfaceSunken
              : focused ? theme.colors.primaryMuted : theme.colors.surface,
            paddingHorizontal: theme.spacing.md,
            gap: theme.spacing.sm,
          },
          /*
           * The focus lift is iOS and web ONLY — never Android.
           *
           * On Android the shadow is `elevation`, and toggling elevation on
           * the TextInput's own parent at the moment it gains focus makes the
           * new-architecture renderer rebuild that view. Android then drops
           * focus from the EditText and hands it to the next focusable field,
           * whose focus toggles ITS parent, and so on: focus ping-pongs
           * between fields and keystrokes land in whichever one holds it at
           * that instant. Typing «Khaled» into the name field produced
           * name="ha", email="le", password="d". That was the sign-up screen
           * that "hangs" — and the login screen had it too.
           *
           * The border colour and the tinted fill carry focus on Android.
           * Neither changes the native hierarchy.
           */
          focused && Platform.OS !== 'android' ? { ...(theme.shadow.sm as object) } : null,
        ]}
      >
        {iconLeft ? (
          <Ionicons
            name={iconLeft}
            size={theme.layout.icon.md}
            color={focused ? theme.colors.primary : theme.colors.textMuted}
          />
        ) : null}

        <TextInput
          ref={ref}
          editable={editable}
          secureTextEntry={isSecure}
          placeholderTextColor={theme.colors.textDisabled}
          accessibilityLabel={label}
          {...rest}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          style={[
            styles.input,
            theme.text('body'),
            {
              color: editable ? theme.colors.text : theme.colors.textMuted,
              // The LANGUAGE's direction. The native RTL flag only changes on
              // the next launch, so after switching to English it kept every
              // field right-aligned until the app was restarted.
              textAlign: isRTL ? 'right' : 'left',
            },
            style,
          ]}
        />

        {passwordToggle ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            hitSlop={theme.spacing.md}
            accessibilityRole="button"
            // Copy must go through i18n: this control renders on Login and
            // SignUp, so a hardcoded Arabic label leaked into English mode.
            accessibilityLabel={hidden ? t('auth.showPassword') : t('auth.hidePassword')}
            // The glyph is only 20px tall; the control height plus hitSlop is
            // what actually reaches the 48px minimum target.
            style={[
              styles.toggle,
              { minHeight: theme.layout.control.md, minWidth: theme.layout.icon.lg },
            ]}
          >
            <Ionicons
              name={hidden ? 'eye-outline' : 'eye-off-outline'}
              size={theme.layout.icon.md}
              color={theme.colors.textMuted}
            />
          </Pressable>
        ) : null}

        {rightAdornment}
      </View>

      {error || helperText ? (
        <Text role="caption" tone={error ? 'danger' : 'muted'}>
          {error || helperText}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center' },
  toggle: { alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1,
    paddingVertical: 0, // height is owned by the container
    // Removing the Android default underline/padding keeps the caret centred.
    ...(({ includeFontPadding: false } as unknown) as object),
  },
});
