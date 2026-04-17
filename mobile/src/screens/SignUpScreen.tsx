import { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../store/auth';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Logo } from '../components/Logo';
import { useAppTheme } from '../theme/useTheme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'SignUp'>;

export function SignUpScreen({ navigation }: Props) {
  const { t, i18n } = useTranslation();
  const theme = useAppTheme();
  const register = useAuth((s) => s.register);
  const loading = useAuth((s) => s.loading);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function onSubmit() {
    if (password.length < 8) {
      Alert.alert(t('common.error'), 'كلمة المرور يجب أن تكون 8 أحرف على الأقل');
      return;
    }
    try {
      await register(email.trim().toLowerCase(), password, name.trim(), i18n.language === 'en' ? 'en' : 'ar');
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.response?.data?.error || err.message);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Logo size={64} />
            <Text style={[styles.title, { color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold }]}>
              {t('auth.register')}
            </Text>
          </View>
          <View style={styles.form}>
            <Input label={t('auth.name')} value={name} onChangeText={setName} />
            <Input
              label={t('auth.email')}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <Input label={t('auth.password')} secureTextEntry value={password} onChangeText={setPassword} />
            <Button title={t('auth.register')} onPress={onSubmit} loading={loading} />
            <Pressable onPress={() => navigation.navigate('Login')} style={{ marginTop: 8 }}>
              <Text style={{ color: theme.colors.textMuted, textAlign: 'center', fontFamily: theme.typography.fontFamily }}>
                {t('auth.hasAccount')}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  header: { alignItems: 'center', gap: 10, marginBottom: 24 },
  title: { fontSize: 24 },
  form: { gap: 14 },
});
