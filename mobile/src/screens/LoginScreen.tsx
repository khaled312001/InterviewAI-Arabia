import { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Pressable, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
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
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit() {
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.response?.data?.error || err.message);
    }
  }

  const textBold = { fontFamily: theme.typography.fontFamilyBold };
  const textRegular = { fontFamily: theme.typography.fontFamily };

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.bg }]}>
      {/* gradient-like layered hero */}
      <View style={[styles.heroBg, { backgroundColor: theme.colors.primary }]} />
      <View style={styles.heroBgDot1} />
      <View style={styles.heroBgDot2} />

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <MotiView
              from={{ opacity: 0, translateY: -8 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 380 }}
              style={styles.header}
            >
              <View style={styles.logoWrap}>
                <Logo size={72} />
              </View>
              <Text style={[styles.appName, textBold]}>InterviewAI Arabia</Text>
              <Text style={[styles.tagline, textRegular]}>{t('app.tagline')}</Text>
            </MotiView>

            <MotiView
              from={{ opacity: 0, translateY: 16 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 420, delay: 120 }}
              style={[
                styles.card,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  shadowColor: '#000',
                },
              ]}
            >
              <Text style={[styles.cardTitle, textBold, { color: theme.colors.text }]}>
                {t('auth.login')}
              </Text>
              <Text style={[styles.cardSubtitle, textRegular, { color: theme.colors.textMuted }]}>
                سجّل الدخول لاستكمال جلستك التدريبية
              </Text>

              <View style={styles.form}>
                <Input
                  label={t('auth.email')}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="name@example.com"
                />
                <View>
                  <Input
                    label={t('auth.password')}
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="••••••••"
                  />
                  <Pressable
                    onPress={() => setShowPassword(!showPassword)}
                    style={styles.eyeBtn}
                    hitSlop={10}
                  >
                    <Ionicons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color={theme.colors.textMuted}
                    />
                  </Pressable>
                </View>

                <Pressable onPress={() => navigation.navigate('ForgotPassword')}>
                  <Text style={[styles.forgot, textRegular, { color: theme.colors.primary }]}>
                    {t('auth.forgotPassword')}
                  </Text>
                </Pressable>

                <Button title={t('auth.login')} onPress={onSubmit} loading={loading} />
              </View>

              <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />

              <Pressable onPress={() => navigation.navigate('SignUp')}>
                <Text style={[styles.signupText, textRegular, { color: theme.colors.textMuted }]}>
                  {t('auth.noAccount')}
                </Text>
              </Pressable>
            </MotiView>

            <Text style={[styles.brand, textRegular, { color: theme.colors.textMuted }]}>
              شركة برمجلي · barmagly.tech
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, position: 'relative', overflow: 'hidden' },
  heroBg: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 320,
    borderBottomLeftRadius: 48,
    borderBottomRightRadius: 48,
  },
  heroBgDot1: {
    position: 'absolute',
    width: 220, height: 220, borderRadius: 110,
    backgroundColor: 'rgba(255,255,255,0.08)',
    top: -60, right: -60,
  },
  heroBgDot2: {
    position: 'absolute',
    width: 140, height: 140, borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.05)',
    top: 160, left: -40,
  },

  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 32,
    alignItems: 'center',
  },
  header: { alignItems: 'center', marginBottom: 28 },
  logoWrap: {
    width: 88, height: 88, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
  },
  appName: { color: '#fff', fontSize: 24, letterSpacing: -0.2 },
  tagline: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 4 },

  card: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 24,
    padding: 22,
    borderWidth: StyleSheet.hairlineWidth,
    ...Platform.select({
      ios: { shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
      android: { elevation: 6 },
      default: { boxShadow: '0 10px 30px rgba(0,0,0,0.12)' },
    }),
  },
  cardTitle: { fontSize: 22, letterSpacing: -0.3 },
  cardSubtitle: { fontSize: 13, marginTop: 4, marginBottom: 18 },
  form: { gap: 14 },
  eyeBtn: { position: 'absolute', bottom: 14, left: 14 },
  forgot: { fontSize: 13, textAlign: 'left' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 18 },
  signupText: { textAlign: 'center', fontSize: 13 },

  brand: { marginTop: 28, fontSize: 12 },
});
