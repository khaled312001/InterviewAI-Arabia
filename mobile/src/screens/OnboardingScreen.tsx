/**
 * Onboarding — the first thing anyone sees.
 *
 * Three swipeable slides, each with a purpose-drawn SVG illustration (not an
 * emoji), a colour wash that cross-fades as you swipe, page dots, a skip
 * affordance, and a single dominant CTA.
 *
 * Why a hand-rolled pager instead of a paging `FlatList`:
 * the app force-enables RTL, and horizontal scroll offsets under RTL mean
 * different things on iOS, Android and react-native-web (0→max, max→0, and
 * 0→-max respectively). Reading `contentOffset.x` is therefore unreliable on
 * the one surface that matters most here — the web export. Positioning slides
 * with `translateX` sidesteps it entirely: transforms are physical on every
 * platform and are never flipped by `I18nManager.swapLeftAndRightInRTL`.
 * `dir` below is the only place direction is encoded.
 */

import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated, Easing, LayoutChangeEvent, PanResponder, Platform, Pressable,
  StyleSheet, View,
} from 'react-native';
import Svg, {
  Circle, Defs, G, LinearGradient as SvgGradient, Path, Polyline, Rect, Stop,
} from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { MotiView } from 'moti';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Badge, Button, Logo, Screen, Text } from '../components';
import { useAppTheme, useDirection, useResponsive } from '../theme/useTheme';
import { motion, spacing, type AppTheme } from '../theme/tokens';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;

type ArtVariant = 'practice' | 'feedback' | 'progress';

const SLIDE_COUNT = 3;
/** react-native-web has no native driver; passing `true` there only warns. */
const USE_NATIVE_DRIVER = Platform.OS !== 'web';
/** Finger travel before the pager claims the gesture from a parent scroll. */
const PAN_ACTIVATION = spacing.sm;

/* ------------------------------------------------------------------ *
 * Illustrations
 *
 * Drawn on a 240×240 grid so every slide's art shares one optical size
 * and one visual weight. Colours come from semantic roles / gradients,
 * so both light and dark mode are covered without a second set of art.
 * ------------------------------------------------------------------ */

const VB = 240;

