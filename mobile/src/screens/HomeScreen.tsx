import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { useAppTheme } from '../theme/useTheme';

const CATEGORY_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  code: 'code-slash-outline',
  calculator: 'calculator-outline',
  megaphone: 'megaphone-outline',
  users: 'people-outline',
  headphones: 'headset-outline',
  'trending-up': 'trending-up-outline',
  palette: 'color-palette-outline',
};

// A fixed, visually-diverse palette for category tiles so the home page
// doesn't feel monotonous. Keeps it on-brand by using adjusted brand+accent hues.
const TILE_ACCENTS = [
  { bg: 'rgba(45,108,224,0.16)',  fg: '#4E8CF5' }, // blue
  { bg: 'rgba(16,185,129,0.16)',  fg: '#10B981' }, // emerald
  { bg: 'rgba(245,177,47,0.18)',  fg: '#F5B12F' }, // amber
  { bg: 'rgba(239,68,68,0.14)',   fg: '#EF4444' }, // red
  { bg: 'rgba(168,85,247,0.16)',  fg: '#A855F7' }, // purple
  { bg: 'rgba(14,165,233,0.16)',  fg: '#0EA5E9' }, // cyan
  { bg: 'rgba(236,72,153,0.14)',  fg: '#EC4899' }, // pink
];

function scoreColor(score: number, theme: any) {
  if (score >= 8) return theme.colors.success;
  if (score >= 5) return theme.colors.accent;
  return theme.colors.danger;
}

