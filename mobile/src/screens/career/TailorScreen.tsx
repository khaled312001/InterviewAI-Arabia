import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, Switch } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { useAppTheme } from '../../theme/useTheme';
import { Screen, Text, Card, Button, Input, Badge, SectionHeader } from '../../components';
import { useBalance } from '../../store/balance';
import {
  careerApi, openDownload, percentTone, CV_LANGUAGES, TEMPLATES,
  type CvLanguage, type Template, type TailorResult, type FreeTool,
} from './careerApi';
import { Chip, AtsReportView, useCareerError, styles } from './careerUi';

const TONES = ['professional', 'warm', 'confident', 'concise'] as const;
type Tone = (typeof TONES)[number];

/**
 * Tailor the master CV to one job (from the board, or pasted), optionally with
 * a cover letter. The result is saved as a CV version on the server; this
 * screen shows what changed, what the CV does not show, and the downloads.
 */
export function TailorScreen({ route, navigation }: any) {
  const theme = useAppTheme();
  const { t, i18n } = useTranslation();
  const describe = useCareerError();
  const refreshBalance = useBalance((s) => s.refresh);
  const jobId: string | undefined = route.params?.jobId;
  const jobTitleParam: string | undefined = route.params?.title;

  const [jobTitle, setJobTitle] = useState('');
  const [company, setCompany] = useState('');
  const [jd, setJd] = useState('');
  const [cvLanguage, setCvLanguage] = useState<CvLanguage>(i18n.language === 'ar' ? 'ar' : 'en');
  const [template, setTemplate] = useState<Template>('classic');
  const [withLetter, setWithLetter] = useState(true);
  const [tone, setTone] = useState<Tone>('professional');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{ text: string; kind: string } | null>(null);
  const [result, setResult] = useState<TailorResult | null>(null);
  const [freeUses, setFreeUses] = useState<Partial<Record<FreeTool, boolean>>>({});
  useEffect(() => { careerApi.freeUses().then(setFreeUses).catch(() => {}); }, []);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const out = await careerApi.tailor({
        ...(jobId ? { jobId } : { jobTitle, company, jobDescription: jd }),
        cvLanguage,
        uiLanguage: i18n.language,
        template,
        withLetter,
        tone,
      });
      setResult(out);
      refreshBalance();
      careerApi.freeUses().then(setFreeUses).catch(() => {});
    } catch (e) {
      const err = describe(e);
      setError({ text: err.message, kind: err.kind });
    } finally {
      setRunning(false);
    }
  }, [jobId, jobTitle, company, jd, cvLanguage, i18n.language, template, withLetter, tone, describe, refreshBalance]);

  const download = useCallback(async (format: 'html' | 'pdf' | 'docx', kind: 'cv' | 'letter' = 'cv') => {
    if (!result) return;
    try {
      await openDownload({ kind, versionId: result.version.id, format });
    } catch (e) {
      setError({ text: describe(e).message, kind: 'other' });
    }
  }, [result, describe]);

  if (result) {
    const v = result.version;
    return (
      <Screen scroll contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.lg, paddingBottom: theme.spacing['3xl'] }}>
        <Card padding="lg">
          <Text role="h3" weight="bold">{t('career.tailorScreen.resultTitle')}</Text>
          <Text role="bodySm" tone="secondary">{v.title}</Text>
          <View style={[styles.row, { gap: theme.spacing.md, marginTop: theme.spacing.md }]}>
            <Badge size="md" tone={percentTone(result.ats.before)} label={`${t('career.tailorScreen.before')} ${result.ats.before}`} />
            <Ionicons name="arrow-forward" size={18} color={theme.colors.textMuted} />
            <Badge size="md" tone={percentTone(result.ats.after)} label={`${t('career.tailorScreen.after')} ${result.ats.after}`} />
          </View>
          <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.lg }}>
            <Button title={t('career.tailorScreen.downloadPdf')} fullWidth onPress={() => download('pdf')}
              iconLeft={<Ionicons name="document-outline" size={18} color={theme.colors.textOnBrand} />} />
            <Button title={t('career.tailorScreen.downloadWord')} variant="outline" fullWidth onPress={() => download('docx')} />
            {v.coverLetter ? <Button title={t('career.tailorScreen.openLetter')} variant="secondary" fullWidth onPress={() => download('html', 'letter')} /> : null}
          </View>
          {error ? <Text role="bodySm" tone="danger" style={{ marginTop: theme.spacing.sm }}>{error.text}</Text> : null}
        </Card>

        {result.changes.length ? (
          <Card padding="lg">
            <SectionHeader title={t('career.tailorScreen.changes')} />
            {result.changes.map((c, i) => <Text key={i} role="bodySm" style={{ marginTop: theme.spacing.xs }}>{`• ${c}`}</Text>)}
          </Card>
        ) : null}

        {result.gaps.length ? (
          <Card padding="lg">
            <SectionHeader title={t('career.tailorScreen.gaps')} subtitle={t('career.tailorScreen.gapsHint')} />
            {result.gaps.map((c, i) => <Text key={i} role="bodySm" style={{ marginTop: theme.spacing.xs }}>{`• ${c}`}</Text>)}
          </Card>
        ) : null}

        {result.questions.length ? (
          <Card padding="lg">
            <SectionHeader title={t('career.tailorScreen.questions')} />
            {result.questions.map((c, i) => <Text key={i} role="bodySm" style={{ marginTop: theme.spacing.xs }}>{`${i + 1}. ${c}`}</Text>)}
          </Card>
        ) : null}

        {v.coverLetter ? (
          <Card padding="lg">
            <SectionHeader title={t('career.tailorScreen.letter')} />
            <Text role="bodySm" selectable style={{ marginTop: theme.spacing.sm }}>{v.coverLetter}</Text>
          </Card>
        ) : null}

        <AtsReportView report={result.ats.report} />

        <Button title={t('career.tailorScreen.allVersions')} variant="ghost" onPress={() => navigation.navigate('CvVersions')} />
      </Screen>
    );
  }

  return (
    <Screen scroll keyboardAvoiding contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.lg, paddingBottom: theme.spacing['3xl'] }}>
      {jobId ? (
        <Card padding="lg" variant="filled">
          <Text role="body" weight="bold">{t('career.tailorScreen.forJob', { title: jobTitleParam || '' })}</Text>
        </Card>
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          <Input label={t('career.tailorScreen.pasteTitle')} value={jobTitle} onChangeText={setJobTitle} />
          <Input label={t('career.tailorScreen.pasteCompany')} value={company} onChangeText={setCompany} />
          <Input label={t('career.tailorScreen.pasteJd')} value={jd} onChangeText={setJd} multiline style={{ minHeight: 160, textAlignVertical: 'top' }} />
        </View>
      )}

      <View style={{ gap: theme.spacing.sm }}>
        <Text role="bodySm" weight="bold" tone="secondary">{t('career.tailorScreen.cvLanguage')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.sm }}>
          {CV_LANGUAGES.map((l) => <Chip key={l} label={t(`career.languages.${l}`)} active={cvLanguage === l} onPress={() => setCvLanguage(l)} />)}
        </ScrollView>
        <Text role="bodySm" weight="bold" tone="secondary" style={{ marginTop: theme.spacing.sm }}>{t('career.tailorScreen.template')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.sm }}>
          {TEMPLATES.map((x) => <Chip key={x} label={t(`career.templates.${x}`)} active={template === x} onPress={() => setTemplate(x)} />)}
        </ScrollView>
        <View style={[styles.row, { gap: theme.spacing.md, marginTop: theme.spacing.sm }]}>
          <Text role="body" flex>{t('career.tailorScreen.withLetter')}</Text>
          <Switch value={withLetter} onValueChange={setWithLetter} />
        </View>
        {withLetter ? (
          <>
            <Text role="bodySm" weight="bold" tone="secondary">{t('career.tailorScreen.tone')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.sm }}>
              {TONES.map((x) => <Chip key={x} label={t(`career.tones.${x}`)} active={tone === x} onPress={() => setTone(x)} />)}
            </ScrollView>
          </>
        ) : null}
      </View>

      <Card padding="md" variant="outlined">
        <View style={[styles.row, { gap: theme.spacing.sm, alignItems: 'flex-start' }]}>
          <Ionicons name="shield-checkmark-outline" size={20} color={theme.colors.success} />
          <Text role="caption" tone="secondary" flex>{t('career.tailorScreen.honest')}</Text>
        </View>
      </Card>

      {error ? <Text role="bodySm" tone="danger">{error.text}</Text> : null}
      {error?.kind === 'quota' ? <Button title={t('subscription.title')} variant="accent" onPress={() => navigation.navigate('Subscription')} /> : null}
      {error?.kind === 'profile' ? <Button title={t('career.buildCv')} variant="accent" onPress={() => navigation.navigate('CvBuilder')} /> : null}

      <Button
        title={running ? t('career.tailorScreen.generating') : t('career.tailorScreen.generate')}
        size="lg"
        fullWidth
        loading={running}
        disabled={!jobId && jd.trim().length < 80}
        onPress={run}
        iconLeft={<Ionicons name="sparkles" size={18} color={theme.colors.textOnBrand} />}
      />
      {freeUses.cv_tailor ? (
        <View style={{ alignItems: 'center' }}>
          <Badge tone="success" icon="gift-outline" label={t('career.free.badge')} />
        </View>
      ) : null}
      <Text role="caption" tone="muted" align="center">{freeUses.cv_tailor ? t('career.free.note') : t('career.costNote')}</Text>
    </Screen>
  );
}