const SlideArt = memo(function SlideArt({
  variant, size, theme,
}: { variant: ArtVariant; size: number; theme: AppTheme }) {
  const c = theme.colors;
  // Ids live in the document scope once react-native-svg renders to the DOM,
  // so they must not collide between the three slides mounted at once.
  const gid = `onb-${variant}-grad`;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
        {variant === 'practice' && (
          <>
            <Defs>
              <SvgGradient id={gid} x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={theme.gradients.hero[0]} />
                <Stop offset="1" stopColor={theme.gradients.hero[1]} />
              </SvgGradient>
            </Defs>

            <Circle cx="120" cy="120" r="98" fill={c.primaryMuted} />
            <Circle
              cx="120" cy="120" r="110" fill="none"
              stroke={c.primaryBorder} strokeWidth="1.5" strokeDasharray="6 12"
            />

            {/* Interviewer bubble */}
            <Rect
              x="26" y="56" width="150" height="72" rx="22"
              fill={c.surface} stroke={c.border} strokeWidth="1.5"
            />
            <Circle cx="44" cy="136" r="6.5" fill={c.surface} stroke={c.border} strokeWidth="1.5" />
            <Circle cx="33" cy="147" r="3.5" fill={c.surface} stroke={c.border} strokeWidth="1.5" />
            <Circle cx="54" cy="82" r="14" fill={`url(#${gid})`} />
            <Rect x="78" y="74" width="82" height="9" rx="4.5" fill={c.borderStrong} />
            <Rect x="78" y="91" width="60" height="9" rx="4.5" fill={c.border} />

            {/* Candidate bubble */}
            <Rect x="72" y="148" width="146" height="58" rx="22" fill={`url(#${gid})`} />
            <Rect x="90" y="164" width="94" height="9" rx="4.5" fill={c.textOnBrand} opacity={0.95} />
            <Rect x="90" y="181" width="62" height="9" rx="4.5" fill={c.textOnBrand} opacity={0.55} />
            <Circle cx="212" cy="210" r="5.5" fill={c.primary} />
            <Circle cx="223" cy="221" r="3" fill={c.primary} />

            {/* Mic badge — the interview is spoken, not typed */}
            <Circle cx="204" cy="58" r="24" fill={c.surface} stroke={c.border} strokeWidth="1.5" />
            <Rect x="200" y="44" width="9" height="16" rx="4.5" fill={c.primary} />
            <Path
              d="M195 57 a9.5 9.5 0 0 0 19 0" fill="none"
              stroke={c.primary} strokeWidth="3" strokeLinecap="round"
            />
            <Path d="M204.5 66 v6" stroke={c.primary} strokeWidth="3" strokeLinecap="round" />
            <Path d="M198 73 h13" stroke={c.primary} strokeWidth="3" strokeLinecap="round" />
          </>
        )}

        {variant === 'feedback' && (
          <>
            <Defs>
              <SvgGradient id={gid} x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={theme.gradients.success[0]} />
                <Stop offset="1" stopColor={theme.gradients.success[1]} />
              </SvgGradient>
            </Defs>

            <Circle cx="120" cy="120" r="98" fill={c.successMuted} />

            {/* Score ring — the same visual language as ScoreRing on results */}
            <Circle cx="120" cy="96" r="54" fill="none" stroke={c.border} strokeWidth="16" />
            <Circle
              cx="120" cy="96" r="54" fill="none"
              stroke={`url(#${gid})`} strokeWidth="16" strokeLinecap="round"
              strokeDasharray="265 340" transform="rotate(-90 120 96)"
            />
            <Path
              d="M98 96 l14 15 l30 -33" fill="none"
              stroke={c.success} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round"
            />

            {/* Session-over-session improvement */}
            <Rect x="74" y="192" width="24" height="20" rx="8" fill={c.border} />
            <Rect x="108" y="180" width="24" height="32" rx="8" fill={c.success} opacity={0.45} />
            <Rect x="142" y="168" width="24" height="44" rx="8" fill={`url(#${gid})`} />

            <Path
              d="M52 60 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 Z"
              fill={c.success} opacity={0.7}
            />
            <Path
              d="M196 138 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 Z"
              fill={c.success} opacity={0.45}
            />
          </>
        )}

        {variant === 'progress' && (
          <>
            <Defs>
              <SvgGradient id={gid} x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={theme.gradients.premium[0]} />
                <Stop offset="1" stopColor={theme.gradients.premium[1]} />
              </SvgGradient>
            </Defs>

            <Circle cx="120" cy="120" r="98" fill={c.accentMuted} />

            <G opacity={0.35}>
              {[-52, -26, 0, 26, 52].map((deg) => (
                <Rect
                  key={deg}
                  x="117" y="6" width="6" height="20" rx="3"
                  fill={c.accent} transform={`rotate(${deg} 120 88)`}
                />
              ))}
            </G>

            {/* Trophy */}
            <Path
              d="M84 58 h-14 a17 17 0 0 0 18 25" fill="none"
              stroke={c.accent} strokeWidth="6" strokeLinecap="round"
            />
            <Path
              d="M156 58 h14 a17 17 0 0 1 -18 25" fill="none"
              stroke={c.accent} strokeWidth="6" strokeLinecap="round"
            />
            <Path
              d="M88 42 h64 a4 4 0 0 1 4 4 v22 a36 36 0 0 1 -72 0 v-22 a4 4 0 0 1 4 -4 Z"
              fill={`url(#${gid})`}
            />
            <Path
              d="M120 60 l5.5 11 l11 5.5 l-11 5.5 l-5.5 11 l-5.5 -11 l-11 -5.5 l11 -5.5 Z"
              fill={c.onAccent} opacity={0.85}
            />
            <Rect x="112" y="104" width="16" height="18" fill={c.accent} />
            <Rect x="94" y="122" width="52" height="12" rx="6" fill={c.accent} />

            {/* Progress card */}
            <Rect
              x="46" y="150" width="148" height="62" rx="18"
              fill={c.surface} stroke={c.border} strokeWidth="1.5"
            />
            <Polyline
              points="64,196 94,182 124,188 154,168 176,162" fill="none"
              stroke={`url(#${gid})`} strokeWidth="5"
              strokeLinecap="round" strokeLinejoin="round"
            />
            <Circle cx="176" cy="162" r="7" fill={c.accent} />
            <Circle cx="176" cy="162" r="3" fill={c.surface} />
          </>
        )}
      </Svg>
    </View>
  );
});

