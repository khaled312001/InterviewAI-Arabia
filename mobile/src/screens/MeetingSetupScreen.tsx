/**
 * Pre-interview setup.
 *
 * Everything the interviewer needs before the call starts, in the order the
 * candidate can actually answer it: what language the interview runs in, who
 * is interviewing them, the field, the job, and optionally their CV.
 *
 * Language first, deliberately. It is the only choice on this screen that the
 * candidate cannot change once the call begins — it drives the questions, the
 * interviewer's synthesised voice, the speech recogniser's locale
 * (`ar-EG` vs `en-US`) and the final written evaluation — so it is asked
 * before anything else rather than buried under the job description.
 *
 * The CV upload is web-only: it needs a real `File` to put on the multipart
 * body, and Expo's native build has no file picker wired up here yet.
 */

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, StyleSheet, Pressable, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { MotiView } from 'moti';
import { useTranslation } from 'react-i18next';

import { api, API_BASE } from '../api/client';
import { secureStorage } from '../storage/secureStorage';
import { Screen, Text, Button, Card, Input } from '../components';
import { useBalance } from '../store/balance';
import { useAppTheme } from '../theme/useTheme';
import { categoryName, durationLabel } from './mainShared';
import { PERSONA, personaAvatarUrl } from './interviewerPersona';
import type { InterviewerGender } from './interviewerPersona';
import type { SpeechLang } from '../speech/webSpeech';

interface Category {
  id: number; nameAr: string; nameEn: string; isPremium: boolean;
}

/** Server-side limit on the CV upload, mirrored here so the user is told
 *  before a 5MB file crosses the wire only to be rejected. */
/**
 * A CV as picked on either platform. `file` is the browser's File object and is
 * null on device, where FormData takes the {uri, name, type} shape instead.
 */
type PickedCv = {
  uri: string;
  name: string;
  mimeType: string;
  file: File | null;
};

/** What the server's multer filter accepts — keep the two in step. */
const CV_MIME_TYPES = ['application/pdf', 'text/plain', 'text/markdown'];

const MAX_CV_MB = 5;
const MAX_CV_BYTES = MAX_CV_MB * 1024 * 1024;