export function HomeScreen({ navigation }: any) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const user = useAuth((s) => s.user);
  const refreshMe = useAuth((s) => s.refreshMe);

  const [categories, setCategories] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [cats, sessions] = await Promise.all([
      api.get('/categories'),
      api.get('/sessions', { params: { limit: 5 } }),
    ]);
    setCategories(cats.data.categories);
    setRecent(sessions.data.sessions);
  }, []);

  useFocusEffect(useCallback(() => {
    load().catch(() => {});
    refreshMe().catch(() => {});
  }, [load, refreshMe]));

  useEffect(() => { load().catch(() => {}); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([load(), refreshMe()]);
    setRefreshing(false);
  };

  const remaining = user?.plan === 'premium' ? t('home.unlimited') : String(Math.max(0, 5 - (user?.dailyQuestionsUsed ?? 0)));
  const firstLetter = (user?.name?.trim()?.[0] ?? '?').toUpperCase();
  const textBold = { fontFamily: theme.typography.fontFamilyBold };
  const textRegular = { fontFamily: theme.typography.fontFamily };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
      >
        {/* -------- Hero header -------- */}
        <View style={[styles.hero, { backgroundColor: theme.colors.primary }]}>
          <View style={styles.heroBgDot1} />
          <View style={styles.heroBgDot2} />
          <View style={styles.heroTopRow}>
            <View style={styles.avatarWrap}>
              <View style={[styles.avatar, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
                <Text style={[styles.avatarText, textBold]}>{firstLetter}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.greeting, textRegular]}>{t('home.welcome')}</Text>
                <Text style={[styles.greetingName, textBold]} numberOfLines={1}>
                  {user?.name ?? '—'}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={() => navigation.navigate('Subscription')}
              style={({ pressed }) => [
                styles.planBadge,
                {
                  backgroundColor: user?.plan === 'premium' ? theme.colors.accent : 'rgba(255,255,255,0.18)',
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Ionicons
                name={user?.plan === 'premium' ? 'star' : 'sparkles-outline'}
                size={14}
                color="#fff"
                style={{ marginStart: 4 }}
              />
              <Text style={[styles.planBadgeText, textBold]}>
                {user?.plan === 'premium' ? t('home.premium') : t('home.free')}
              </Text>
            </Pressable>
          </View>

          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 420 }}
            style={styles.quotaCard}
          >
            <View style={styles.quotaIconBg}>
              <Ionicons name="flash" size={18} color={theme.colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.quotaLabel, textRegular]}>{t('home.questionsLeft', { count: remaining })}</Text>
              <Text style={[styles.quotaHint, textRegular]}>
                {user?.plan === 'premium'
                  ? 'استمتع بعدد لا محدود من الأسئلة'
                  : 'الحد اليومي 5 أسئلة — ترقّى للوصول الكامل'}
              </Text>
            </View>
            {user?.plan !== 'premium' && (
              <Pressable
                onPress={() => navigation.navigate('Subscription')}
                style={({ pressed }) => [styles.upgradeBtn, { opacity: pressed ? 0.8 : 1 }]}
              >
                <Text style={[styles.upgradeBtnText, textBold]}>ترقية</Text>
                <Ionicons name="arrow-back" size={14} color={theme.colors.primary} style={{ marginStart: 4 }} />
              </Pressable>
            )}
          </MotiView>
        </View>

        {/* -------- Meeting CTA -------- */}
        <View style={styles.section}>
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 420, delay: 120 }}
          >
            <Pressable
              onPress={() => {
                // If exactly one free category exists, jump straight to it; else prompt.
                const freeCats = categories.filter((c) => !c.isPremium);
                const target = freeCats[0] || categories[0];
                if (!target) return;
                navigation.navigate('Meeting', { categoryId: target.id, categoryName: target.nameAr });
              }}
              style={({ pressed }) => [
                styles.meetingCta,
                {
                  backgroundColor: '#10B981',
                  opacity: pressed ? 0.92 : 1,
                  transform: [{ scale: pressed ? 0.99 : 1 }],
                },
              ]}
            >
              <View style={styles.meetingCtaIconWrap}>
                <Ionicons name="videocam" size={26} color="#10B981" />
                <View style={styles.meetingCtaLive}>
                  <Text style={[textBold, { color: '#fff', fontSize: 9 }]}>LIVE</Text>
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.meetingCtaTitleRow}>
                  <Text style={[styles.meetingCtaTitle, textBold]}>مقابلة مباشرة مع سارة</Text>
                  <View style={styles.meetingCtaNewBadge}>
                    <Text style={[textBold, { color: '#10B981', fontSize: 9 }]}>جديد</Text>
                  </View>
                </View>
                <Text style={[styles.meetingCtaSubtitle, textRegular]}>
                  مقابلة فيديو بالصوت والكاميرا مع مسؤولة موارد بشرية ذكية
                </Text>
              </View>
              <Ionicons name="chevron-back" size={20} color="#fff" />
            </Pressable>
          </MotiView>
        </View>

        {/* -------- Categories -------- */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sectionTitle, textBold, { color: theme.colors.text }]}>
                {t('home.categories')}
              </Text>
              <Text style={[styles.sectionSubtitle, textRegular, { color: theme.colors.textMuted }]}>
                {t('home.categoriesSubtitle')}
              </Text>
            </View>
          </View>

          <View style={styles.grid}>
            {categories.map((c, i) => {
              const accent = TILE_ACCENTS[i % TILE_ACCENTS.length];
              return (
                <MotiView
                  key={c.id}
                  from={{ opacity: 0, translateY: 12 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: 'timing', duration: 320, delay: i * 40 }}
                  style={styles.tileWrap}
                >
                  <Pressable
                    onPress={() => navigation.navigate('CategoryDetails', {
                      categoryId: c.id, nameAr: c.nameAr, nameEn: c.nameEn,
                    })}
                    style={({ pressed }) => [
                      styles.tile,
                      {
                        backgroundColor: theme.colors.surface,
                        borderColor: theme.colors.border,
                        transform: [{ scale: pressed ? 0.98 : 1 }],
                      },
                    ]}
                  >
                    <View style={[styles.tileIcon, { backgroundColor: accent.bg }]}>
                      <Ionicons
                        name={CATEGORY_ICON[c.icon] || 'briefcase-outline'}
                        size={24}
                        color={accent.fg}
                      />
                    </View>
                    <Text style={[styles.tileTitle, textBold, { color: theme.colors.text }]}>
                      {c.nameAr}
                    </Text>
                    <View style={styles.tileFooter}>
                      {c.isPremium ? (
                        <View style={[styles.pillPremium, { backgroundColor: theme.colors.accent + '22' }]}>
                          <Ionicons name="star" size={11} color={theme.colors.accent} />
                          <Text style={[styles.pillText, textBold, { color: theme.colors.accent }]}>مميّز</Text>
                        </View>
                      ) : (
                        <View style={[styles.pillFree, { backgroundColor: theme.colors.primarySoft }]}>
                          <Text style={[styles.pillText, textBold, { color: theme.colors.primary }]}>
                            {t('home.free')}
                          </Text>
                        </View>
                      )}
                      <Ionicons name="chevron-back" size={16} color={theme.colors.textMuted} />
                    </View>
                  </Pressable>
                </MotiView>
              );
            })}
          </View>
        </View>

        {/* -------- Recent sessions -------- */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, textBold, { color: theme.colors.text }]}>
              {t('home.recent')}
            </Text>
            {recent.length > 0 && (
              <Pressable onPress={() => navigation.navigate('History')}>
                <Text style={[styles.viewAll, textBold, { color: theme.colors.primary }]}>
                  {t('home.viewAll')}
                </Text>
              </Pressable>
            )}
          </View>

          {recent.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <View style={[styles.emptyIconWrap, { backgroundColor: theme.colors.primarySoft }]}>
                <Ionicons name="chatbubbles-outline" size={28} color={theme.colors.primary} />
              </View>
              <Text style={[styles.emptyText, textRegular, { color: theme.colors.textMuted }]}>
                {t('home.noSessions')}
              </Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {recent.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => navigation.navigate('SessionSummary', { sessionId: s.id })}
                  style={({ pressed }) => [
                    styles.sessionRow,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.border,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <View style={[styles.sessionIcon, { backgroundColor: theme.colors.primarySoft }]}>
                    <Ionicons name="mic-outline" size={18} color={theme.colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sessionTitle, textBold, { color: theme.colors.text }]} numberOfLines={1}>
                      {s.category?.nameAr ?? '—'}
                    </Text>
                    <Text style={[styles.sessionMeta, textRegular, { color: theme.colors.textMuted }]}>
                      {new Date(s.startedAt).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' })}
                      {' · '}
                      {s._count?.answers ?? 0} {s._count?.answers === 1 ? 'سؤال' : 'أسئلة'}
                    </Text>
                  </View>
                  <View style={[styles.scorePill, { backgroundColor: scoreColor(s.totalScore / Math.max(1, s._count?.answers || 1), theme) + '22' }]}>
                    <Text style={[styles.scoreText, textBold, { color: scoreColor(s.totalScore / Math.max(1, s._count?.answers || 1), theme) }]}>
                      {s.totalScore}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  // Hero
  hero: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: 'hidden',
    position: 'relative',
  },
  heroBgDot1: {
    position: 'absolute',
    width: 180, height: 180, borderRadius: 90,
    backgroundColor: 'rgba(255,255,255,0.07)',
    top: -40, right: -40,
  },
  heroBgDot2: {
    position: 'absolute',
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.05)',
    bottom: 30, left: -30,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  avatarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)',
  },
  avatarText: { color: '#fff', fontSize: 18 },
  greeting: { color: 'rgba(255,255,255,0.78)', fontSize: 12 },
  greetingName: { color: '#fff', fontSize: 18, marginTop: 2 },
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 999,
    gap: 4,
  },
  planBadgeText: { color: '#fff', fontSize: 12 },

  quotaCard: {
    marginTop: 20,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  quotaIconBg: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: 'rgba(245,177,47,0.22)',
    alignItems: 'center', justifyContent: 'center',
  },
  quotaLabel: { color: '#fff', fontSize: 15 },
  quotaHint: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },
  upgradeBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 7, paddingHorizontal: 12,
    borderRadius: 999,
  },
  upgradeBtnText: { color: '#1E54BF', fontSize: 12 },

  // Sections
  section: { paddingHorizontal: 16, marginTop: 24 },
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionTitle: { fontSize: 18 },
  sectionSubtitle: { fontSize: 12, marginTop: 2 },
  viewAll: { fontSize: 13 },

  // Grid tiles
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tileWrap: { width: '48%' },
  tile: {
    borderRadius: 18,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    minHeight: 132,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 2 },
      default: { boxShadow: '0 4px 14px rgba(0,0,0,0.06)' },
    }),
  },
  tileIcon: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  tileTitle: { fontSize: 16 },
  tileFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 'auto',
  },
  pillPremium: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999,
  },
  pillFree: {
    paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999,
  },
  pillText: { fontSize: 11 },

  // Empty state
  emptyCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 28,
    alignItems: 'center',
    gap: 12,
  },
  emptyIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyText: { textAlign: 'center', fontSize: 14, lineHeight: 22 },

  // Session row
  sessionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sessionIcon: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  sessionTitle: { fontSize: 15 },
  sessionMeta: { fontSize: 12, marginTop: 2 },
  scorePill: {
    minWidth: 42, height: 32,
    borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 10,
  },
  scoreText: { fontSize: 15 },

  // Meeting CTA
  meetingCta: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 18,
    gap: 14,
    ...Platform.select({
      ios: { shadowColor: '#10B981', shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
      android: { elevation: 5 },
      default: { boxShadow: '0 8px 24px rgba(16,185,129,0.35)' },
    }),
  },
  meetingCtaIconWrap: {
    width: 52, height: 52, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  meetingCtaLive: {
    position: 'absolute', top: -6, left: -6,
    paddingHorizontal: 6, paddingVertical: 2,
    backgroundColor: '#EF4444', borderRadius: 999,
    borderWidth: 2, borderColor: '#10B981',
  },
  meetingCtaTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meetingCtaTitle: { color: '#fff', fontSize: 16 },
  meetingCtaNewBadge: {
    backgroundColor: '#fff', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  meetingCtaSubtitle: { color: 'rgba(255,255,255,0.88)', fontSize: 12, marginTop: 4, lineHeight: 18 },
});
