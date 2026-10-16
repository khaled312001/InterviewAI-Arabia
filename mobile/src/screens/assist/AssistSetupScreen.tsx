import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { useAppTheme } from '../../theme/useTheme';
import { Screen, Text, Card, Button, Input, SectionHeader } from '../../components';
import { useBalance } from '../../store/balance';
import { careerApi, type Application } from '../career/careerApi';
import { Chip, styles } from '../career/careerUi';
import {
  assistApi, assistErrorKind,
  type AssistLanguage, type AssistSetup, type AssistStyle, type AssistErrorKind,
} from './assistApi';

const LANGUAGES: AssistLanguage[] = ['auto', 'en', 'ar'];
const STYLES: AssistStyle[] = ['concise', 'balanced', 'detailed'];

type JobMode = 'none' | 'saved' | 'paste';

/**
 * Before the interview: which job, which language, how long the answers are.
 *
 * The session is opened HERE rather than on the live screen, so the things
 * that can refuse it — no minutes, a job that has gone — are answered on a
 * screen with room to explain them and a button to fix them.
 */
export function AssistSetupScreen({ route, navigation }: any) {
  const theme = useAppTheme();
  const { t, i18n } = useTranslation();
  const refreshBalance = useBalance((s) => s.refresh);
  const presetJobId: string | undefined = route.params?.jobId;
  const presetTitle: string | undefined = route.params?.title;
  // From a calendar event: the title and company are known, the posting is not.
  const prefill: { title?: string; company?: string; notes?: string } | undefined = route.params?.prefill;

  const [jobMode, setJobMode] = useState<JobMode>(presetJobId ? 'saved' : prefill?.title || prefill?.company ? 'paste' : 'none');
  const [saved, setSaved] = useState<Application[] | null>(null);
  const [picked, setPicked] = useState<{ jobId?: string; title: string; company: string } | null>(
    presetJobId ? { jobId: presetJobId, title: presetTitle || '', company: '' } : null,
  );
  const [jobTitle, setJobTitle] = useState(prefill?.title || '');
  const [company, setCompany] = useState(prefill?.company || '');
  const [jd, setJd] = useState('');
  const [notes, setNotes] = useState(prefill?.notes && prefill.notes !== prefill.title ? prefill.notes : '');
  const [language, setLanguage] = useState<AssistLanguage>('auto');
  const [style, setStyle] = useState<AssistStyle>('balanced');
  const [hasCv, setHasCv] = useState<boolean | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<AssistErrorKind | null>(null);

  useEffect(() => {
    careerApi.profile()
      .then(({ profile, exists }) => setHasCv(Boolean(exists && (
        profile.targetTitle || profile.cv.basics.headline || profile.cv.experience.length || profile.cv.skills.length
      ))))
      .catch(() => setHasCv(null));
    careerApi.applications()
      .then((a) => setSaved(a.applications.slice(0, 12)))
      .catch(() => setSaved([]));
  }, []);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    const setup: AssistSetup = {
      language,
      style,
      uiLanguage: i18n.language === 'ar' ? 'ar' : 'en',
      notes: notes.trim(),
      ...(jobMode === 'saved' && picked
        ? picked.jobId
          ? { jobId: picked.jobId }
          : { jobTitle: picked.title, company: picked.company }
        : {}),
      ...(jobMode === 'paste'
        ? { jobTitle: jobTitle.trim(), company: company.trim(), jobDescription: jd.trim() }
        : {}),
    };
    try {
      const session = await assistApi.start(setup);
      navigation.replace('LiveAssist', { setup, session });
    } catch (e) {
      const kind = assistErrorKind(e);
      setError(kind);
      if (kind === 'quota') refreshBalance();
    } finally {
      setStarting(false);
    }
  }, [language, style, i18n.language, notes, jobMode, picked, jobTitle, company, jd, navigation, refreshBalance]);

  const errorText = error ? t(`assist.errors.${error === 'expired' || error === 'stt' ? 'other' : error}`) : null;

  return (
    <Screen scroll keyboardAvoiding contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.lg, paddingBottom: theme.spacing['3xl'] }}>
      <Card padding="lg" variant="filled">
        <View style={[styles.row, { gap: theme.spacing.md, alignItems: 'flex-start' }]}>
          <Ionicons name="ear" size={theme.layout.icon.lg} color={theme.colors.primary} />
          <Text role="bodySm" tone="secondary" flex>{t('assist.setup.intro')}</Text>
        </View>
      </Card>

      {/* --------------------------------------------------------- job */}
      <View style={{ gap: theme.spacing.sm }}>
        <SectionHeader title={t('assist.setup.jobSection')} subtitle={t('assist.setup.jobHint')} />
        {presetJobId ? (
          <Card padding="md" variant="outlined">
            <Text role="caption" tone="muted">{t('assist.setup.jobSelected')}</Text>
            <Text role="body" weight="bold">{presetTitle || ''}</Text>
          </Card>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.sm }}>
              {(['none', 'saved', 'paste'] as JobMode[]).map((m) => (
                <Chip
                  key={m}
                  label={t(`assist.setup.job${m === 'none' ? 'None' : m === 'saved' ? 'Saved' : 'Paste'}`)}
                  active={jobMode === m}
                  onPress={() => setJobMode(m)}
                />
              ))}
            </ScrollView>

            {jobMode === 'saved' ? (
              saved && saved.length ? (
                <View style={{ gap: theme.spacing.sm }}>
                  {saved.map((a) => {
                    const active = picked ? (picked.jobId ? picked.jobId === a.jobId : picked.title === a.title && picked.company === a.company) : false;
                    return (
                      <Card
                        key={a.id}
                        padding="md"
                        variant={active ? 'filled' : 'outlined'}
                        onPress={() => setPicked({ jobId: a.jobId || undefined, title: a.title, company: a.company })}
                        accessibilityLabel={`${a.title} — ${a.company}`}
                      >
                        <View style={[styles.row, { gap: theme.spacing.sm }]}>
                          <View style={styles.grow}>
                            <Text role="body" weight="bold" numberOfLines={1}>{a.title}</Text>
                            <Text role="caption" tone="secondary" numberOfLines={1}>{a.company}</Text>
                          </View>
                          {active ? <Ionicons name="checkmark-circle" size={theme.layout.icon.md} color={theme.colors.primary} /> : null}
                        </View>
                      </Card>
                    );
                  })}
                </View>
              ) : saved ? (
                <Text role="bodySm" tone="muted">{t('assist.setup.noSavedJobs')}</Text>
              ) : null
            ) : null}

            {jobMode === 'paste' ? (
              <View style={{ gap: theme.spacing.md }}>
                <Input label={t('assist.setup.pasteTitle')} value={jobTitle} onChangeText={setJobTitle} maxLength={200} />
                <Input label={t('assist.setup.pasteCompany')} value={company} onChangeText={setCompany} maxLength={200} />
                <Input
                  label={t('assist.setup.pasteJd')}
                  value={jd}
                  onChangeText={setJd}
                  multiline
                  maxLength={8000}
                  style={{ minHeight: 140, textAlignVertical: 'top' }}
                />
              </View>
            ) : null}
          </>
        )}
      </View>

      {/* ---------------------------------------------- language + length */}
      <View style={{ gap: theme.spacing.sm }}>
        <Text role="bodySm" weight="bold" tone="secondary">{t('assist.setup.language')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.sm }}>
          {LANGUAGES.map((l) => (
            <Chip key={l} label={t(`assist.setup.languages.${l}`)} active={language === l} onPress={() => setLanguage(l)} />
          ))}
        </ScrollView>
        <Text role="bodySm" weight="bold" tone="secondary" style={{ marginTop: theme.spacing.sm }}>{t('assist.setup.length')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.sm }}>
          {STYLES.map((s) => (
            <Chip key={s} label={t(`assist.setup.lengths.${s}`)} active={style === s} onPress={() => setStyle(s)} />
          ))}
        </ScrollView>
      </View>

      <Input
        label={t('assist.setup.notes')}
        placeholder={t('assist.setup.notesPlaceholder')}
        value={notes}
        onChangeText={setNotes}
        multiline
        maxLength={3000}
        style={{ minHeight: 96, textAlignVertical: 'top' }}
      />

      {/* -------------------------------------------------------- the CV */}
      {hasCv === false ? (
        <Card padding="md" variant="outlined">
          <View style={[styles.row, { gap: theme.spacing.sm, alignItems: 'flex-start' }]}>
            <Ionicons name="document-text-outline" size={theme.layout.icon.md} color={theme.colors.warning} />
            <Text role="bodySm" tone="secondary" flex>{t('assist.setup.cvMissing')}</Text>
          </View>
          <Button
            title={t('assist.setup.buildCv')}
            variant="outline"
            size="sm"
            style={{ marginTop: theme.spacing.sm }}
            onPress={() => navigation.navigate('CvBuilder')}
          />
        </Card>
      ) : hasCv ? (
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          <Ionicons name="checkmark-circle" size={theme.layout.icon.md} color={theme.colors.success} />
          <Text role="bodySm" tone="secondary" flex>{t('assist.setup.cvReady')}</Text>
        </View>
      ) : null}

      <Card padding="md" variant="outlined">
        <View style={{ gap: theme.spacing.sm }}>
          <View style={[styles.row, { gap: theme.spacing.sm, alignItems: 'flex-start' }]}>
            <Ionicons name="shield-checkmark-outline" size={theme.layout.icon.md} color={theme.colors.success} />
            <Text role="caption" tone="secondary" flex>{t('assist.setup.honest')}</Text>
          </View>
          <View style={[styles.row, { gap: theme.spacing.sm, alignItems: 'flex-start' }]}>
            <Ionicons name="time-outline" size={theme.layout.icon.md} color={theme.colors.textMuted} />
            <Text role="caption" tone="secondary" flex>{t('assist.setup.billing')}</Text>
          </View>
          <View style={[styles.row, { gap: theme.spacing.sm, alignItems: 'flex-start' }]}>
            <Ionicons name="information-circle-outline" size={theme.layout.icon.md} color={theme.colors.textMuted} />
            <Text role="caption" tone="secondary" flex>{t('assist.setup.allowed')}</Text>
          </View>
        </View>
      </Card>

      {errorText ? <Text role="bodySm" tone="danger">{errorText}</Text> : null}
      {error === 'quota' ? (
        <Button title={t('assist.buyMinutes')} variant="accent" onPress={() => navigation.navigate('Subscription')} />
      ) : null}

      <Button
        title={t('assist.setup.start')}
        size="lg"
        fullWidth
        loading={starting}
        disabled={(jobMode === 'saved' && !picked) || (jobMode === 'paste' && !jobTitle.trim() && !jd.trim())}
        onPress={start}
        iconLeft={<Ionicons name="mic" size={18} color={theme.colors.textOnBrand} />}
      />
    </Screen>
  );
}
