import { View, Text, StyleSheet, Pressable, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../store/auth';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useAppTheme } from '../theme/useTheme';

function Row({ icon, label, onPress, danger }: any) {
  const theme = useAppTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      <View style={[styles.row, { borderBottomColor: theme.colors.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name={icon} size={22} color={danger ? theme.colors.danger : theme.colors.primary} />
          <Text style={{ color: danger ? theme.colors.danger : theme.colors.text, fontFamily: theme.typography.fontFamilyBold }}>
            {label}
          </Text>
        </View>
        <Ionicons name="chevron-back" size={18} color={theme.colors.textMuted} />
      </View>
    </Pressable>
  );
}

export function ProfileScreen({ navigation }: any) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const { user, logout } = useAuth();

  function onLogout() {
    Alert.alert(t('profile.logout'), '', [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('profile.logout'), style: 'destructive', onPress: () => logout() },
    ]);
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg }]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Card style={{ alignItems: 'center', gap: 6 }}>
          <View style={[styles.avatar, { backgroundColor: theme.colors.primary }]}>
            <Text style={{ color: '#fff', fontSize: 24, fontFamily: theme.typography.fontFamilyBold }}>
              {user?.name?.[0]?.toUpperCase() || '?'}
            </Text>
          </View>
          <Text style={{ color: theme.colors.text, fontSize: 18, fontFamily: theme.typography.fontFamilyBold }}>
            {user?.name}
          </Text>
          <Text style={{ color: theme.colors.textMuted, fontFamily: theme.typography.fontFamily }}>{user?.email}</Text>
          <View style={[styles.planBadge, { backgroundColor: user?.plan === 'premium' ? theme.colors.secondary : theme.colors.border }]}>
            <Text style={{ color: user?.plan === 'premium' ? '#fff' : theme.colors.text, fontFamily: theme.typography.fontFamilyBold, fontSize: 12 }}>
              {user?.plan === 'premium' ? 'مميز' : 'مجاني'}
            </Text>
          </View>
        </Card>

        <Card style={{ padding: 0 }}>
          <Row icon="person-outline" label={t('profile.edit')} onPress={() => {/* edit flow */}} />
          <Row icon="star-outline" label={t('subscription.title')} onPress={() => navigation.navigate('Subscription')} />
          <Row icon="settings-outline" label={t('settings.title')} onPress={() => navigation.navigate('Settings')} />
          <Row icon="log-out-outline" label={t('profile.logout')} danger onPress={onLogout} />
        </Card>

        <Text style={{ color: theme.colors.textMuted, textAlign: 'center', fontFamily: theme.typography.fontFamily, fontSize: 12 }}>
          شركة برمجلي — barmagly.tech
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  planBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, marginTop: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