/* ------------------------------------------------------------------ */

export function OnboardingScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const { isRTL } = useDirection();
  const { screenPadding } = useResponsive();

  /** +1 when the next slide sits to the right, -1 when it sits to the left. */
  const dir = isRTL ? -1 : 1;

  const [index, setIndex] = useState(0);
  const [box, setBox] = useState({ width: 0, height: 0 });

  // Refs mirror state because the PanResponder is created once and would
  // otherwise close over the initial render's values forever.
  const indexRef = useRef(0);
  const widthRef = useRef(0);
  const dirRef = useRef(dir);
  dirRef.current = dir;

  const tx = useRef(new Animated.Value(0)).current;

  const slides = useMemo(
    () => ([
      { art: 'practice' as ArtVariant, tag: t('onboarding.slide1Tag'), title: t('onboarding.slide1Title'), body: t('onboarding.slide1Body'), tone: 'primary' as const },
      { art: 'feedback' as ArtVariant, tag: t('onboarding.slide2Tag'), title: t('onboarding.slide2Title'), body: t('onboarding.slide2Body'), tone: 'success' as const },
      { art: 'progress' as ArtVariant, tag: t('onboarding.slide3Tag'), title: t('onboarding.slide3Title'), body: t('onboarding.slide3Body'), tone: 'accent' as const },
    ]),
    [t],
  );

  const offsetFor = useCallback((i: number) => -dirRef.current * i * widthRef.current, []);

  const goTo = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(SLIDE_COUNT - 1, next));
    indexRef.current = clamped;
    setIndex(clamped);
    Animated.timing(tx, {
      toValue: offsetFor(clamped),
      duration: theme.motion.duration.normal,
      easing: Easing.bezier(...motion.easing.standard),
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  }, [offsetFor, theme.motion.duration.normal, tx]);

  const panResponder = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > PAN_ACTIVATION && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
      onPanResponderMove: (_e, g) => {
        const d = dirRef.current;
        let dx = g.dx;
        const atStart = indexRef.current === 0 && dx * d > 0;
        const atEnd = indexRef.current === SLIDE_COUNT - 1 && dx * d < 0;
        if (atStart || atEnd) dx *= 0.32; // rubber-band past the ends
        tx.setValue(offsetFor(indexRef.current) + dx);
      },
      onPanResponderRelease: (_e, g) => {
        const w = widthRef.current || 1;
        // Negative = "towards the next slide", in either writing direction.
        const travelled = g.dx * dirRef.current;
        const flick = Math.abs(g.vx) > 0.35;
        const threshold = flick ? w * 0.08 : w * 0.28;
        if (travelled < -threshold) goTo(indexRef.current + 1);
        else if (travelled > threshold) goTo(indexRef.current - 1);
        else goTo(indexRef.current);
      },
      onPanResponderTerminate: () => goTo(indexRef.current),
    }),
    [goTo, offsetFor, tx],
  );

  const onPagerLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const w = Math.round(width);
    const h = Math.round(height);
    if (w === widthRef.current && h === box.height) return;
    widthRef.current = w;
    setBox({ width: w, height: h });
    // Re-anchor instantly on resize (desktop web) instead of animating.
    tx.setValue(-dirRef.current * indexRef.current * w);
  }, [box.height, tx]);

  const goLogin = useCallback(() => navigation.replace('Login'), [navigation]);
  const goSignUp = useCallback(() => navigation.replace('SignUp'), [navigation]);

  const isLast = index === SLIDE_COUNT - 1;
  /*
   * The last slide lands on LOG IN, not sign-up.
   *
   * The app is published, so most people arriving at the end of the intro
   * already have an account — a returning user sent to a registration form has
   * to notice the small link underneath and correct course, and some will just
   * make a second account instead. Signing up is still one tap away, as the
   * secondary action beneath the button.
   */
  const onPrimary = useCallback(() => {
    if (indexRef.current === SLIDE_COUNT - 1) goLogin();
    else goTo(indexRef.current + 1);
  }, [goLogin, goTo]);

  /** Fractional slide position, 0…2 — drives the wash and per-slide fades. */
  const position = box.width > 0
    ? tx.interpolate(
      dir > 0
        ? { inputRange: [-(SLIDE_COUNT - 1) * box.width, 0], outputRange: [SLIDE_COUNT - 1, 0], extrapolate: 'clamp' }
        : { inputRange: [0, (SLIDE_COUNT - 1) * box.width], outputRange: [0, SLIDE_COUNT - 1], extrapolate: 'clamp' },
    )
    : null;

  // Returns an Animated node once the pager has been measured, a static
  // number before that. Typed loosely because Animated's style generics do
  // not narrow across that union.
  const fadeAt = (i: number, out: [number, number, number]): any =>
    (position
      ? position.interpolate({ inputRange: [i - 1, i, i + 1], outputRange: out, extrapolate: 'clamp' })
      : (i === 0 ? out[1] : out[0]));

  const washes: readonly [string, string][] = [
    [theme.colors.primaryMuted, theme.colors.bg],
    [theme.colors.successMuted, theme.colors.bg],
    [theme.colors.accentMuted, theme.colors.bg],
  ];

  const wash = (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {washes.map((pair, i) => (
        <Animated.View
          key={i}
          style={[StyleSheet.absoluteFill, { opacity: fadeAt(i, [0, 1, 0]) }]}
        >
          <LinearGradient
            colors={[pair[0], pair[1]]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 0.72 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ))}
    </View>
  );

  // Art shrinks on short viewports so the title never gets pushed off-screen.
  const artSize = Math.round(Math.max(
    0,
    Math.min(
      box.width * 0.62,
      box.height * 0.42,
      theme.layout.maxContentWidth * 0.38,
    ),
  ));

  return (
    <Screen bleed edges={['top', 'bottom']} header={wash} testID="onboarding">
      <StatusBar style="auto" />

      <View style={styles.fill}>
        {/* ---------- top bar ---------- */}
        <View style={[styles.topBar, { paddingHorizontal: screenPadding, paddingVertical: theme.spacing.sm }]}>
          <Logo size={theme.layout.icon['2xl']} />
          <Pressable
            onPress={goLogin}
            hitSlop={theme.spacing.md}
            accessibilityRole="button"
            accessibilityLabel={t('common.skip')}
            accessibilityHint={t('onboarding.skipHint')}
            style={({ pressed }) => [
              styles.skip,
              {
                minHeight: theme.layout.touchTarget,
                paddingHorizontal: theme.spacing.md,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            <Text role="bodySm" weight="bold" tone="secondary">{t('common.skip')}</Text>
          </Pressable>
        </View>

        {/* ---------- pager ---------- */}
        <View
          style={styles.pager}
          onLayout={onPagerLayout}
          accessibilityLabel={t('onboarding.progress', { current: index + 1, total: SLIDE_COUNT })}
          {...panResponder.panHandlers}
        >
          {box.width > 0 && (
            <Animated.View
              style={[styles.track, { width: box.width, transform: [{ translateX: tx }] }]}
            >
              {slides.map((slide, i) => (
                <Animated.View
                  key={slide.art}
                  // Off-screen slides stay in the tree for the swipe animation,
                  // so they must be taken out of the accessibility tree or a
                  // screen reader reads all three at once.
                  accessibilityElementsHidden={i !== index}
                  importantForAccessibility={i === index ? 'yes' : 'no-hide-descendants'}
                  style={[
                    styles.slide,
                    {
                      width: box.width,
                      paddingHorizontal: screenPadding,
                      gap: theme.spacing['2xl'],
                      opacity: fadeAt(i, [0.2, 1, 0.2]),
                      transform: [
                        { translateX: dir * i * box.width },
                        { scale: fadeAt(i, [0.92, 1, 0.92]) },
                      ],
                    },
                  ]}
                >
                  <SlideArt variant={slide.art} size={artSize} theme={theme} />

                  <View style={[styles.copy, { gap: theme.spacing.md }]}>
                    <Badge label={slide.tag} tone={slide.tone} size="md" />
                    <Text role="h1" weight="bold" align="center" accessibilityRole="header">
                      {slide.title}
                    </Text>
                    <Text
                      role="bodyLg"
                      tone="secondary"
                      align="center"
                      style={{ maxWidth: theme.layout.maxContentWidth / 2 }}
                    >
                      {slide.body}
                    </Text>
                  </View>
                </Animated.View>
              ))}
            </Animated.View>
          )}
        </View>

        {/* ---------- dots + CTA ---------- */}
        <View
          style={[
            styles.footer,
            {
              paddingHorizontal: screenPadding,
              paddingBottom: theme.spacing.lg,
              gap: theme.spacing.lg,
            },
          ]}
        >
          <View style={styles.dots} accessibilityRole="tablist">
            {slides.map((slide, i) => {
              const active = i === index;
              return (
                <Pressable
                  key={slide.art}
                  onPress={() => goTo(i)}
                  accessibilityRole="button"
                  accessibilityLabel={t('onboarding.goToSlide', { number: i + 1 })}
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.dotHit,
                    { height: theme.layout.touchTarget, paddingHorizontal: theme.spacing.xs },
                  ]}
                >
                  <MotiView
                    animate={{
                      width: active ? theme.spacing['2xl'] : theme.spacing.sm,
                      opacity: active ? 1 : 0.5,
                    }}
                    transition={{ type: 'timing', duration: theme.motion.duration.fast }}
                    style={{
                      height: theme.spacing.sm,
                      borderRadius: theme.radii.pill,
                      backgroundColor: active ? theme.colors.primary : theme.colors.borderStrong,
                    }}
                  />
                </Pressable>
              );
            })}
          </View>

          <Button
            title={isLast ? t('auth.login') : t('common.next')}
            onPress={onPrimary}
            size="lg"
            // No accessibilityLabel override: Button defaults it to `title`, so
            // the accessible name always contains the visible text. Overriding
            // it with `auth.createAccount` while the button rendered
            // `common.getStarted` broke WCAG "Label in Name" — voice control
            // could not match the spoken label. Destination goes in the hint.
            accessibilityHint={isLast ? t('onboarding.getStartedHint') : t('onboarding.nextHint')}
            testID="onboarding-cta"
          />

          <Pressable
            onPress={goSignUp}
            accessibilityRole="link"
            accessibilityLabel={t('onboarding.newHere')}
            style={({ pressed }) => [
              styles.haveAccount,
              { minHeight: theme.layout.touchTarget, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Text role="bodySm" weight="bold" tone="primary">{t('onboarding.newHere')}</Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  skip: { alignItems: 'center', justifyContent: 'center' },
  pager: { flex: 1, overflow: 'hidden', justifyContent: 'center' },
  track: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  slide: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { alignItems: 'center' },
  footer: { alignItems: 'stretch' },
  dots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  dotHit: { alignItems: 'center', justifyContent: 'center' },
  haveAccount: { alignItems: 'center', justifyContent: 'center' },
});
