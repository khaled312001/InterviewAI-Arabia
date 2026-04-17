import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useAuth } from '../store/auth';
import { useAppTheme } from '../theme/useTheme';

interface PaymentsConfig {
  enabled: boolean;
  currency: string;
  plans: {
    monthly: { priceEgp: number; days: number; label: string; productId: string };
    yearly:  { priceEgp: number; days: number; label: string; productId: string };
  };
}

const PERKS = [
  'أسئلة غير محدودة يوميًا',
  'جميع الأقسام المتخصصة (مبيعات، تصميم، ...)',
  'مقابلات محاكاة حية مع تقارير مفصّلة',
  'تحليل CV متقدم ونصائح مخصّصة',
  'بدون إعلانات',
  'أولوية في الدعم الفني',
];

export function SubscriptionScreen({ navigation }: any) {
  const theme = useAppTheme();
  const user = useAuth((s) => s.user);
  const refreshMe = useAuth((s) => s.refreshMe);
  const [status, setStatus] = useState<any>(null);
  const [config, setConfig] = useState<PaymentsConfig | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);

  useEffect(() => {
    api.get('/subscriptions/status').then((r) => setStatus(r.data)).catch(() => {});
    api.get('/payments/config').then((r) => setConfig(r.data)).catch(() => {});
  }, []);

  // Auto-refresh user plan after Paymob redirects back — simple polling while
  // the iframe modal is open so we catch the webhook-driven update.
  useEffect(() => {
    if (!iframeUrl) return;
    const iv = setInterval(async () => {
      try {
        const { data } = await api.get('/subscriptions/status');
        setStatus(data);
        if (data.active) {
          await refreshMe();
          setIframeUrl(null);
          clearInterval(iv);
          Alert.alert('تم الدفع ✓', 'مرحبًا بك في الباقة المميّزة.');
        }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(iv);
  }, [iframeUrl, refreshMe]);

  async function subscribe(plan: 'monthly' | 'yearly') {
    if (!config?.enabled) {
      Alert.alert(
        'الدفع غير مفعّل بعد',
        'نظام الدفع في وضع الإعداد. تواصل مع شركة برمجلي لتفعيله على حسابك.',
      );
      return;
    }
    setLoading(plan);
    try {
      const { data } = await api.post('/payments/checkout', { plan });
      if (Platform.OS === 'web') {
        setIframeUrl(data.iframeUrl);
      } else {
        // Native: open in browser — we'll wait for the user to come back.
        const { Linking } = await import('react-native');
        await Linking.openURL(data.iframeUrl);
        Alert.alert('جاري التحويل', 'أكمل الدفع ثم عد إلى التطبيق. سيُحدّث اشتراكك تلقائيًا خلال دقيقة.');
      }
    } catch (err: any) {
      Alert.alert('خطأ', err?.response?.data?.error || err.message);
    } finally {
      setLoading(null);
    }
  }

  const textBold = { fontFamily: theme.typography.fontFamilyBold };
  const textRegular = { fontFamily: theme.typography.fontFamily };

  if (iframeUrl && Platform.OS === 'web') {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: '#000' }]}>
        <View style={styles.iframeBar}>
          <Text style={[textBold, { color: '#fff', fontSize: 14 }]}>الدفع الآمن عبر Paymob</Text>
          <MotiView
            from={{ opacity: 0.5 }}
            animate={{ opacity: 1 }}
            transition={{ type: 'timing', duration: 600, loop: true, repeatReverse: true }}
          >
            <Text style={[textRegular, { color: '#F5B12F', fontSize: 12 }]}>
              ●  نكتشف الدفع الناجح تلقائيًا
            </Text>
          </MotiView>
          <Text
            onPress={() => setIframeUrl(null)}
            style={[textBold, { color: '#fff', padding: 8 }]}
          >
            إغلاق
          </Text>
        </View>
        {/* @ts-ignore web iframe */}
        <iframe
          src={iframeUrl}
          style={{ flex: 1, border: 'none', background: '#fff' }}
          allow="payment"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg }]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 320 }}
        >
          <Card style={{ backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Ionicons name="star" size={28} color="#F5B12F" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontSize: 22, fontFamily: theme.typography.fontFamilyBold }}>
                  الاشتراك المميّز
                </Text>
                <Text style={{ color: '#D7E3F5', fontFamily: theme.typography.fontFamily, marginTop: 4, fontSize: 13 }}>
                  افتح جميع الميزات وتدرّب بلا حدود
                </Text>
              </View>
            </View>
          </Card>
        </MotiView>

        {user?.plan === 'premium' && status?.active && status?.subscription && (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="checkmark-circle" size={22} color={theme.colors.success} />
              <Text style={[textBold, { color: theme.colors.success, fontSize: 16 }]}>
                اشتراكك مفعّل
              </Text>
            </View>
            <Text style={[textRegular, { color: theme.colors.textMuted, marginTop: 4 }]}>
              ينتهي في {new Date(status.subscription.expiresAt).toLocaleDateString('ar-EG')}
            </Text>
          </Card>
        )}

        <Card>
          <Text style={[textBold, { color: theme.colors.text, fontSize: 15, marginBottom: 6 }]}>
            ماذا تحصل عليه:
          </Text>
          {PERKS.map((p, i) => (
            <View key={i} style={styles.perkRow}>
              <Ionicons name="checkmark-circle" size={18} color={theme.colors.success} />
              <Text style={[textRegular, { color: theme.colors.text, flex: 1 }]}>{p}</Text>
            </View>
          ))}
        </Card>

        {config && (
          <>
            <PlanCard
              planKey="monthly"
              label="شهري"
              price={`${config.plans.monthly.priceEgp} ج.م`}
              period="شهر"
              onSubscribe={() => subscribe('monthly')}
              loading={loading === 'monthly'}
              active={user?.plan === 'premium'}
              enabled={config.enabled}
            />
            <PlanCard
              planKey="yearly"
              label="سنوي"
              price={`${config.plans.yearly.priceEgp} ج.م`}
              period="سنة"
              onSubscribe={() => subscribe('yearly')}
              loading={loading === 'yearly'}
              active={user?.plan === 'premium'}
              enabled={config.enabled}
              badge="الأفضل قيمة"
              saving={`وفّر ${config.plans.monthly.priceEgp * 12 - config.plans.yearly.priceEgp} ج.م`}
            />
          </>
        )}

        <View style={[styles.trustBar, { backgroundColor: theme.colors.bgMuted }]}>
          <Ionicons name="shield-checkmark" size={16} color={theme.colors.success} />
          <Text style={[textRegular, { color: theme.colors.textMuted, fontSize: 11, flex: 1 }]}>
            الدفع آمن عبر Paymob. لا نحفظ بيانات بطاقتك.
          </Text>
        </View>

        {!config?.enabled && (
          <View style={[styles.warnBox, { backgroundColor: theme.colors.warning + '15', borderColor: theme.colors.warning + '40' }]}>
            <Ionicons name="information-circle" size={18} color={theme.colors.warning} />
            <Text style={[textRegular, { color: theme.colors.text, fontSize: 13, flex: 1 }]}>
              نظام الدفع في وضع الإعداد. سيتوفّر الاشتراك خلال ساعات.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PlanCard({
  planKey, label, price, period, onSubscribe, loading, active, enabled, badge, saving,
}: any) {
  const theme = useAppTheme();
  const textBold = { fontFamily: theme.typography.fontFamilyBold };
  const textRegular = { fontFamily: theme.typography.fontFamily };
  return (
    <Card style={badge ? { borderColor: theme.colors.accent, borderWidth: 1.5 } : undefined}>
      <View style={styles.planHead}>
        <View>
          <Text style={[textBold, { color: theme.colors.text, fontSize: 18 }]}>{label}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <Text style={[textBold, { color: theme.colors.primary, fontSize: 24 }]}>{price}</Text>
            <Text style={[textRegular, { color: theme.colors.textMuted, fontSize: 13 }]}>/ {period}</Text>
          </View>
          {saving && (
            <Text style={[textBold, { color: theme.colors.success, fontSize: 12, marginTop: 4 }]}>
              {saving}
            </Text>
          )}
        </View>
        {badge && (
          <View style={[styles.planBadge, { backgroundColor: theme.colors.accent }]}>
            <Text style={[textBold, { color: '#fff', fontSize: 11 }]}>{badge}</Text>
          </View>
        )}
      </View>
      <View style={{ height: 10 }} />
      <Button
        title={active ? 'تجديد' : loading ? 'جاري التحويل...' : 'اشترك الآن'}
        onPress={onSubscribe}
        loading={loading}
        disabled={!enabled}
        iconLeft={!loading ? <Ionicons name="lock-closed" size={16} color="#fff" /> : null}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },

  planHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  planBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },

  trustBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 10,
  },

  warnBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 10, borderWidth: 1,
  },

  iframeBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, paddingHorizontal: 16,
    backgroundColor: '#14213D',
  },
});
