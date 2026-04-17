// Pre-interview setup. Candidate provides the context Sarah/Ahmed needs to
// run a tailored mock interview: company, job title, job description (from
// the posting), optional CV upload, and a choice of HR gender.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, Platform,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { api, API_BASE } from '../api/client';
import { secureStorage } from '../storage/secureStorage';
import { Button } from '../components/Button';
import { useAppTheme } from '../theme/useTheme';

interface Category {
  id: number; nameAr: string; nameEn: string; isPremium: boolean;
}

interface CvKey {
  full_name?: string;
  years_of_experience?: number;
  latest_role?: string;
  top_skills?: string[];
  highlights?: string[];
  education?: string;
  summary_ar?: string;
}

export function MeetingSetupScreen({ route, navigation }: any) {
  const theme = useAppTheme();
  const textBold = { fontFamily: theme.typography.fontFamilyBold };
  const textRegular = { fontFamily: theme.typography.fontFamily };

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(route.params?.categoryId ?? null);
  const [company, setCompany] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [gender, setGender] = useState<'female' | 'male'>('female');
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [cvName, setCvName] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [cvKey, setCvKey] = useState<CvKey | null>(null);
  const [cvSummary, setCvSummary] = useState<string | null>(null);
  const [cvError, setCvError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    api.get('/categories').then((r) => setCategories(r.data.categories)).catch(() => {});
  }, []);

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === categoryId) || null,
    [categories, categoryId],
  );

  const pickFile = () => {
    if (Platform.OS !== 'web') {
      Alert.alert('تنبيه', 'رفع السيرة الذاتية متاح في نسخة الويب حاليًا.');
      return;
    }
    fileInputRef.current?.click();
  };

  const onFilePicked = (e: any) => {
    const f: File | undefined = e.target?.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      Alert.alert('الملف كبير', 'الحد الأقصى 5 ميجابايت.');
      return;
    }
    setCvFile(f);
    setCvName(f.name);
    setCvKey(null);
    setCvSummary(null);
    setCvError(null);
  };

  const analyzeAndStart = useCallback(async () => {
    if (!categoryId) {
      Alert.alert('اختيار القسم', 'اختر مجال المقابلة أولاً.');
      return;
    }
    setAnalyzing(true);
    setCvError(null);

    try {
      const token = await secureStorage.getItem('access_token');
      const form = new FormData();
      form.append('categoryId', String(categoryId));
      form.append('company', company.trim());
      form.append('jobTitle', jobTitle.trim());
      form.append('jobDescription', jobDescription.trim());
      form.append('language', 'ar');
      if (cvFile) form.append('cv', cvFile);

      const res = await fetch(`${API_BASE}/meeting/prepare`, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();

      if (data.cvError) setCvError(data.cvError);

      navigation.replace('Meeting', {
        categoryId,
        categoryName: selectedCategory?.nameAr ?? 'مقابلة',
        context: {
          ...data.context,
          gender,
        },
      });
    } catch (err: any) {
      Alert.alert('خطأ', err?.message || 'تعذّر بدء المقابلة');
    } finally {
      setAnalyzing(false);
    }
  }, [categoryId, company, jobTitle, jobDescription, cvFile, gender, selectedCategory, navigation]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg }]}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 18 }}>
        {/* Header */}
        <MotiView from={{ opacity: 0, translateY: 8 }} animate={{ opacity: 1, translateY: 0 }}>
          <Text style={[styles.title, textBold, { color: theme.colors.text }]}>
            جهّز مقابلتك
          </Text>
          <Text style={[styles.subtitle, textRegular, { color: theme.colors.textMuted }]}>
            املأ تفاصيل الوظيفة لنحاكي مقابلة حقيقية، مخصصة لك ولمتطلبات الدور.
          </Text>
        </MotiView>

        {/* HR gender */}
        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Text style={[styles.cardLabel, textBold, { color: theme.colors.text }]}>اختر مُجري المقابلة</Text>
          <View style={styles.hrRow}>
            <HRChoice
              selected={gender === 'female'} onPress={() => setGender('female')}
              name="سارة" role="مسؤولة موارد بشرية"
              seed="sara-hr" color="#E85D75"
            />
            <HRChoice
              selected={gender === 'male'} onPress={() => setGender('male')}
              name="أحمد" role="مسؤول موارد بشرية"
              seed="ahmed-hr" color="#2D6CE0"
            />
          </View>
        </View>

        {/* Category */}
        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Text style={[styles.cardLabel, textBold, { color: theme.colors.text }]}>مجال الوظيفة</Text>
          <View style={styles.chipsWrap}>
            {categories.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => setCategoryId(c.id)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: categoryId === c.id ? theme.colors.primary : theme.colors.bgMuted,
                    borderColor: categoryId === c.id ? theme.colors.primary : theme.colors.border,
                  },
                ]}
              >
                <Text style={[
                  textBold,
                  { color: categoryId === c.id ? '#fff' : theme.colors.text, fontSize: 13 },
                ]}>
                  {c.nameAr}
                </Text>
                {c.isPremium && <Ionicons name="star" size={11} color={categoryId === c.id ? '#fff' : theme.colors.accent} />}
              </Pressable>
            ))}
          </View>
        </View>

        {/* Company + job title */}
        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Text style={[styles.cardLabel, textBold, { color: theme.colors.text }]}>تفاصيل الوظيفة</Text>

          <Text style={[styles.fieldLabel, textRegular, { color: theme.colors.textMuted }]}>اسم الشركة</Text>
          <TextInput
            value={company}
            onChangeText={setCompany}
            placeholder="مثلاً: فودافون مصر"
            placeholderTextColor={theme.colors.textMuted}
            style={[styles.input, { backgroundColor: theme.colors.bgMuted, color: theme.colors.text, borderColor: theme.colors.border, fontFamily: theme.typography.fontFamily }]}
          />

          <Text style={[styles.fieldLabel, textRegular, { color: theme.colors.textMuted }]}>المسمى الوظيفي</Text>
          <TextInput
            value={jobTitle}
            onChangeText={setJobTitle}
            placeholder="مثلاً: Senior Backend Engineer"
            placeholderTextColor={theme.colors.textMuted}
            style={[styles.input, { backgroundColor: theme.colors.bgMuted, color: theme.colors.text, borderColor: theme.colors.border, fontFamily: theme.typography.fontFamily }]}
          />

          <Text style={[styles.fieldLabel, textRegular, { color: theme.colors.textMuted }]}>
            وصف الوظيفة من الإعلان (اختياري، يحسّن الأسئلة بشدة)
          </Text>
          <TextInput
            value={jobDescription}
            onChangeText={setJobDescription}
            placeholder="الصق هنا وصف الوظيفة من إعلان التوظيف..."
            placeholderTextColor={theme.colors.textMuted}
            multiline
            numberOfLines={6}
            style={[
              styles.input,
              styles.textarea,
              { backgroundColor: theme.colors.bgMuted, color: theme.colors.text, borderColor: theme.colors.border, fontFamily: theme.typography.fontFamily },
            ]}
          />
        </View>

        {/* CV upload */}
        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Text style={[styles.cardLabel, textBold, { color: theme.colors.text }]}>السيرة الذاتية (اختياري)</Text>
          <Text style={[styles.cardHint, textRegular, { color: theme.colors.textMuted }]}>
            رفع CV يسمح للمحاور بربط أسئلته بخبراتك الفعلية. PDF أو TXT حتى 5MB.
          </Text>

          {Platform.OS === 'web' && (
            // @ts-ignore web-only hidden input
            <input
              type="file"
              accept=".pdf,application/pdf,text/plain,.txt"
              ref={fileInputRef as any}
              onChange={onFilePicked}
              style={{ display: 'none' }}
            />
          )}

          <Pressable
            onPress={pickFile}
            style={[styles.uploadBtn, { borderColor: theme.colors.border }]}
          >
            <Ionicons name={cvFile ? 'document-text' : 'cloud-upload-outline'} size={22} color={theme.colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[textBold, { color: theme.colors.text }]}>
                {cvFile ? cvName : 'اختر ملف CV للرفع'}
              </Text>
              {!cvFile && (
                <Text style={[textRegular, { color: theme.colors.textMuted, fontSize: 12 }]}>
                  سيُحلَّل تلقائيًا بعد الرفع
                </Text>
              )}
            </View>
            {cvFile && (
              <Pressable
                onPress={(e: any) => { e.stopPropagation?.(); setCvFile(null); setCvName(''); setCvKey(null); }}
                hitSlop={10}
              >
                <Ionicons name="close-circle" size={22} color={theme.colors.textMuted} />
              </Pressable>
            )}
          </Pressable>

          {cvError && (
            <View style={[styles.cvErrBox, { backgroundColor: theme.colors.danger + '15', borderColor: theme.colors.danger + '40' }]}>
              <Ionicons name="alert-circle" size={16} color={theme.colors.danger} />
              <Text style={[textRegular, { color: theme.colors.danger, fontSize: 13, flex: 1 }]}>
                {cvError}
              </Text>
            </View>
          )}
        </View>

        {/* CTA */}
        <Button
          title={analyzing ? 'جاري التحضير...' : 'ابدأ المقابلة المحاكاة'}
          onPress={analyzeAndStart}
          loading={analyzing}
          disabled={!categoryId}
          iconLeft={<Ionicons name="videocam" size={20} color="#fff" />}
          size="lg"
        />

        <Text style={[textRegular, { color: theme.colors.textMuted, textAlign: 'center', fontSize: 11 }]}>
          كلما كانت التفاصيل أدق، كانت المقابلة أقرب للواقع.
        </Text>
      </ScrollView>

      {analyzing && (
        <View style={styles.overlay}>
          <View style={[styles.overlayCard, { backgroundColor: theme.colors.surface }]}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={[textBold, { color: theme.colors.text, fontSize: 15 }]}>
              {cvFile ? 'جاري تحليل سيرتك الذاتية...' : 'جاري التحضير...'}
            </Text>
            <Text style={[textRegular, { color: theme.colors.textMuted, fontSize: 12, textAlign: 'center' }]}>
              المحاور يقرأ التفاصيل ويُحضّر الأسئلة
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

// ---- HR avatar choice card ----

function HRChoice({
  selected, onPress, name, role, seed, color,
}: { selected: boolean; onPress: () => void; name: string; role: string; seed: string; color: string }) {
  const theme = useAppTheme();
  // DiceBear "personas" gives friendly pro avatars, free, no CORS issues.
  const avatarUrl = `https://api.dicebear.com/7.x/personas/svg?seed=${seed}&backgroundColor=${color.replace('#', '')}&radius=50`;

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.hrCard,
        {
          backgroundColor: theme.colors.bgMuted,
          borderColor: selected ? color : theme.colors.border,
          borderWidth: selected ? 2 : 1,
        },
      ]}
    >
      {Platform.OS === 'web'
        // @ts-ignore — native img renders SVG avatar directly
        ? <img src={avatarUrl} alt={name} width={72} height={72} style={{ borderRadius: 36 }} />
        : <View style={[styles.hrFallback, { backgroundColor: color }]}><Text style={{ color: '#fff', fontSize: 24 }}>{name[0]}</Text></View>
      }
      <Text style={[{ fontFamily: theme.typography.fontFamilyBold, color: theme.colors.text, fontSize: 15, marginTop: 8 }]}>
        {name}
      </Text>
      <Text style={[{ fontFamily: theme.typography.fontFamily, color: theme.colors.textMuted, fontSize: 11 }]}>
        {role}
      </Text>
      {selected && (
        <View style={[styles.hrCheck, { backgroundColor: color }]}>
          <Ionicons name="checkmark" size={14} color="#fff" />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  title: { fontSize: 26, letterSpacing: -0.3 },
  subtitle: { fontSize: 14, marginTop: 6, lineHeight: 22 },

  card: {
    borderRadius: 16, padding: 16, gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardLabel: { fontSize: 15, marginBottom: 4 },
  cardHint: { fontSize: 12, marginBottom: 4 },

  hrRow: { flexDirection: 'row', gap: 12 },
  hrCard: {
    flex: 1, alignItems: 'center',
    paddingVertical: 16, paddingHorizontal: 12,
    borderRadius: 14, position: 'relative',
  },
  hrFallback: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
  },
  hrCheck: {
    position: 'absolute', top: 10, left: 10,
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 999, borderWidth: 1,
  },

  fieldLabel: { fontSize: 12, marginTop: 8 },
  input: {
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, minHeight: 48,
    textAlign: 'right',
  },
  textarea: { minHeight: 120, textAlignVertical: 'top', paddingTop: 12 },

  uploadBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 14,
    borderWidth: 2, borderStyle: 'dashed', borderRadius: 12,
  },

  cvErrBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 10, borderRadius: 10,
    borderWidth: 1, marginTop: 6,
  },

  overlay: {
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  overlayCard: {
    minWidth: 280, padding: 28, borderRadius: 20, alignItems: 'center', gap: 12,
  },
});
