import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useAuth } from '../store/auth';
import { useAppTheme } from '../theme/useTheme';

const PLANS = [
  { id: 'interviewai_monthly', label: 'شهري', price: '29 ج.م', period: '/ شهر' },
  { id: 'interviewai_yearly',  label: 'سنوي', price: '249 ج.م', period: '/ سنة', badge: 'الأفضل قيمة' },
];

const PERKS = [
  'أسئلة غير محدودة يوميًا',
  'جميع الأقسام المتخصصة (مبيعات، تصميم، ...)',
  'تقارير أداء مفصلة',
  'بدون إعلانات',
  'أولوية في الدعم الفني',
];

export function SubscriptionScreen({ navigation }: any) {
  const theme = useAppTheme();
  const user = useAuth((s) => s.user);
  const refreshMe = useAuth((s) => s.refreshMe);
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    api.get('/subscriptions/status').then((r) => setStatus(r.data)).catch(() => {});
  }, []);

  async function subscribe(productId: string) {
    setLoading(productId);
    try {
      // TODO: integrate react-native-iap flow here.
      // For dev, we post a dummy purchaseToken when GOOGLE_PLAY_ENABLED=false on the server.
      const devToken = 'DEV-' + Date.now();
      await api.post('/subscriptions/verify', { productId, purchaseToken: devToken });
      await refreshMe();
      Alert.alert('تم بنجاح', 'تفعيل الاشتراك المميز. (وضع تطوير)');
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('خطأ', err?.response?.data?.error || err.message);
    } finally {
      setLoading(null);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg }]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Card style={{ backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }}>
          <Text style={{ color: '#fff', fontSize: 22, fontFamily: theme.typography.fontFamilyBold }}>
            الاشتراك المميز
          </Text>
          <Text style={{ color: '#D7E3F5', fontFamily: theme.typography.fontFamily, marginTop: 6 }}>
            افتح الإمكانيات كاملة وتدرّب بلا حدود.
          </Text>
        </Card>

        {user?.plan === 'premium' && status?.subscription && (
          <Card>
            <Text style={{ color: theme.colors.success, fontFamily: theme.typography.fontFamilyBold }}>
              اشتراكك مفعّل ✓
            </Text>
            <Text style={{ color: theme.colors.textMuted, fontFamily: theme.typography.fontFamily, marginTop: 4 }}>
              ينتهي في {new Date(status.subscription.expiresAt).toLocaleDateString('ar-EG')}
            </Text>
          </Card>
        )}

        <Card>
          {PERKS.map((p, i) => (
            <View key={i} style={styles.perkRow}>
              <Ionicons name="checkmark-circle" size={20} color={theme.colors.success} />
              <Text style={{ color: theme.colors.text, fontFamily: theme.typography.fontFamily }}>{p}</Text>
            </View>
          ))}
        </Card>

        {PLANS.map((p) => (
          <Card key={p.id}>
            <View style={styles.planRow}>
              <View>
                <Text style={{ color: theme.colors.text, fontSize: 18, fontFamily: theme.typography.fontFamilyBold }}>
                  {p.label}
                </Text>
                <Text style={{ color: theme.colors.primary, fontSize: 22, fontFamily: theme.typography.fontFamilyBold, marginTop: 4 }}>
                  {p.price}
                  <Text style={{ color: theme.colors.textMuted, fontSize: 14, fontFamily: theme.typography.fontFamily }}> {p.period}</Text>
                </Text>
              </View>
              {p.badge ? (
                <View style={[styles.badge, { backgroundColor: theme.colors.secondary }]}>
                  <Text style={{ color: '#fff', fontFamily: theme.typography.fontFamilyBold, fontSize: 11 }}>{p.badge}</Text>
                </View>
              ) : null}
            </View>
            <View style={{ height: 10 }} />
            <Button
              title={user?.plan === 'premium' ? 'تجديد' : 'اشترك الآن'}
              onPress={() => subscribe(p.id)}
              loading={loading === p.id}
            />
          </Card>
        ))}

        <Text style={{ color: theme.colors.textMuted, textAlign: 'center', fontSize: 12, fontFamily: theme.typography.fontFamily }}>
          يتم تجديد الاشتراك تلقائيًا عبر Google Play. يمكنك إلغاؤه في أي وقت من إعدادات اشتراكاتك.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  planRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
});
