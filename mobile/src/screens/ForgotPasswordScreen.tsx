import { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { useAppTheme } from '../theme/useTheme';

export function ForgotPasswordScreen({ navigation }: any) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim().toLowerCase() });
      Alert.alert(t('app.name'), t('auth.resetSent'));
      navigation.goBack();
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg }]}>
      <View style={styles.container}>
        <Text style={[styles.title, { color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold }]}>
          {t('auth.resetTitle')}
        </Text>
        <Text style={[styles.body, { color: theme.colors.textMuted, fontFamily: theme.typography.fontFamily }]}>
          {t('auth.resetDescription')}
        </Text>
        <Input label={t('auth.email')} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
        <Button title={t('common.save')} onPress={onSubmit} loading={loading} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, padding: 24, gap: 14, justifyContent: 'center' },
  title: { fontSize: 22 },
  body: { fontSize: 14, lineHeight: 22, marginBottom: 10 },
});