export function MeetingSetupScreen({ route, navigation }: any) {
  const theme = useAppTheme();
  const { t, i18n } = useTranslation();

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(route.params?.categoryId ?? null);
  const [company, setCompany] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [gender, setGender] = useState<InterviewerGender>('female');
  /** Defaults to the app's current UI language — the language the candidate
   *  has already told us they read in is the best guess at the one they want
   *  to be interviewed in. */
  const [language, setLanguage] = useState<SpeechLang>(i18n.language === 'en' ? 'en' : 'ar');
  const [cvFile, setCvFile] = useState<PickedCv | null>(null);
  const [cvName, setCvName] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [cvError, setCvError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  /** Set by a 402 from /meeting/prepare — the CV analysis could not be paid
   *  for. The interview itself is still startable without a CV. */
  const [outOfMinutes, setOutOfMinutes] = useState(false);

  const balance = useBalance((s) => s.balance);
  const refreshBalance = useBalance((s) => s.refresh);

  useEffect(() => {
    api.get('/categories').then((r) => setCategories(r.data.categories)).catch(() => {});
    refreshBalance().catch(() => {});
  }, [refreshBalance]);

  /** What analysing a CV costs, in the server's own number. */
  const cvCost = balance?.costs?.cvAnalysisSeconds ?? null;
  const cvCostHint = cvCost === null
    ? null
    : cvCost === 0
      ? t('meetingSetup.cvCostFree')
      : t('meetingSetup.cvCost', { label: durationLabel(cvCost, t) });

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === categoryId) || null,
    [categories, categoryId],
  );

  const pickFile = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: CV_MIME_TYPES,
        copyToCacheDirectory: true, // the picker's own URI is not readable later
        multiple: false,
      });
      if (res.canceled) return;

      const asset = res.assets?.[0];
      if (!asset) return;

      // The server accepts PDF and plain text only. The system picker honours
      // `type` on both platforms, but a user can still reach a file through
      // "recent"/cloud providers whose reported MIME type is generic, so the
      // extension is checked too rather than trusted blindly.
      const name = asset.name || 'cv';
      if (!/\.(pdf|txt|md)$/i.test(name)) {
        setCvError(t('meetingSetup.cvWrongType'));
        return;
      }
      if (typeof asset.size === 'number' && asset.size > MAX_CV_BYTES) {
        setCvError(t('meetingSetup.cvTooLarge', { mb: MAX_CV_MB }));
        return;
      }

      setCvFile({
        uri: asset.uri,
        name,
        mimeType: asset.mimeType || 'application/pdf',
        // On web the picker hands back the real File, which FormData needs;
        // on native there is no File and the {uri,name,type} shape is used.
        file: (asset as { file?: File }).file ?? null,
      });
      setCvName(name);
      setCvError(null);
    } catch {
      setCvError(t('meetingSetup.cvPickFailed'));
    }
  }, [t]);

  const clearFile = useCallback(() => {
    setCvFile(null);
    setCvName('');
    setCvError(null);
  }, []);

  const analyzeAndStart = useCallback(async () => {
    if (!categoryId) {
      setFormError(t('meetingSetup.pickCategory'));
      return;
    }
    setAnalyzing(true);
    setFormError(null);
    setCvError(null);
    setOutOfMinutes(false);

    // Held outside the try so the catch can prefer the server's own wording
    // (quota, premium, unsupported CV) over the generic localised fallback,
    // without leaking a raw "Failed to fetch" at the user.
    let serverMessage: string | null = null;

    try {
      const token = await secureStorage.getItem('access_token');
      const form = new FormData();
      form.append('categoryId', String(categoryId));
      form.append('company', company.trim());
      form.append('jobTitle', jobTitle.trim());
      form.append('jobDescription', jobDescription.trim());
      form.append('language', language);
      if (cvFile) {
        // React Native's FormData has no File/Blob: it serialises an
        // {uri, name, type} object into a multipart part. On web the real File
        // is required instead, which the picker gives us.
        if (cvFile.file) form.append('cv', cvFile.file);
        else form.append('cv', { uri: cvFile.uri, name: cvFile.name, type: cvFile.mimeType } as unknown as Blob);
      }

      const res = await fetch(`${API_BASE}/meeting/prepare`, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        serverMessage = typeof body?.error === 'string' ? body.error : null;
        // 402 here is the CV-analysis charge, not the interview: say so, and
        // offer the way out instead of a dead "try again".
        if (res.status === 402 && body?.code === 'QUOTA_EXCEEDED') setOutOfMinutes(true);
        throw new Error('prepare-failed');
      }
      const data = await res.json();

      if (data.cvError) setCvError(data.cvError);

      navigation.replace('Meeting', {
        categoryId,
        categoryName: categoryName(
          selectedCategory,
          i18n.language,
          t('meetingSetup.defaultCategoryName'),
        ),
        // The call screen needs the choice for every API call, for the voice,
        // and for the recogniser — it is not a display preference.
        language,
        context: {
          ...data.context,
          gender,
        },
      });
    } catch {
      setFormError(serverMessage ?? t('meetingSetup.startFailed'));
    } finally {
      setAnalyzing(false);
    }
  }, [
    categoryId, company, jobTitle, jobDescription, cvFile, gender, language,
    selectedCategory, navigation, i18n.language, t,
  ]);

  const overlay = analyzing ? (
    <View style={[styles.overlay, { backgroundColor: theme.colors.overlay }]}>
      <Card padding="lg" style={{ alignItems: 'center', gap: theme.spacing.md, minWidth: theme.layout.maxContentWidth / 3 }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text role="h4" weight="bold" align="center">
          {cvFile ? t('meetingSetup.preparingCv') : t('meetingSetup.preparing')}
        </Text>
        <Text role="caption" tone="muted" align="center">
          {t('meetingSetup.preparingHint')}
        </Text>
      </Card>
    </View>
  ) : null;

  return (
    <Screen
      scroll
      keyboardAvoiding
      edges={['bottom']}
      contentStyle={{ gap: theme.spacing.lg, paddingTop: theme.spacing.lg }}
      footer={overlay}
    >
      {/* Header */}
      <MotiView
        from={{ opacity: 0, translateY: theme.spacing.sm }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: theme.motion.duration.normal }}
        style={{ gap: theme.spacing.xs }}
      >
        <Text role="h1" weight="bold">{t('meetingSetup.title')}</Text>
        <Text role="bodySm" tone="muted">{t('meetingSetup.subtitle')}</Text>
      </MotiView>

      {/* Interview language — first, because it is the one choice that cannot
          be revisited once the call starts. */}
      <Card padding="md" style={{ gap: theme.spacing.md }}>
        <FieldHeader
          icon="language-outline"
          title={t('meetingSetup.language')}
          hint={t('meetingSetup.languageHint')}
        />
        <View
          style={[styles.tileRow, { gap: theme.spacing.md }]}
          accessibilityRole="radiogroup"
          accessibilityLabel={t('meetingSetup.language')}
        >
          <ChoiceTile
            selected={language === 'ar'}
            onPress={() => setLanguage('ar')}
            title={t('meetingSetup.languageAr')}
            subtitle={t('meetingSetup.languageArHint')}
            a11yHint={t('meetingSetup.languageHint')}
            accent={theme.colors.primary}
            accentSurface={theme.colors.primaryMuted}
            media={
              <LanguageGlyph label={t('meetingSetup.languageArGlyph')} selected={language === 'ar'} />
            }
          />
          <ChoiceTile
            selected={language === 'en'}
            onPress={() => setLanguage('en')}
            title={t('meetingSetup.languageEn')}
            subtitle={t('meetingSetup.languageEnHint')}
            a11yHint={t('meetingSetup.languageHint')}
            accent={theme.colors.primary}
            accentSurface={theme.colors.primaryMuted}
            media={
              <LanguageGlyph label={t('meetingSetup.languageEnGlyph')} selected={language === 'en'} />
            }
          />
        </View>
      </Card>

      {/* Interviewer */}
      <Card padding="md" style={{ gap: theme.spacing.md }}>
        <FieldHeader
          icon="person-circle-outline"
          title={t('meetingSetup.interviewer')}
          hint={t('meetingSetup.interviewerHint')}
        />
        <View
          style={[styles.tileRow, { gap: theme.spacing.md }]}
          accessibilityRole="radiogroup"
          accessibilityLabel={t('meetingSetup.interviewer')}
        >
          <ChoiceTile
            selected={gender === 'female'}
            onPress={() => setGender('female')}
            title={t('meeting.hrFemaleName')}
            subtitle={t('meeting.hrFemaleRole')}
            accent={PERSONA.female.color}
            accentSurface={theme.colors.surfaceSunken}
            media={<PersonaAvatar gender="female" />}
          />
          <ChoiceTile
            selected={gender === 'male'}
            onPress={() => setGender('male')}
            title={t('meeting.hrMaleName')}
            subtitle={t('meeting.hrMaleRole')}
            accent={PERSONA.male.color}
            accentSurface={theme.colors.surfaceSunken}
            media={<PersonaAvatar gender="male" />}
          />
        </View>
      </Card>

      {/* Field */}
      <Card padding="md" style={{ gap: theme.spacing.md }}>
        <FieldHeader
          icon="briefcase-outline"
          title={t('meetingSetup.field')}
          hint={t('meetingSetup.fieldHint')}
        />
        <View
          style={[styles.chipsWrap, { gap: theme.spacing.sm }]}
          accessibilityRole="radiogroup"
          accessibilityLabel={t('meetingSetup.field')}
        >
          {categories.map((c) => {
            const selected = categoryId === c.id;
            const label = categoryName(c, i18n.language);
            return (
              <Pressable
                key={c.id}
                onPress={() => { setCategoryId(c.id); setFormError(null); }}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={label}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    gap: theme.spacing.xs,
                    minHeight: theme.layout.control.sm,
                    paddingVertical: theme.spacing.sm,
                    paddingHorizontal: theme.spacing.lg,
                    borderRadius: theme.radii.pill,
                    borderWidth: 1.5,
                    backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceSunken,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Text
                  role="bodySm"
                  weight="bold"
                  tone="inherit"
                  numberOfLines={1}
                  style={{ color: selected ? theme.colors.onPrimary : theme.colors.text }}
                >
                  {label}
                </Text>
                {c.isPremium ? (
                  <Ionicons
                    name="star"
                    size={theme.layout.icon.xs}
                    color={selected ? theme.colors.onPrimary : theme.colors.accent}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </Card>

      {/* Job details */}
      <Card padding="md" style={{ gap: theme.spacing.md }}>
        <FieldHeader
          icon="document-text-outline"
          title={t('meetingSetup.details')}
          hint={t('meetingSetup.detailsHint')}
        />

        <Input
          label={t('meetingSetup.company')}
          value={company}
          onChangeText={setCompany}
          placeholder={t('meetingSetup.companyPlaceholder')}
          iconLeft="business-outline"
        />

        <Input
          label={t('meetingSetup.jobTitle')}
          value={jobTitle}
          onChangeText={setJobTitle}
          placeholder={t('meetingSetup.jobTitlePlaceholder')}
          iconLeft="pricetag-outline"
        />

        <Input
          label={t('meetingSetup.jobDescription')}
          helperText={t('meetingSetup.jobDescriptionHint')}
          value={jobDescription}
          onChangeText={setJobDescription}
          placeholder={t('meetingSetup.jobDescriptionPlaceholder')}
          multiline
          numberOfLines={6}
          style={{
            minHeight: theme.layout.control.lg * 2,
            paddingTop: theme.spacing.md,
            paddingBottom: theme.spacing.md,
            textAlignVertical: 'top',
          }}
        />
      </Card>

      {/* CV */}
      <Card padding="md" style={{ gap: theme.spacing.md }}>
        <FieldHeader
          icon="cloud-upload-outline"
          title={t('meetingSetup.cv')}
          hint={t('meetingSetup.cvHint', { mb: MAX_CV_MB })}
        />

        <Pressable
          onPress={() => { void pickFile(); }}
          accessibilityRole="button"
          accessibilityLabel={cvFile ? cvName : t('meetingSetup.cvPick')}
          accessibilityHint={t('meetingSetup.cvPickHint')}
          style={({ pressed }) => [
            styles.upload,
            {
              gap: theme.spacing.md,
              minHeight: theme.layout.control.lg,
              paddingVertical: theme.spacing.md,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radii.md,
              borderWidth: 1.5,
              borderColor: cvFile ? theme.colors.primaryBorder : theme.colors.border,
              backgroundColor: cvFile ? theme.colors.primaryMuted : theme.colors.surfaceSunken,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Ionicons
            name={cvFile ? 'document-text' : 'cloud-upload-outline'}
            size={theme.layout.icon.lg}
            color={theme.colors.primary}
          />
          <View style={{ flex: 1, gap: theme.spacing.xxs }}>
            <Text role="bodySm" weight="bold" numberOfLines={1}>
              {cvFile ? cvName : t('meetingSetup.cvPick')}
            </Text>
            <Text role="micro" tone="muted" numberOfLines={1}>
              {cvFile ? t('meetingSetup.cvReady') : t('meetingSetup.cvPickHint')}
            </Text>
          </View>
          {cvFile ? (
            <Pressable
              onPress={clearFile}
              hitSlop={theme.spacing.sm}
              accessibilityRole="button"
              accessibilityLabel={t('meetingSetup.cvRemove')}
            >
              <Ionicons name="close-circle" size={theme.layout.icon.lg} color={theme.colors.textMuted} />
            </Pressable>
          ) : null}
        </Pressable>

        {cvError ? <Notice tone="warning" text={cvError} /> : null}

        {/* The CV analysis is a flat charge, so it is stated before the file is
            picked rather than discovered on the bill. The number is the
            server's; when it is zero (subscribers) the sentence changes rather
            than printing "0 seconds". */}
        {cvCostHint ? (
          <Text role="micro" tone="muted">{cvCostHint}</Text>
        ) : null}
      </Card>

      {formError ? <Notice tone="danger" text={formError} /> : null}

      {outOfMinutes ? (
        <Button
          title={t('meeting.quotaCta')}
          variant="accent"
          onPress={() => navigation.navigate('Subscription')}
          iconLeft={<Ionicons name="time" size={theme.layout.icon.md} color={theme.colors.onAccent} />}
        />
      ) : null}

      <Button
        title={analyzing ? t('meetingSetup.ctaLoading') : t('meetingSetup.cta')}
        onPress={analyzeAndStart}
        loading={analyzing}
        disabled={!categoryId}
        iconLeft={<Ionicons name="videocam" size={theme.layout.icon.md} color={theme.colors.onPrimary} />}
        size="lg"
      />

      <Text role="micro" tone="muted" align="center">
        {t('meetingSetup.footnote')}
      </Text>
    </Screen>
  );
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

/** Card heading: icon, label, and the one line explaining why it matters. */
function FieldHeader({
  icon, title, hint,
}: { icon: keyof typeof Ionicons.glyphMap; title: string; hint?: string }) {
  const theme = useAppTheme();

  return (
    <View style={[styles.row, { gap: theme.spacing.md, alignItems: 'flex-start' }]}>
      <View
        style={[
          styles.center,
          {
            width: theme.layout.avatar.sm,
            height: theme.layout.avatar.sm,
            borderRadius: theme.radii.sm,
            backgroundColor: theme.colors.primaryMuted,
          },
        ]}
      >
        <Ionicons name={icon} size={theme.layout.icon.md} color={theme.colors.primary} />
      </View>
      <View style={{ flex: 1, gap: theme.spacing.xxs }}>
        <Text role="h4" weight="bold">{title}</Text>
        {hint ? <Text role="caption" tone="muted">{hint}</Text> : null}
      </View>
    </View>
  );
}

/**
 * One option in a two-up selector — used for both the interview language and
 * the interviewer. `accent` is the ring/check colour: the theme primary for
 * language, the persona's own identity colour for the HR picker, so the tile
 * previews exactly the avatar the candidate will meet on the call.
 */
function ChoiceTile({
  selected, onPress, title, subtitle, media, accent, accentSurface, a11yHint,
}: {
  selected: boolean;
  onPress: () => void;
  title: string;
  subtitle?: string;
  media: ReactNode;
  accent: string;
  accentSurface: string;
  a11yHint?: string;
}) {
  const theme = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={title}
      accessibilityHint={a11yHint ?? subtitle}
      style={({ pressed }) => [
        styles.tile,
        {
          gap: theme.spacing.xs,
          paddingVertical: theme.spacing.lg,
          paddingHorizontal: theme.spacing.md,
          borderRadius: theme.radii.md,
          borderWidth: 1.5,
          borderColor: selected ? accent : theme.colors.border,
          backgroundColor: selected ? accentSurface : theme.colors.surface,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      {media}
      <Text role="bodySm" weight={selected ? 'bold' : 'regular'} align="center" numberOfLines={1}>
        {title}
      </Text>
      {subtitle ? (
        <Text role="micro" tone="muted" align="center" numberOfLines={2}>
          {subtitle}
        </Text>
      ) : null}

      {selected ? (
        <View
          style={[
            styles.check,
            styles.center,
            {
              top: theme.spacing.sm,
              start: theme.spacing.sm,
              width: theme.layout.icon.lg,
              height: theme.layout.icon.lg,
              borderRadius: theme.radii.pill,
              backgroundColor: accent,
            },
          ]}
        >
          <Ionicons name="checkmark" size={theme.layout.icon.xs} color={theme.colors.onBrandText} />
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The language tile's "media" slot: the language's own name in its own script.
 * A flag would be wrong here — Arabic is not one country's language, and
 * English is not the UK's.
 */
function LanguageGlyph({ label, selected }: { label: string; selected: boolean }) {
  const theme = useAppTheme();

  return (
    <View
      style={[
        styles.center,
        {
          width: theme.layout.avatar.lg,
          height: theme.layout.avatar.lg,
          borderRadius: theme.radii.pill,
          backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceSunken,
        },
      ]}
    >
      <Text
        role="h3"
        weight="bold"
        tone="inherit"
        style={{ color: selected ? theme.colors.onPrimary : theme.colors.textSecondary }}
      >
        {label}
      </Text>
    </View>
  );
}

/** The DiceBear avatar, with an initial-circle fallback where `img` has no home. */
function PersonaAvatar({ gender }: { gender: InterviewerGender }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const name = t(gender === 'male' ? 'meeting.hrMaleName' : 'meeting.hrFemaleName');
  // Same token as the language tile's glyph circle, so the two selectors read
  // as one control rather than two differently-sized ones.
  const size = theme.layout.avatar.lg;

  if (Platform.OS === 'web') {
    return (
      // @ts-ignore — the avatar is an SVG over HTTP; a plain <img> renders it
      // without pulling in an SVG loader.
      <img
        src={personaAvatarUrl(gender)}
        alt={name}
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: '50%', display: 'block' }}
      />
    );
  }

  return (
    <View
      style={[
        styles.center,
        {
          width: size,
          height: size,
          borderRadius: theme.radii.pill,
          backgroundColor: PERSONA[gender].color,
        },
      ]}
    >
      <Text role="h2" weight="bold" tone="inherit" style={{ color: theme.colors.onBrandText }}>
        {name.slice(0, 1)}
      </Text>
    </View>
  );
}

/** Inline message. Used instead of `Alert.alert`, which react-native-web maps
 *  onto `window.alert` — a modal the candidate has to dismiss to keep typing. */
function Notice({ tone, text }: { tone: 'danger' | 'warning'; text: string }) {
  const theme = useAppTheme();
  const ink = tone === 'danger' ? theme.colors.danger : theme.colors.warning;
  const fill = tone === 'danger' ? theme.colors.dangerMuted : theme.colors.warningMuted;

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.row,
        {
          gap: theme.spacing.sm,
          alignItems: 'flex-start',
          padding: theme.spacing.md,
          borderRadius: theme.radii.md,
          backgroundColor: fill,
          borderWidth: theme.layout.hairline,
          borderColor: ink,
        },
      ]}
    >
      <Ionicons
        name={tone === 'danger' ? 'alert-circle' : 'information-circle'}
        size={theme.layout.icon.md}
        color={ink}
      />
      <Text role="bodySm" flex tone="inherit" style={{ color: ink }}>
        {text}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Layout-only styles — every colour, size and gap is applied inline from
 * the theme so this screen stays token-driven.
 * ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  tileRow: { flexDirection: 'row' },
  tile: { flex: 1, alignItems: 'center', position: 'relative', overflow: 'hidden' },
  check: { position: 'absolute' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center' },
  upload: { flexDirection: 'row', alignItems: 'center' },
  overlay: {
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
    alignItems: 'center', justifyContent: 'center',
  },
});
