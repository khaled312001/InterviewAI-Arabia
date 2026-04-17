import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { useAppTheme } from '../theme/useTheme';
import { useTranslation } from 'react-i18next';

export function HistoryScreen({ navigation }: any) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<any[] | null>(null);

  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const { data } = await api.get('/sessions', { params: { limit: 50 } });
        setSessions(data.sessions);
      } catch { setSessions([]); }
    })();
  }, []));

  if (sessions === null) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg }]}>
      <FlatList
        data={sessions}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListEmptyComponent={
          <Card>
            <Text style={{ color: theme.colors.textMuted, textAlign: 'center', fontFamily: theme.typography.fontFamily }}>
              {t('history.empty')}
            </Text>
          </Card>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate('SessionSummary', { sessionId: item.id })}>
            <Card>
              <View style={styles.row}>
                <Text style={{ color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold }}>
                  {item.category?.nameAr ?? '—'}
                </Text>
                <Text style={{ color: theme.colors.primary, fontFamily: theme.typography.fontFamilyBold }}>
                  {item.totalScore}
                </Text>
              </View>
              <Text style={{ color: theme.colors.textMuted, fontFamily: theme.typography.fontFamily, fontSize: 12, marginTop: 4 }}>
                {new Date(item.startedAt).toLocaleString('ar-EG')}  ·  {item._count?.answers ?? 0} أسئلة
              </Text>
            </Card>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
