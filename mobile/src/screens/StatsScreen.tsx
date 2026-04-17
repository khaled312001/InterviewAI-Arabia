import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { useAppTheme } from '../theme/useTheme';
import { useTranslation } from 'react-i18next';

function Stat({ label, value }: { label: string; value: string | number }) {
  const theme = useAppTheme();
  return (
    <Card style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ color: theme.colors.textMuted, fontFamily: theme.typography.fontFamily, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: theme.colors.primary, fontSize: 28, fontFamily: theme.typography.fontFamilyBold, marginTop: 4 }}>{value}</Text>
    </Card>
  );
}

export function StatsScreen() {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const [stats, setStats] = useState<any>(null);

  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const { data } = await api.get('/user/stats');
        setStats(data);
      } catch { setStats({ totalSessions: 0, totalAnswers: 0, averageScore: 0, recentSessions: [], categoryBreakdown: [] }); }
    })();
  }, []));

  if (!stats) {
    return <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg, alignItems: 'center', justifyContent: 'center' }]}>
      <ActivityIndicator color={theme.colors.primary} />
    </SafeAreaView>;
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg }]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={{ color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold, fontSize: 20 }}>
          {t('stats.title')}
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Stat label={t('stats.totalSessions')} value={stats.totalSessions} />
          <Stat label={t('stats.totalAnswers')} value={stats.totalAnswers} />
          <Stat label={t('stats.averageScore')} value={Number(stats.averageScore).toFixed(1)} />
        </View>

        <Text style={{ color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold, marginTop: 8 }}>
          {t('stats.breakdown')}
        </Text>
        {(stats.categoryBreakdown ?? []).length === 0 ? (
          <Card>
            <Text style={{ color: theme.colors.textMuted, textAlign: 'center', fontFamily: theme.typography.fontFamily }}>
              لا توجد بيانات بعد.
            </Text>
          </Card>
        ) : (
          stats.categoryBreakdown.map((b: any) => (
            <Card key={b.categoryId}>
              <View style={styles.row}>
                <Text style={{ color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold }}>
                  قسم #{b.categoryId}
                </Text>
                <Text style={{ color: theme.colors.primary, fontFamily: theme.typography.fontFamilyBold }}>
                  {Number(b._avg?.totalScore ?? 0).toFixed(1)}
                </Text>
              </View>
              <Text style={{ color: theme.colors.textMuted, fontFamily: theme.typography.fontFamily, fontSize: 12 }}>
                جلسات: {b._count?._all ?? 0}
              </Text>
            </Card>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
});
