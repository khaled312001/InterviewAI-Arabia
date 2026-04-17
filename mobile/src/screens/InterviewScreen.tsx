import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { useAppTheme } from '../theme/useTheme';
import { useAuth } from '../store/auth';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Interview'>;

export function InterviewScreen({ route, navigation }: Props) {
  const { sessionId, firstQuestion, category } = route.params;
  const theme = useAppTheme();
  const refreshMe = useAuth((s) => s.refreshMe);

  const [question, setQuestion] = useState(firstQuestion);
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [answered, setAnswered] = useState(0);

  async function onSubmit() {
    if (answer.trim().length < 3) {
      Alert.alert('تنبيه', 'اكتب إجابة أطول من ذلك قليلاً.');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post(`/sessions/${sessionId}/answer`, {
        questionId: question.id,
        userAnswer: answer,
        language: 'ar',
      });
      setAnswered((a) => a + 1);
      await refreshMe();
      navigation.replace('Feedback', {
        answerId: data.answerId,
        feedback: data.feedback,
        tokensUsed: data.tokensUsed,
        nextQuestion: data.nextQuestion,
        sessionId,
      });
    } catch (err: any) {
      Alert.alert('خطأ', err?.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function onEnd() {
    try {
      await api.post(`/sessions/${sessionId}/end`);
    } catch { /* ignore */ }
    navigation.replace('SessionSummary', { sessionId });
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
          <MotiView
            key={question.id}
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 320 }}
          >
            <Card style={{ backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }}>
              <Text style={{ color: '#D7E3F5', fontFamily: theme.typography.fontFamily, fontSize: 12 }}>
                {category?.nameAr}  ·  سؤال {answered + 1}
              </Text>
              <Text style={[styles.question, { fontFamily: theme.typography.fontFamilyBold }]}>
                {question.questionAr}
              </Text>
            </Card>
          </MotiView>

          <Input
            label="إجابتك"
            placeholder="اكتب إجابتك هنا بأسلوب مهني واضح..."
            multiline
            numberOfLines={8}
            value={answer}
            onChangeText={setAnswer}
            style={{ minHeight: 180, textAlignVertical: 'top' }}
          />

          <Button title="إرسال الإجابة" onPress={onSubmit} loading={loading} />
          <Button title="إنهاء الجلسة" onPress={onEnd} variant="ghost" />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  question: { color: '#fff', fontSize: 18, lineHeight: 28, marginTop: 6 },
});
