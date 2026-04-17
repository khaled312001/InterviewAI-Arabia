import { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { MotiView } from 'moti';
import { useAuth } from '../store/auth';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Logo } from '../components/Logo';
import { useAppTheme } from '../theme/useTheme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const login = useAuth((s) => s.login);
  const loading = useAuth((s) => s.loading);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function onSubmit() {
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.response?.data?.error || err.message);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <MotiView from={{ opacity: 0, translateY: 16 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 320 }}>
            <View style={styles.header}>
              <Logo size={72} />
              <Text style={[styles.title, { color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold }]}>
                {t('auth.login')}
              </Text>
              <Text style={[styles.subtitle, { color: theme.colors.textMuted, fontFamily: theme.typography.fontFamily }]}>
                {t('app.tagline')}
              </Text>
            </View>

            <View style={styles.form}>
              <Input
                label={t('auth.email')}
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
              <Input
                label={t('auth.password')}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
              <Pressable onPress={() => navigation.navigate('ForgotPassword')}>
                <Text style={{ color: theme.colors.primary, fontFamily: theme.typography.fontFamily, textAlign: 'left' }}>
                  {t('auth.forgotPassword')}
                </Text>
              </Pressable>
              <Button title={t('auth.login')} onPress={onSubmit} loading={loading} />
              <Pressable onPress={() => navigation.navigate('SignUp')} style={{ marginTop: 8 }}>
                <Text style={{ color: theme.colors.textMuted, textAlign: 'center', fontFamily: theme.typography.fontFamily }}>
                  {t('auth.noAccount')}
                </Text>
              </Pressable>
            </View>
          </MotiView>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  header: { alignItems: 'center', gap: 10, marginBottom: 32 },
  title: { fontSize: 24 },
  subtitle: { fontSize: 14 },
  form: { gap: 14 },
});
