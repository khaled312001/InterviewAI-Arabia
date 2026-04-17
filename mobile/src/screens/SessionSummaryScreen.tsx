import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Share, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useAppTheme } from '../theme/useTheme';

export function SessionSummaryScreen({ route, navigation }: any) {
  const { sessionId } = route.params;
  const theme = useAppTheme();
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/sessions/${sessionId}`);
        setSession(data.session);
      } catch { setSession({ category: {}, answers: [], totalScore: 0 }); }
    })();
  }, [sessionId]);

  if (!session) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  const avg = session.answers.length
    ? (session.answers.reduce((a: number, x: any) => a + (x.aiScore || 0), 0) / session.answers.length).toFixed(1)
    : '—';

  const onShare = () => Share.share({
    message: `حصلت على ${session.totalScore} نقطة في جلسة "${session.category?.nameAr}" على InterviewAI Arabia! جربه بنفسك.`,
  });

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg }]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <MotiView from={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring' }}>
          <Card style={{ backgroundColor: theme.colors.primary, borderColor: theme.colors.primary, alignItems: 'center' }}>
            <Text style={{ color: '#D7E3F5', fontFamily: theme.typography.fontFamily }}>مجموع النقاط</Text>
            <Text style={{ color: '#fff', fontSize: 56, fontFamily: theme.typography.fontFamilyBold }}>{session.totalScore}</Text>
            <Text style={{ color: '#D7E3F5', fontFamily: theme.typography.fontFamily, marginTop: 4 }}>
              {session.answers.length} أسئلة  ·  متوسط {avg}
            </Text>
          </Card>
        </MotiView>

        {session.answers.map((a: any, i: number) => (
          <Card key={a.id}>
            <Text style={{ color: theme.colors.textMuted, fontFamily: theme.typography.fontFamily, fontSize: 12 }}>
              سؤال {i + 1}
            </Text>
            <Text style={{ color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold, marginTop: 4 }}>
              {a.question?.questionAr}
            </Text>
            <Text style={{ color: theme.colors.textMuted, fontFamily: theme.typography.fontFamily, marginTop: 8 }}>
              درجتك: {a.aiScore ?? '—'}/10
            </Text>
          </Card>
        ))}

        <Button title="مشاركة النتيجة" onPress={onShare} variant="ghost" />
        <Button title="جلسة جديدة" onPress={() => navigation.navigate('Main')} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ safe: { flex: 1 } });
