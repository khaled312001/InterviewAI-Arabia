/**
 * Category details — the launch pad for the practice loop.
 *
 * This screen exists to answer three questions before the user commits:
 * "what is this field", "how hard is it", and "what actually happens when I
 * press start". The old version answered none of them (a title, one sentence,
 * and a question count that was always `1` because the request asked for
 * `limit: 1` and then read `questions.length`).
 *
 * Data comes from a single endpoint: `GET /categories/:id/questions` returns
 * both the category record and a real question pool, so the hero, the count,
 * and the sample preview all come from one round trip. A 402 on that call is
 * the premium gate — the same gate `POST /sessions/start` enforces — so we can
 * show the upsell instead of letting the user tap start and get an error.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { useAppTheme, useResponsive, useDirection } from '../theme/useTheme';
// `StyleSheet.create` runs outside the hook, so static rules read the raw
// token module rather than inventing their own numbers.
import { spacing } from '../theme/tokens';
import {
  Screen, Text, Button, Card, Badge, EmptyState, SectionHeader, Skeleton,
} from '../components';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'CategoryDetails'>;

/** Seed icons mapped onto Ionicons — the API stores a lucide-ish name. */
const CATEGORY_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  code: 'code-slash-outline',
  calculator: 'calculator-outline',
  megaphone: 'megaphone-outline',
  users: 'people-outline',
  headphones: 'headset-outline',
  'trending-up': 'trending-up-outline',
  palette: 'color-palette-outline',
};

const LEVELS = ['all', 'easy', 'medium', 'hard'] as const;
type Level = (typeof LEVELS)[number];

/** The API caps `limit` at 50, so a full page means "at least this many". */
const POOL_LIMIT = 50;
const SAMPLE_COUNT = 3;

/**
 * The server enforces this in `env.FREE_DAILY_QUESTION_LIMIT` but never sends
 * it to the client — `/user/me` returns `dailyQuestionsUsed` with no ceiling.
 * Mirrored here so the quota readout is honest; see the API-gap note.
 */
const FREE_DAILY_LIMIT = 5;

interface CategoryRecord {
  id: number;
  nameAr: string;
  nameEn: string;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  icon?: string | null;
  isPremium?: boolean;
}

interface QuestionRecord {
  id: string;
  questionAr: string;
  questionEn: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

type Phase = 'loading' | 'ready' | 'locked' | 'notFound' | 'error';

function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } } | undefined)?.response?.status;
}

/* ------------------------------------------------------------------ *
 * Sub-components
 * ------------------------------------------------------------------ */

/** Pinned action bar. `Screen` renders `footer` outside the width cap, so the
 *  inner view re-applies the cap and the screen padding to stay aligned. */
function FooterBar({ children }: { children: React.ReactNode }) {
  const theme = useAppTheme();
  const { maxWidth, screenPadding } = useResponsive();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        backgroundColor: theme.colors.bgElevated,
        borderTopWidth: theme.layout.hairline,
        borderTopColor: theme.colors.border,
        paddingTop: theme.spacing.md,
        paddingBottom: theme.spacing.md + insets.bottom,
      }}
    >
      <View
        style={{
          width: '100%',
          alignSelf: 'center',
          maxWidth,
          paddingHorizontal: screenPadding,
          gap: theme.spacing.sm,
        }}
      >
        {children}
      </View>
    </View>
  );
}

function StatCell({
  value, label, icon, tone,
}: {
  value: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'primary' | 'accent' | 'success';
}) {
  const theme = useAppTheme();
  return (
    <View style={[styles.statCell, { gap: theme.spacing.xxs }]}>
      <Ionicons name={icon} size={theme.layout.icon.md} color={theme.colors[tone]} />
      <Text role="h4" weight="bold" numberOfLines={1}>{value}</Text>
      <Text role="micro" tone="muted" numberOfLines={2} align="center">{label}</Text>
    </View>
  );
}

