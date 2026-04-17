import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useAppTheme } from '../theme/useTheme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'CategoryDetails'>;

export function CategoryDetailsScreen({ route, navigation }: Props) {
  const { categoryId, nameAr } = route.params;
  const theme = useAppTheme();
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/categories/${categoryId}/questions`, { params: { limit: 1 } });
        setCount(data.questions.length);
      } catch {
        setCount(0);
      }
    })();
  }, [categoryId]);

  async function onStart() {
    setLoading(true);
    try {
      const { data } = await api.post('/sessions/start', { categoryId });
      navigation.replace('Interview', {
        sessionId: data.sessionId,
        firstQuestion: data.question,
        category: data.category,
      });
    } catch (err: any) {
      Alert.alert('خطأ', err?.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg }]}>
      <View style={styles.container}>
        <Card>
          <Text style={[styles.title, { color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold }]}>
            {nameAr}
          </Text>
          <Text style={{ color: theme.colors.textMuted, fontFamily: theme.typography.fontFamily }}>
            جلسة تدريبية تتضمن أسئلة متنوعة مع تقييم فوري من الذكاء الاصطناعي.
          </Text>
          <View style={{ height: 12 }} />
          {count === null ? <ActivityIndicator /> : (
            <Text style={{ color: theme.colors.textMuted, fontFamily: theme.typography.fontFamily }}>
              الأسئلة المتاحة: {count}+
            </Text>
          )}
        </Card>
        <Button title="ابدأ الجلسة الآن" onPress={onStart} loading={loading} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, padding: 16, gap: 16 },
  title: { fontSize: 22, marginBottom: 6 },
});
