/**
 * The person's own picture, with the first letter of their name behind it.
 *
 * Why the letter is a *fallback* and not an alternative
 *   An account created through Google carries a profile photo, and the server
 *   has stored it as `avatarUrl` since the identity work — it was simply never
 *   rendered, so someone who signed in with a face got an initial. That is the
 *   normal case this component fixes.
 *
 *   But a remote image is the one thing on these screens that can fail after
 *   layout: the URL is Google's, it is fetched over the network, and it can
 *   404 once a photo is changed. An avatar that renders as an empty circle
 *   looks like a bug in the app rather than a missing picture, so `onError`
 *   falls straight back to the letter and the circle is never empty.
 *
 * Every call site keeps its own size, background and text scale, because the
 * header, the profile card and the meeting tile are three different sizes of
 * the same idea and none of them should be forced to agree.
 */

import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { Text } from './Text';
import type { TextProps } from './Text';

export interface AvatarProps {
  /** Profile picture from the identity provider, when the account has one. */
  uri?: string | null;
  /** Supplies the fallback initial. */
  name?: string | null;
  /** Diameter in px. The image fills it; the circle is always this size. */
  size: number;
  /** Behind the initial, and behind a picture while it loads. */
  background: string;
  /** Text scale for the initial — `h2` on the profile card, `h4` in a header. */
  role?: TextProps['role'];
  tone?: TextProps['tone'];
  /**
   * Overrides `tone` for the initial. The meeting stage paints its own palette
   * rather than the theme's, so its letter needs a literal colour.
   */
  textColor?: string;
  style?: StyleProp<ViewStyle>;
}

export function Avatar({
  uri,
  name,
  size,
  background,
  role = 'h4',
  tone = 'primary',
  textColor,
  style,
}: AvatarProps) {
  const [failed, setFailed] = useState(false);

  // A new URL deserves a new attempt: without this, one broken picture would
  // keep the letter forever, including after the person changes their photo.
  useEffect(() => { setFailed(false); }, [uri]);

  const initial = (name?.trim()?.[0] ?? '?').toUpperCase();
  const showImage = !!uri && !failed;

  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: background },
        style,
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri: uri as string }}
          style={StyleSheet.absoluteFill}
          onError={() => setFailed(true)}
          // The source is square but not guaranteed to be; cover keeps the
          // circle full rather than letterboxing a face inside it.
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text
          role={role}
          weight="bold"
          tone={textColor ? 'inherit' : tone}
          style={textColor ? { color: textColor } : undefined}
        >
          {initial}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
