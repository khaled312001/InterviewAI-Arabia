import { View, Text, StyleSheet, Pressable, ScrollView, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { setAppLanguage } from '../i18n';
import { Card } from '../components/Card';
import { useAppTheme } from '../theme/useTheme';
import { useThemePreference } from '../theme/useTheme';

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useAppTheme();
  return (
    <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: selected ? theme.colors.primary : theme.colors.border }]}>
      <Text style={{ color: selected ? '#fff' : theme.colors.text, fontFamily: theme.typography.fontFamily }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const theme = useAppTheme();
  const { preference, setPreference } = useThemePreference();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg }]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Card>
          <Text style={{ color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold, marginBottom: 10 }}>
            {t('settings.language')}
          </Text>
          <View style={styles.chipRow}>
            <Chip label="العربية" selected={i18n.language === 'ar'} onPress={() => setAppLanguage('ar')} />
            <Chip label="English" selected={i18n.language === 'en'} onPress={() => setAppLanguage('en')} />
          </View>
        </Card>

        <Card>
          <Text style={{ color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold, marginBottom: 10 }}>
            {t('settings.darkMode')}
          </Text>
          <View style={styles.chipRow}>
            <Chip label={t('settings.system')} selected={preference === 'system'} onPress={() => setPreference('system')} />
            <Chip label={t('settings.light')}  selected={preference === 'light'}  onPress={() => setPreference('light')} />
            <Chip label={t('settings.dark')}   selected={preference === 'dark'}   onPress={() => setPreference('dark')} />
          </View>
        </Card>

        <Card>
          <Pressable onPress={() => Linking.openURL('https://barmagly.tech')} style={styles.linkRow}>
            <Ionicons name="globe-outline" size={20} color={theme.colors.primary} />
            <Text style={{ color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold }}>
              شركة برمجلي — barmagly.tech
            </Text>
          </Pressable>
          <Pressable onPress={() => Linking.openURL('tel:+201010254819')} style={styles.linkRow}>
            <Ionicons name="call-outline" size={20} color={theme.colors.primary} />
            <Text style={{ color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold }}>01010254819</Text>
          </Pressable>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
});
