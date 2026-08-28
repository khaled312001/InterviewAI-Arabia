import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';

import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { useBalance } from '../store/balance';
import { useAppTheme, useDirection, useResponsive } from '../theme/useTheme';
import { accentForCategory, scoreTone } from '../theme/tokens';
import {
  Screen, Text, Card, Badge, Button, SectionHeader, ListRow, EmptyState,
  SkeletonTile, SkeletonRow,
} from '../components';
import {
  balanceLabel, categoryIcon, categoryName, durationLabel, formatShortDate,
  sessionAverage, sessionKind, sessionMeta,
  type CategoryLike, type SessionLike,
} from './mainShared';

const RECENT_LIMIT = 5;

/* ------------------------------------------------------------------ *
 * Category tile
 * ------------------------------------------------------------------ */

interface TileProps {
  category: CategoryLike & { id: number };
  index: number;
  width: string;
  gutter: number;
  onPress: (category: CategoryLike & { id: number }) => void;
}

const CategoryTile = React.memo(function CategoryTile({
  category, index, width, gutter, onPress,
}: TileProps) {
  const theme = useAppTheme();
  const { i18n, t } = useTranslation();
  const { chevronForward } = useDirection();

  const accent = accentForCategory(category.id);
  const name = categoryName(category, i18n.language);
  const press = useCallback(() => onPress(category), [onPress, category]);

  return (
    <MotiView
      from={{ opacity: 0, translateY: theme.spacing.md }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{
        type: 'timing',
        duration: theme.motion.duration.normal,
        delay: index * theme.motion.stagger,
      }}
      // Percentage width + half-gutter padding keeps the grid exact at any
      // column count; `gap` cannot be used here because percentage widths and
      // gaps together overflow the row.
      style={[styles.tileCell, { width: width as any, padding: gutter }]}
    >
      <Card
        onPress={press}
        padding="md"
        style={styles.tile}
        accessibilityLabel={name}
        accessibilityHint={t('home.categoriesSubtitle')}
      >
        {/* Filled, not tinted — and the coloured shadow is what carries the
            hue past the chip's own edge, so a grid of eight tiles reads as
            eight different things from arm's length instead of eight grey
            squares with a faint wash in them. */}
        <View
          style={[
            styles.tileIcon,
            theme.shadow.md,
            {
              width: theme.layout.avatar.md,
              height: theme.layout.avatar.md,
              borderRadius: theme.radii.md,
              backgroundColor: accent.solid,
              shadowColor: accent.solid,
            },
          ]}
        >
          <Ionicons
            name={categoryIcon(category.icon)}
            size={theme.layout.icon.lg}
            color="#FFFFFF"
          />
        </View>

        <Text role="body" weight="bold" numberOfLines={2} style={{ marginTop: theme.spacing.md }}>
          {name}
        </Text>

        <View style={[styles.tileFooter, { marginTop: theme.spacing.md }]}>
          {category.isPremium ? (
            <Badge tone="accent" icon="star" label={t('plan.premium')} />
          ) : (
            <Badge tone="primary" label={t('plan.free')} />
          )}
          <Ionicons
            name={chevronForward}
            size={theme.layout.icon.sm}
            color={theme.colors.textDisabled}
          />
        </View>
      </Card>
    </MotiView>
  );
});

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export function HomeScreen({ navigation }: any) {
  const { t, i18n } = useTranslation();
  const theme = useAppTheme();
  const { columns, maxWidth, screenPadding } = useResponsive();
  const { chevronForward } = useDirection();

  const user = useAuth((s) => s.user);
  const refreshMe = useAuth((s) => s.refreshMe);
  // The balance is the first thing this screen needs and the first thing the
  // server grants against: GET /user/balance is where a new account's ten free
  // minutes are created, so this call is what puts them on screen before the
  // user taps anything.
  const balance = useBalance((s) => s.balance);
  const balanceFailed = useBalance((s) => s.failed);
  const refreshBalance = useBalance((s) => s.refresh);

  const [categories, setCategories] = useState<(CategoryLike & { id: number })[] | null>(null);
  const [recent, setRecent] = useState<SessionLike[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  /** Categories change about once a month; sessions change every visit. */
  const loadCategories = useCallback(async () => {
    const { data } = await api.get('/categories');
    setCategories(data.categories ?? []);
  }, []);

  const loadRecent = useCallback(async () => {
    const { data } = await api.get('/sessions', { params: { limit: RECENT_LIMIT } });
    setRecent(data.sessions ?? []);
  }, []);

  const loadAll = useCallback(async () => {
    setFailed(false);
    const results = await Promise.allSettled([
      loadCategories(), loadRecent(), refreshMe(), refreshBalance(),
    ]);
    // Only the two data calls decide the error state; a stale /user/me or a
    // stale balance is survivable and must not blank out a screen that already
    // has content — the balance card says so itself instead.
    if (results[0].status === 'rejected' && results[1].status === 'rejected') {
      setFailed(true);
      setCategories((c) => c ?? []);
      setRecent((r) => r ?? []);
    }
  }, [loadCategories, loadRecent, refreshBalance, refreshMe]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Refresh only the volatile half on re-focus, and skip the focus event that
  // fires immediately after mount — the effect above already covered it.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) { firstFocus.current = false; return; }
      loadRecent().catch(() => {});
      refreshMe().catch(() => {});
      // Coming back from an interview, a practice session or a purchase — the
      // three things that move the balance — always lands here.
      refreshBalance().catch(() => {});
    }, [loadRecent, refreshBalance, refreshMe]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  const openCategory = useCallback((category: CategoryLike & { id: number }) => {
    navigation.navigate('CategoryDetails', {
      categoryId: category.id,
      nameAr: category.nameAr,
      nameEn: category.nameEn,
    });
  }, [navigation]);

  const openSession = useCallback((id: string | number) => {
    navigation.navigate('SessionSummary', { sessionId: id });
  }, [navigation]);

  const goPremium = useCallback(() => navigation.navigate('Subscription'), [navigation]);
  const goMeeting = useCallback(() => navigation.navigate('MeetingSetup'), [navigation]);
  const goHistory = useCallback(() => navigation.navigate('History'), [navigation]);

  // `balance.plan` is the same premium flag `/user/me` carries, but it is the
  // one that came back with the minutes, so the badge and the card can never
  // disagree with each other.
  const isPremium = (balance?.plan ?? user?.plan) === 'premium';
  const availableSeconds = balance?.availableSeconds ?? 0;
  const remainingLabel = balance ? balanceLabel(availableSeconds, t) : '';
  /** Only once a balance has actually arrived — an unloaded card is not empty. */
  const empty = !!balance && availableSeconds <= 0;
  const firstLetter = (user?.name?.trim()?.[0] ?? '?').toUpperCase();

  /**
   * The one line under the balance. Ordered by what the user most needs to
   * know: a stale number first, then the welcome gift, then an empty balance,
   * then the subscription's own expiry.
   */
  const balanceHint =
    !balance ? (balanceFailed ? t('home.balanceOffline') : null)
    : balance.trialJustGranted
      ? t('home.balanceTrialHint', { label: durationLabel(balance.trialSeconds, t) })
    : availableSeconds <= 0 ? t('home.balanceEmpty')
    : balance.subSeconds > 0 && balance.subExpiresAt
      ? t('home.balanceSubHint', { date: formatShortDate(balance.subExpiresAt, i18n.language) })
    : t('home.balanceHint');

  const gutter = theme.layout.gridGap / 2;
  const tileWidth = useMemo(() => `${100 / columns}%`, [columns]);

  /* ------------------------------ hero ------------------------------ */

  const hero = (
    <LinearGradient
      colors={[...theme.gradients.hero]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.hero,
        {
          borderBottomLeftRadius: theme.radii.xl,
          borderBottomRightRadius: theme.radii.xl,
          paddingTop: theme.spacing.lg,
          // Deep enough that the balance card can ride the bottom edge.
          paddingBottom: theme.spacing['5xl'],
        },
      ]}
    >
      <View
        style={[
          styles.heroInner,
          { paddingHorizontal: screenPadding, maxWidth: maxWidth ?? undefined },
        ]}
      >
        <View style={[styles.heroRow, { gap: theme.spacing.md }]}>
          <View
            style={[
              styles.avatar,
              {
                width: theme.layout.avatar.md,
                height: theme.layout.avatar.md,
                borderRadius: theme.layout.avatar.md / 2,
                backgroundColor: theme.colors.textOnBrand,
              },
            ]}
          >
            <Text role="h4" weight="bold" tone="primary">{firstLetter}</Text>
          </View>

          <View style={styles.heroText}>
            <Text role="caption" tone="onBrand" style={styles.heroGreeting}>
              {t('home.welcome')}
            </Text>
            <Text role="h3" weight="bold" tone="onBrand" numberOfLines={1}>
              {user?.name ?? '—'}
            </Text>
          </View>

          <Pressable
            onPress={goPremium}
            accessibilityRole="button"
            accessibilityLabel={isPremium ? t('plan.premium') : t('plan.upgradeLong')}
            hitSlop={theme.spacing.sm}
            // The Badge itself is only ~31px tall; without an explicit minimum
            // the tap target lands under the 48px floor even with the hitSlop.
            style={({ pressed }) => [
              styles.planTap,
              { minHeight: theme.layout.touchTarget, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Badge
              tone={isPremium ? 'accent' : 'onDark'}
              size="md"
              icon={isPremium ? 'star' : 'sparkles-outline'}
              label={isPremium ? t('plan.premium') : t('plan.free')}
            />
          </Pressable>
        </View>
      </View>
    </LinearGradient>
  );

  /* -------------------------- balance card -------------------------- *
   *
   * Where the daily question counter used to sit. The count is gone: the app
   * no longer knows a limit, and the only honest number is the one the server
   * just sent. While it is loading the card shows the label, never a zero —
   * "0 minutes" briefly on every cold start is how you teach people to
   * distrust the meter.
   * ------------------------------------------------------------------ */

  const balanceCard = (
    <MotiView
      from={{ opacity: 0, translateY: theme.spacing.md }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: theme.motion.duration.slow }}
      style={{ marginTop: -theme.spacing['3xl'] }}
    >
      <Card padding="md">
        <View style={[styles.row, { gap: theme.spacing.md }]}>
          <View
            style={[
              styles.balanceIcon,
              {
                width: theme.layout.avatar.md,
                height: theme.layout.avatar.md,
                borderRadius: theme.radii.md,
                backgroundColor: empty ? theme.colors.accentMuted : theme.colors.primaryMuted,
              },
            ]}
          >
            <Ionicons
              name={empty ? 'alert-circle' : 'time'}
              size={theme.layout.icon.md}
              color={empty ? theme.colors.accentText : theme.colors.primary}
            />
          </View>

          <View style={styles.grow}>
            <Text role="body" weight="bold" numberOfLines={1}>
              {balance
                ? t('home.balanceTitle', { label: remainingLabel })
                : t('home.balanceLoading')}
            </Text>
            {balanceHint ? (
              <Text role="caption" tone="muted" numberOfLines={2}>{balanceHint}</Text>
            ) : null}
          </View>

          <Button
            title={t('home.buyMinutes')}
            onPress={goPremium}
            variant={empty ? 'accent' : 'secondary'}
            size="sm"
            fullWidth={false}
            accessibilityLabel={t('plan.upgradeLong')}
          />
        </View>
      </Card>
    </MotiView>
  );

  /* --------------------------- meeting CTA -------------------------- */

  const meetingCta = (
    <MotiView
      from={{ opacity: 0, translateY: theme.spacing.md }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{
        type: 'timing',
        duration: theme.motion.duration.slow,
        delay: theme.motion.stagger * 2,
      }}
    >
      <Pressable
        onPress={goMeeting}
        accessibilityRole="button"
        accessibilityLabel={t('home.meetingTitle')}
        accessibilityHint={t('home.meetingSubtitle')}
        style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.985 : 1 }] }]}
      >
        <LinearGradient
          colors={[...theme.gradients.live]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.row,
            {
              gap: theme.spacing.md,
              padding: theme.spacing.lg,
              borderRadius: theme.radii.lg,
              minHeight: theme.layout.touchTarget,
            },
            theme.shadow.md,
          ]}
        >
          <View
            style={[
              styles.balanceIcon,
              {
                width: theme.layout.avatar.md,
                height: theme.layout.avatar.md,
                borderRadius: theme.radii.md,
                backgroundColor: theme.colors.surface,
              },
            ]}
          >
            <Ionicons name="videocam" size={theme.layout.icon.lg} color={theme.colors.success} />
          </View>

          <View style={styles.grow}>
            <View style={[styles.row, { gap: theme.spacing.sm }]}>
              <Text role="bodyLg" weight="bold" tone="onBrand" numberOfLines={1} flex>
                {t('home.meetingTitle')}
              </Text>
              <Badge tone="onDark" label={t('home.meetingNew')} />
            </View>
            <Text role="caption" tone="onBrand" numberOfLines={2} style={styles.ctaSubtitle}>
              {t('home.meetingSubtitle')}
            </Text>
          </View>

          <Ionicons
            name={chevronForward}
            size={theme.layout.icon.md}
            color={theme.colors.textOnBrand}
          />
        </LinearGradient>
      </Pressable>
    </MotiView>
  );

  /* ---------------------------- categories -------------------------- */

  const categoriesSection = (
    <View>
      <SectionHeader title={t('home.categories')} subtitle={t('home.categoriesSubtitle')} />

      {categories === null ? (
        <View style={[styles.grid, { marginHorizontal: -gutter }]}>
          {Array.from({ length: columns * 2 }).map((_, i) => (
            <View key={i} style={[styles.tileCell, { width: tileWidth as any, padding: gutter }]}>
              <SkeletonTile />
            </View>
          ))}
        </View>
      ) : categories.length === 0 ? (
        <Card padding="none">
          <EmptyState
            compact
            icon="grid-outline"
            title={t('home.categoriesEmptyTitle')}
            description={t('home.categoriesEmptyBody')}
          />
        </Card>
      ) : (
        <View style={[styles.grid, { marginHorizontal: -gutter }]}>
          {categories.map((c, i) => (
            <CategoryTile
              key={c.id}
              category={c}
              index={i}
              width={tileWidth}
              gutter={gutter}
              onPress={openCategory}
            />
          ))}
        </View>
      )}
    </View>
  );

  /* ------------------------------ recent ---------------------------- */

  const recentSection = (
    <View>
      <SectionHeader
        title={t('home.recent')}
        actionLabel={recent && recent.length > 0 ? t('home.viewAll') : undefined}
        onAction={recent && recent.length > 0 ? goHistory : undefined}
      />

      {recent === null ? (
        <View style={{ gap: theme.layout.stackGap }}>
          {Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)}
        </View>
      ) : recent.length === 0 ? (
        <Card padding="none">
          <EmptyState
            compact
            icon="chatbubbles-outline"
            title={t('home.noSessionsTitle')}
            description={t('home.noSessions')}
            actionLabel={t('home.noSessionsAction')}
            onAction={goMeeting}
          />
        </Card>
      ) : (
        <Card padding="none">
          {recent.map((s, i) => {
            const avg = sessionAverage(s);
            const live = sessionKind(s) === 'meeting';
            return (
              <ListRow
                key={String(s.id)}
                icon={live ? 'videocam-outline' : categoryIcon(s.category?.icon)}
                iconTone={live ? 'success' : 'primary'}
                title={categoryName(s.category, i18n.language)}
                subtitle={sessionMeta(s, t)}
                divider={i < recent.length - 1}
                onPress={() => openSession(s.id)}
                trailing={
                  avg > 0 ? (
                    <Badge tone={scoreTone(avg)} size="md" label={avg.toFixed(1)} />
                  ) : undefined
                }
              />
            );
          })}
        </Card>
      )}
    </View>
  );

  /* ------------------------------ render ---------------------------- */

  if (failed) {
    return (
      <Screen scroll refreshing={refreshing} onRefresh={onRefresh}>
        <EmptyState
          tone="danger"
          icon="cloud-offline-outline"
          title={t('common.loadErrorTitle')}
          description={t('common.loadErrorBody')}
          actionLabel={t('common.retry')}
          onAction={onRefresh}
        />
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      refreshing={refreshing}
      onRefresh={onRefresh}
      header={hero}
      contentStyle={{ gap: theme.spacing['2xl'] }}
    >
      {balanceCard}
      {meetingCta}
      {categoriesSection}
      {recentSection}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },

  hero: { width: '100%', overflow: 'hidden' },
  // Keeps the hero colour full-bleed while its content stays inside the same
  // optical column as the rest of the screen on tablet/desktop. The cap itself
  // comes from `useResponsive().maxWidth` at the call site.
  heroInner: { width: '100%', alignSelf: 'center' },
  heroRow: { flexDirection: 'row', alignItems: 'center' },
  heroText: { flex: 1 },
  heroGreeting: { opacity: 0.85 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  planTap: { justifyContent: 'center' },

  balanceIcon: { alignItems: 'center', justifyContent: 'center' },

  ctaSubtitle: { opacity: 0.9 },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tileCell: {},
  tile: { flex: 1 },
  tileIcon: { alignItems: 'center', justifyContent: 'center' },
  tileFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 'auto',
  },
});