function StepRow({ index, title, body }: { index: number; title: string; body: string }) {
  const theme = useAppTheme();
  return (
    <View style={[styles.stepRow, { gap: theme.spacing.md }]}>
      <View
        style={[
          styles.stepBullet,
          {
            width: theme.layout.avatar.sm,
            height: theme.layout.avatar.sm,
            borderRadius: theme.radii.pill,
            backgroundColor: theme.colors.primaryMuted,
          },
        ]}
      >
        <Text role="bodySm" weight="bold" tone="primary">{index}</Text>
      </View>
      <View style={styles.stepText}>
        <Text role="bodySm" weight="bold">{title}</Text>
        <Text role="caption" tone="muted" style={{ marginTop: theme.spacing.xxs }}>{body}</Text>
      </View>
    </View>
  );
}

function LoadingSkeleton() {
  const theme = useAppTheme();
  return (
    <View style={{ gap: theme.spacing.lg, paddingTop: theme.spacing.lg }}>
      <Skeleton height={theme.layout.avatar.xl * 2} radius={theme.radii.xl} />
      <Skeleton height={theme.layout.avatar.lg + theme.spacing.xl} radius={theme.radii.lg} />
      {/* Chip row placeholders use the real chip height (touchTarget) so the
          layout does not shift when the pool resolves. */}
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {LEVELS.map((l) => (
          <Skeleton key={l} width={theme.layout.avatar.xl} height={theme.layout.touchTarget} radius={theme.radii.pill} />
        ))}
      </View>
      <Skeleton height={theme.layout.avatar.xl * 2} radius={theme.radii.lg} />
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export function CategoryDetailsScreen({ route, navigation }: Props) {
  const { categoryId, nameAr, nameEn } = route.params;
  const { t, i18n } = useTranslation();
  const theme = useAppTheme();
  const { arrowForward } = useDirection();
  const user = useAuth((s) => s.user);
  const refreshMe = useAuth((s) => s.refreshMe);

  const isEn = i18n.language.startsWith('en');

  const [phase, setPhase] = useState<Phase>('loading');
  const [category, setCategory] = useState<CategoryRecord | null>(null);
  const [questions, setQuestions] = useState<QuestionRecord[]>([]);
  const [level, setLevel] = useState<Level>('all');
  const [poolLoading, setPoolLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  /** Falls back to the list endpoint when the pool call is gated by 402 —
   *  it's public, so a locked user can still see what they're missing. */
  const loadCategoryMeta = useCallback(async () => {
    try {
      const { data } = await api.get('/categories');
      const found = (data.categories as CategoryRecord[] | undefined)
        ?.find((c) => Number(c.id) === Number(categoryId));
      if (found) setCategory(found);
    } catch {
      /* the hero falls back to the route params */
    }
  }, [categoryId]);

  const load = useCallback(async (next: Level, initial: boolean) => {
    if (initial) setPhase('loading');
    setPoolLoading(true);
    try {
      const { data } = await api.get(`/categories/${categoryId}/questions`, {
        params: { limit: POOL_LIMIT, ...(next === 'all' ? null : { difficulty: next }) },
      });
      setCategory(data.category as CategoryRecord);
      setQuestions((data.questions ?? []) as QuestionRecord[]);
      setPhase('ready');
    } catch (err) {
      const status = statusOf(err);
      if (status === 402) {
        await loadCategoryMeta();
        setQuestions([]);
        setPhase('locked');
      } else if (status === 404) {
        setPhase('notFound');
      } else {
        setPhase('error');
      }
    } finally {
      setPoolLoading(false);
    }
  }, [categoryId, loadCategoryMeta]);

  // Category content is not volatile — load once per (category, level) rather
  // than on every focus, so returning from Subscription doesn't re-flash.
  useEffect(() => {
    load(level, phase === 'loading');
    // `phase` is intentionally not a dependency: it would re-run on every
    // transition this effect itself causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, level]);

  // The quota IS volatile — the server rolls `dailyQuestionsUsed` back to 0 on
  // the first request of a new day, so a cached `user` can make the "left
  // today" stat read 0 when the allowance has actually reset. Refreshed once
  // per mount (never per focus) so the number under the hero is honest.
  useEffect(() => { refreshMe().catch(() => {}); }, [refreshMe]);

  const displayName = isEn
    ? (category?.nameEn ?? nameEn ?? nameAr)
    : (category?.nameAr ?? nameAr);

  const description = (isEn ? category?.descriptionEn : category?.descriptionAr)
    || t('category.defaultDescription');

  const isPremiumCategory = !!category?.isPremium || phase === 'locked';
  const isSubscriber = user?.plan === 'premium';
  const locked = isPremiumCategory && !isSubscriber;

  const remaining = isSubscriber
    ? t('category.unlimited')
    : String(Math.max(0, FREE_DAILY_LIMIT - (user?.dailyQuestionsUsed ?? 0)));

  const countLabel = questions.length >= POOL_LIMIT
    ? `${POOL_LIMIT}+`
    : String(questions.length);

  const samples = useMemo(() => questions.slice(0, SAMPLE_COUNT), [questions]);

  const onStart = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      const { data } = await api.post('/sessions/start', { categoryId });
      navigation.replace('Interview', {
        sessionId: data.sessionId,
        firstQuestion: data.question,
        category: data.category,
      });
    } catch (err) {
      // /sessions/start only returns 402 for premium-gated categories; the
      // daily quota is checked when an answer is submitted, not at start.
      setStartError(statusOf(err) === 402 ? t('category.premiumBody') : t('category.startFailed'));
    } finally {
      setStarting(false);
    }
  }, [categoryId, navigation, t]);

  const onUpgrade = useCallback(() => navigation.navigate('Subscription'), [navigation]);
  const onBack = useCallback(() => navigation.goBack(), [navigation]);
  const onRetry = useCallback(() => load(level, true), [load, level]);

  /* ---------------------------- error phases ---------------------------- */

  if (phase === 'notFound' || phase === 'error') {
    const notFound = phase === 'notFound';
    return (
      <Screen scroll>
        <EmptyState
          icon={notFound ? 'help-buoy-outline' : 'cloud-offline-outline'}
          tone="danger"
          title={t(notFound ? 'category.notFoundTitle' : 'category.errorTitle')}
          description={t(notFound ? 'category.notFoundBody' : 'category.errorBody')}
          actionLabel={t(notFound ? 'category.notFoundCta' : 'common.retry')}
          onAction={notFound ? onBack : onRetry}
        />
      </Screen>
    );
  }

  if (phase === 'loading') {
    return (
      <Screen scroll>
        <LoadingSkeleton />
      </Screen>
    );
  }

  /* ------------------------------- ready -------------------------------- */

  return (
    <Screen
      scroll
      contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.xl }}
      footer={
        <FooterBar>
          {startError ? (
            <View
              style={[
                styles.inlineError,
                {
                  backgroundColor: theme.colors.dangerMuted,
                  borderRadius: theme.radii.sm,
                  padding: theme.spacing.md,
                  gap: theme.spacing.sm,
                },
              ]}
            >
              <Ionicons name="alert-circle" size={theme.layout.icon.md} color={theme.colors.danger} />
              <Text role="caption" tone="danger" flex>{startError}</Text>
            </View>
          ) : null}

          <Button
            title={locked ? t('category.premiumCta') : t('category.start')}
            variant={locked ? 'accent' : 'primary'}
            size="lg"
            loading={starting}
            onPress={locked ? onUpgrade : onStart}
            iconRight={
              <Ionicons
                name={locked ? 'sparkles' : arrowForward}
                size={theme.layout.icon.md}
                color={locked ? theme.colors.onAccent : theme.colors.onPrimary}
              />
            }
            accessibilityLabel={locked ? t('category.premiumCta') : t('category.start')}
            accessibilityHint={locked ? t('category.premiumBody') : t('category.step1Body')}
          />

          {/* The button swaps its label for a spinner while loading, so the
              reason for the wait is spelled out beneath it. */}
          {starting ? (
            <Text role="caption" tone="muted" align="center">{t('category.starting')}</Text>
          ) : null}
        </FooterBar>
      }
    >
      {/* ---------------- Hero ---------------- */}
      <MotiView
        from={{ opacity: 0, translateY: theme.spacing.md }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: theme.motion.duration.normal }}
      >
        <View
          style={[
            styles.hero,
            {
              backgroundColor: theme.colors.primary,
              borderRadius: theme.radii.xl,
              padding: theme.spacing.xl,
              gap: theme.spacing.lg,
            },
            theme.shadow.brand,
          ]}
        >
          <View style={[styles.heroTop, { gap: theme.spacing.lg }]}>
            <View
              style={[
                styles.heroIcon,
                {
                  width: theme.layout.avatar.lg,
                  height: theme.layout.avatar.lg,
                  borderRadius: theme.radii.lg,
                  backgroundColor: theme.colors.onPrimary,
                },
              ]}
            >
              <Ionicons
                name={CATEGORY_ICON[category?.icon ?? ''] ?? 'briefcase-outline'}
                size={theme.layout.icon.xl}
                color={theme.colors.primary}
              />
            </View>

            <View style={styles.heroTitles}>
              <Text role="micro" weight="bold" tone="onBrand" style={styles.kicker}>
                {t('category.kicker')}
              </Text>
              <Text role="h1" weight="bold" tone="onBrand" numberOfLines={2}>
                {displayName}
              </Text>
            </View>
          </View>

          <Text role="body" tone="onBrand" style={styles.heroBody}>
            {description}
          </Text>

          <View style={[styles.badgeRow, { gap: theme.spacing.sm }]}>
            <Badge
              label={isPremiumCategory ? t('category.premiumBadge') : t('category.freeBadge')}
              tone="onDark"
              size="md"
              icon={isPremiumCategory ? 'star' : 'checkmark-circle'}
            />
            {!locked ? (
              <Badge
                label={`${countLabel} ${t('category.questionsAvailable')}`}
                tone="onDark"
                size="md"
                icon="albums-outline"
              />
            ) : null}
          </View>
        </View>
      </MotiView>

      {/* ---------------- Stat strip ---------------- */}
      <MotiView
        from={{ opacity: 0, translateY: theme.spacing.md }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: theme.motion.duration.normal, delay: theme.motion.stagger }}
      >
        <Card variant="outlined" padding="md">
          <View style={styles.statRow}>
            <StatCell
              icon="albums-outline"
              tone="primary"
              value={locked ? '—' : countLabel}
              label={t('category.questionsAvailable')}
            />
            <View style={[styles.statDivider, { backgroundColor: theme.colors.divider }]} />
            <StatCell
              icon="speedometer-outline"
              tone="success"
              value={t(`difficulty.${level}`)}
              label={t('difficulty.label')}
            />
            <View style={[styles.statDivider, { backgroundColor: theme.colors.divider }]} />
            <StatCell
              icon="flash-outline"
              tone="accent"
              value={remaining}
              label={t('category.remainingToday')}
            />
          </View>
        </Card>
      </MotiView>

      {/* ---------------- Difficulty ---------------- */}
      {!locked ? (
        <View>
          <SectionHeader title={t('difficulty.label')} subtitle={t('difficulty.hint')} />
          <View
            style={[styles.chipRow, { gap: theme.spacing.sm }]}
            accessibilityRole="radiogroup"
            accessibilityLabel={t('difficulty.label')}
          >
            {LEVELS.map((value) => {
              const selected = value === level;
              return (
                <Pressable
                  key={value}
                  onPress={() => setLevel(value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, disabled: poolLoading }}
                  accessibilityLabel={t(`difficulty.${value}`)}
                  disabled={poolLoading}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      // `layout.control.sm` (40) is below the 48px accessible
                      // minimum; a chip is a real control, so it gets the full
                      // touch target rather than the compact control height.
                      minHeight: theme.layout.touchTarget,
                      paddingHorizontal: theme.spacing.lg,
                      borderRadius: theme.radii.pill,
                      borderWidth: 1.5,
                      backgroundColor: selected ? theme.colors.primaryMuted : theme.colors.surface,
                      borderColor: selected ? theme.colors.primaryBorder : theme.colors.border,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <Text role="bodySm" weight="bold" tone={selected ? 'primary' : 'secondary'}>
                    {t(`difficulty.${value}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* ---------------- Premium gate ---------------- */}
      {locked ? (
        <Card variant="outlined" padding="lg" style={{ borderColor: theme.colors.accentBorder }}>
          <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <View
              style={[
                styles.lockIcon,
                {
                  width: theme.layout.avatar.lg,
                  height: theme.layout.avatar.lg,
                  borderRadius: theme.radii.pill,
                  backgroundColor: theme.colors.accentMuted,
                },
              ]}
            >
              <Ionicons name="lock-closed" size={theme.layout.icon.xl} color={theme.colors.accentText} />
            </View>
            <Text role="h3" weight="bold" align="center">{t('category.premiumTitle')}</Text>
            <Text role="bodySm" tone="muted" align="center">{t('category.premiumBody')}</Text>
            <Badge label={t('category.lockedSamples')} tone="accent" size="md" icon="eye-off-outline" />
          </View>
        </Card>
      ) : null}

      {/* ---------------- How it works ---------------- */}
      <View>
        <SectionHeader title={t('category.howItWorks')} />
        <Card variant="filled" padding="lg">
          <View style={{ gap: theme.spacing.lg }}>
            <StepRow index={1} title={t('category.step1Title')} body={t('category.step1Body')} />
            <StepRow index={2} title={t('category.step2Title')} body={t('category.step2Body')} />
            <StepRow index={3} title={t('category.step3Title')} body={t('category.step3Body')} />
          </View>
        </Card>
      </View>

      {/* ---------------- Sample questions ---------------- */}
      {!locked ? (
        <View>
          <SectionHeader title={t('category.samples')} subtitle={t('category.samplesHint')} />

          {poolLoading ? (
            <View style={{ gap: theme.spacing.md }}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={theme.layout.avatar.lg + theme.spacing.lg} radius={theme.radii.lg} />
              ))}
            </View>
          ) : samples.length === 0 ? (
            <Card variant="outlined" padding="none">
              <EmptyState
                compact
                icon="file-tray-outline"
                title={t('category.emptyTitle')}
                description={t('category.emptyBody')}
                actionLabel={level === 'all' ? undefined : t('category.emptyCta')}
                onAction={level === 'all' ? undefined : () => setLevel('all')}
              />
            </Card>
          ) : (
            <View style={{ gap: theme.spacing.md }}>
              {samples.map((q, i) => (
                <MotiView
                  key={q.id}
                  from={{ opacity: 0, translateY: theme.spacing.sm }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{
                    type: 'timing',
                    duration: theme.motion.duration.fast,
                    delay: i * theme.motion.stagger,
                  }}
                >
                  <Card variant="outlined" padding="md">
                    <View style={[styles.sampleRow, { gap: theme.spacing.md }]}>
                      <View
                        style={[
                          styles.sampleIndex,
                          {
                            width: theme.layout.avatar.sm,
                            height: theme.layout.avatar.sm,
                            borderRadius: theme.radii.sm,
                            backgroundColor: theme.colors.surfaceSunken,
                          },
                        ]}
                      >
                        <Text role="caption" weight="bold" tone="muted">{i + 1}</Text>
                      </View>
                      <View style={styles.sampleText}>
                        <Text role="bodySm" numberOfLines={3}>
                          {isEn ? q.questionEn : q.questionAr}
                        </Text>
                        <Badge
                          label={t(`difficulty.${q.difficulty}`)}
                          tone={q.difficulty === 'hard' ? 'danger' : q.difficulty === 'easy' ? 'success' : 'warning'}
                          style={{ marginTop: theme.spacing.sm }}
                        />
                      </View>
                    </View>
                  </Card>
                </MotiView>
              ))}
            </View>
          )}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'center' },
  heroIcon: { alignItems: 'center', justifyContent: 'center' },
  heroTitles: { flex: 1 },
  // Optical: the kicker sits tight above the display name rather than
  // floating at the scale's default leading.
  kicker: { opacity: 0.75, marginBottom: spacing.xxs },
  heroBody: { opacity: 0.88 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },

  statRow: { flexDirection: 'row', alignItems: 'stretch' },
  statCell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  statDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { alignItems: 'center', justifyContent: 'center' },

  stepRow: { flexDirection: 'row', alignItems: 'flex-start' },
  stepBullet: { alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1 },

  lockIcon: { alignItems: 'center', justifyContent: 'center' },

  sampleRow: { flexDirection: 'row', alignItems: 'flex-start' },
  sampleIndex: { alignItems: 'center', justifyContent: 'center' },
  sampleText: { flex: 1 },

  inlineError: { flexDirection: 'row', alignItems: 'center' },
});
