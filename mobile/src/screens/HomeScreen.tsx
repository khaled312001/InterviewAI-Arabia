import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { Card } from '../components/Card';
import { useAppTheme } from '../theme/useTheme';

const ICON_MAP: Record<string, any> = {
  code: 'code-slash', calculator: 'calculator', megaphone: 'megaphone',
  users: 'people', headphones: 'headset', 'trending-up': 'trending-up', palette: 'color-palette',
};

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

  useFocusEffect(useCallback(() => { load().catch(() => {}); refreshMe().catch(() => {}); }, [load, refreshMe]));
  useEffect(() => { load().catch(() => {}); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([load(), refreshMe()]);
    setRefreshing(false);
  };

  const remaining = user?.plan === 'premium' ? '∞' : Math.max(0, 5 - (user?.dailyQuestionsUsed ?? 0));

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg }]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <MotiView from={{ opacity: 0, translateY: 8 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 300 }}>
          <Card style={{ backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }}>
            <Text style={[styles.hello, { fontFamily: theme.typography.fontFamilyBold }]}>
              {t('home.hello', { name: user?.name ?? '—' })}
            </Text>
            <View style={styles.row}>
              <View style={styles.badge}>
                <Text style={[styles.badgeText, { fontFamily: theme.typography.fontFamilyBold }]}>
                  {user?.plan === 'premium' ? t('home.premium') : t('home.free')}
                </Text>
              </View>
              <Text style={{ color: '#E7EEF9', fontFamily: theme.typography.fontFamily }}>
                {t('home.questionsLeft', { count: remaining })}
              </Text>
            </View>
          </Card>
        </MotiView>

        <Text style={[styles.section, { color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold }]}>
          {t('home.categories')}
        </Text>
        <View style={styles.grid}>
          {categories.map((c, i) => (
            <MotiView
              key={c.id}
              from={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'timing', duration: 280, delay: i * 40 }}
              style={styles.cell}
            >
              <Pressable
                onPress={() => navigation.navigate('CategoryDetails', { categoryId: c.id, nameAr: c.nameAr, nameEn: c.nameEn })}
                style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
              >
                <Card>
                  <View style={[styles.iconSquare, { backgroundColor: theme.colors.primary + '15' }]}>
                    <Ionicons name={ICON_MAP[c.icon] || 'briefcase'} size={26} color={theme.colors.primary} />
                  </View>
                  <Text style={[styles.cardTitle, { color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold }]}>
                    {c.nameAr}
                  </Text>
                  <Text style={{ color: theme.colors.textMuted, fontSize: 12, fontFamily: theme.typography.fontFamily }}>
                    {c.isPremium ? 'مميز' : t('home.free')}
                  </Text>
                </Card>
              </Pressable>
            </MotiView>
          ))}
        </View>

        <Text style={[styles.section, { color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold }]}>
          {t('home.recent')}
        </Text>
        {recent.length === 0 ? (
          <Card>
            <Text style={{ color: theme.colors.textMuted, textAlign: 'center', fontFamily: theme.typography.fontFamily }}>
              {t('home.noSessions')}
            </Text>
          </Card>
        ) : (
          recent.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => navigation.navigate('SessionSummary', { sessionId: s.id })}
              style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
            >
              <Card>
                <View style={styles.row}>
                  <Text style={{ color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold }}>
                    {s.category?.nameAr}
                  </Text>
                  <Text style={{ color: theme.colors.primary, fontFamily: theme.typography.fontFamilyBold }}>
                    {s.totalScore}
                  </Text>
                </View>
                <Text style={{ color: theme.colors.textMuted, fontSize: 12, fontFamily: theme.typography.fontFamily }}>
                  {new Date(s.startedAt).toLocaleString('ar-EG')}
                </Text>
              </Card>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  hello: { color: '#fff', fontSize: 20, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { color: '#fff', fontSize: 12 },
  section: { fontSize: 17, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { width: '48%' },
  iconSquare: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  cardTitle: { fontSize: 16, marginBottom: 2 },
});
