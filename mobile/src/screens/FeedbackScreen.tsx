import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useAppTheme } from '../theme/useTheme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Feedback'>;

function scoreColor(score: number, theme: any) {
  if (score >= 8) return theme.colors.success;
  if (score >= 5) return theme.colors.secondary;
  return theme.colors.danger;
}

export function FeedbackScreen({ route, navigation }: Props) {
  const { feedback, nextQuestion, sessionId } = route.params;
  const theme = useAppTheme();
  const score = Number(feedback.score) || 0;

  function onNext() {
    if (nextQuestion) {
      navigation.replace('Interview', { sessionId, firstQuestion: nextQuestion, category: {} });
    } else {
      navigation.replace('SessionSummary', { sessionId });
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg }]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <MotiView from={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring' }}>
          <Card style={{ alignItems: 'center' }}>
            <Text style={{ color: theme.colors.textMuted, fontFamily: theme.typography.fontFamily }}>درجة التقييم</Text>
            <Text style={[styles.scoreNum, { color: scoreColor(score, theme), fontFamily: theme.typography.fontFamilyBold }]}>
              {score}/10
            </Text>
          </Card>
        </MotiView>

        {feedback.stub && (
          <Card style={{ backgroundColor: theme.colors.warning + '20', borderColor: theme.colors.warning }}>
            <Text style={{ color: theme.colors.warning, fontFamily: theme.typography.fontFamilyBold }}>
              تنبيه: تقييم تجريبي
            </Text>
            <Text style={{ color: theme.colors.textMuted, fontFamily: theme.typography.fontFamily, marginTop: 4 }}>
              الذكاء الاصطناعي غير مفعّل على الخادم. أضف ANTHROPIC_API_KEY لتفعيل التقييم الحقيقي.
            </Text>
          </Card>
        )}

        <Card>
          <View style={styles.row}>
            <Ionicons name="checkmark-circle" size={22} color={theme.colors.success} />
            <Text style={[styles.h, { color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold }]}>نقاط القوة</Text>
          </View>
          {(feedback.strengths ?? []).map((s: string, i: number) => (
            <Text key={i} style={{ color: theme.colors.text, fontFamily: theme.typography.fontFamily, marginTop: 6 }}>
              • {s}
            </Text>
          ))}
        </Card>

        <Card>
          <View style={styles.row}>
            <Ionicons name="alert-circle" size={22} color={theme.colors.warning} />
            <Text style={[styles.h, { color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold }]}>نقاط التحسين</Text>
          </View>
          {(feedback.weaknesses ?? []).map((s: string, i: number) => (
            <Text key={i} style={{ color: theme.colors.text, fontFamily: theme.typography.fontFamily, marginTop: 6 }}>
              • {s}
            </Text>
          ))}
        </Card>

        {feedback.improvement ? (
          <Card>
            <Text style={[styles.h, { color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold }]}>نصيحة</Text>
            <Text style={{ color: theme.colors.text, fontFamily: theme.typography.fontFamily, marginTop: 6, lineHeight: 22 }}>
              {feedback.improvement}
            </Text>
          </Card>
        ) : null}

        {feedback.model_answer ? (
          <Card>
            <Text style={[styles.h, { color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold }]}>إجابة نموذجية</Text>
            <Text style={{ color: theme.colors.text, fontFamily: theme.typography.fontFamily, marginTop: 6, lineHeight: 22 }}>
              {feedback.model_answer}
            </Text>
          </Card>
        ) : null}

        <Button title={nextQuestion ? 'السؤال التالي' : 'ملخص الجلسة'} onPress={onNext} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scoreNum: { fontSize: 56, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  h: { fontSize: 16 },
});
