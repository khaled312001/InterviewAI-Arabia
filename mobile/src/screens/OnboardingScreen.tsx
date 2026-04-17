import { useState } from 'react';
import { View, Text, StyleSheet, Dimensions, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../components/Button';
import { Logo } from '../components/Logo';
import { useAppTheme } from '../theme/useTheme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;
const { width } = Dimensions.get('window');

export function OnboardingScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const [index, setIndex] = useState(0);
  const slides = [
    { title: t('onboarding.slide1Title'), body: t('onboarding.slide1Body'), icon: 'chatbubbles' },
    { title: t('onboarding.slide2Title'), body: t('onboarding.slide2Body'), icon: 'sparkles' },
    { title: t('onboarding.slide3Title'), body: t('onboarding.slide3Body'), icon: 'star' },
  ];

  const onFinish = () => navigation.replace('Login');

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg }]}>
      <View style={styles.top}>
        <Logo size={72} />
        <Pressable onPress={onFinish}>
          <Text style={{ color: theme.colors.textMuted, fontFamily: theme.typography.fontFamily }}>
            {t('common.skip')}
          </Text>
        </Pressable>
      </View>
      <FlatList
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        data={slides}
        keyExtractor={(_, i) => String(i)}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item, index: i }) => (
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 350 }}
            style={[styles.slide, { width }]}
            key={i}
          >
            <View style={[styles.iconCircle, { backgroundColor: theme.colors.primary }]}>
              <Ionicons name={item.icon as any} size={56} color="#fff" />
            </View>
            <Text style={[styles.title, { color: theme.colors.text, fontFamily: theme.typography.fontFamilyBold }]}>
              {item.title}
            </Text>
            <Text style={[styles.body, { color: theme.colors.textMuted, fontFamily: theme.typography.fontFamily }]}>
              {item.body}
            </Text>
          </MotiView>
        )}
      />
      <View style={styles.dots}>
        {slides.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: i === index ? theme.colors.primary : theme.colors.border, width: i === index ? 20 : 8 },
            ]}
          />
        ))}
      </View>
      <View style={styles.cta}>
        <Button title={t('common.getStarted')} onPress={onFinish} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8 },
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 18 },
  iconCircle: { width: 140, height: 140, borderRadius: 70, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 26, textAlign: 'center' },
  body: { fontSize: 16, textAlign: 'center', lineHeight: 26 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 16 },
  dot: { height: 8, borderRadius: 4 },
  cta: { paddingHorizontal: 20, paddingBottom: 24 },
});
