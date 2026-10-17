import React, { useCallback, useEffect, useState } from 'react';
import { View, Switch, ScrollView, Pressable, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { takeCvIntent } from '../../navigation/webEntry';

import { authFetch } from '../../api/client';
import { useAppTheme } from '../../theme/useTheme';
import { Screen, Text, Card, Button, Input, SectionHeader, SkeletonCard, Badge } from '../../components';
import { useBalance } from '../../store/balance';
import {
  careerApi, openDownload, openExternal, countryName, emptyCv, errorKind, templatePreviewUrl, templateThumbUrl, TEMPLATES,
  type CvData, type CareerProfile, type Template, type TemplateInfo, type ExampleRole, type FreeTool,
} from './careerApi';
import { Chip, useCareerError, styles } from './careerUi';

const CV_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];
const MAX_BYTES = 4 * 1024 * 1024;
const TEMPLATE_KEY = 'career.cv.template';
const COUNTRIES = ['AE', 'SA', 'EG', 'QA', 'KW', 'BH', 'OM', 'JO', 'MA', 'GB', 'DE', 'NL', 'FR', 'IE', 'US', 'CA', 'AU', 'SG'];

type Exp = CvData['experience'][number];
type Edu = CvData['education'][number];

const blankExp = (): Exp => ({ title: '', company: '', location: '', start: '', end: '', current: false, bullets: [] });
const blankEdu = (): Edu => ({ degree: '', field: '', school: '', location: '', start: '', end: '', details: '' });

/* Text-field encodings for the list sections, so they edit as plain text. */
const langsToText = (l: CvData['languages']) => l.map((x) => (x.level ? `${x.name} - ${x.level}` : x.name)).join(', ');
const textToLangs = (s: string) => s.split(/[,،\n]/).map((x) => x.trim()).filter(Boolean)
  .map((x) => { const [name, ...rest] = x.split(/\s+[-–—]\s+/); return { name: name.trim(), level: rest.join(' - ').trim() }; });
const certsToText = (c: CvData['certifications']) => c.map((x) => [x.name, x.issuer, x.date].filter(Boolean).join(' — ')).join('\n');
const textToCerts = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
  .map((x) => { const [name, issuer = '', date = ''] = x.split(/\s+[-–—]\s+/); return { name: name.trim(), issuer: issuer.trim(), date: date.trim() }; });

export function CvBuilderScreen({ navigation }: any) {
  const theme = useAppTheme();
  const { t, i18n } = useTranslation();
  const describe = useCareerError();
  const refreshBalance = useBalance((s) => s.refresh);

  const [cv, setCv] = useState<CvData | null>(null);
  const [targetTitle, setTargetTitle] = useState('');
  const [targetCountry, setTargetCountry] = useState('');
  const [openToRemote, setOpenToRemote] = useState(true);
  const [skillsText, setSkillsText] = useState('');
  const [langsText, setLangsText] = useState('');
  const [certsText, setCertsText] = useState('');
  const [bulletsText, setBulletsText] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [improving, setImproving] = useState<number | null>(null);
  const [tips, setTips] = useState<Record<number, string[]>>({});
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null);
  const [needsTopUp, setNeedsTopUp] = useState(false);
  /** A template picked in the site's gallery ("use this design"), if that is how we got here. */
  const [intent, setIntent] = useState(() => takeCvIntent());
  const [template, setTemplateState] = useState<Template>(intent?.template || 'modern');
  /** The chosen design is remembered on this device, so the download keeps it next time. */
  const setTemplate = useCallback((id: Template) => {
    setTemplateState(id);
    AsyncStorage.setItem(TEMPLATE_KEY, id).catch(() => {});
  }, []);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [roles, setRoles] = useState<ExampleRole[]>([]);
  const [loadingExample, setLoadingExample] = useState<string | null>(null);
  const [beforeExample, setBeforeExample] = useState<CvData | null>(null);
  const [exampleLabel, setExampleLabel] = useState('');
  const [freeUses, setFreeUses] = useState<Partial<Record<FreeTool, boolean>>>({});
  const ar = i18n.language === 'ar';
  const [tplFilter, setTplFilter] = useState<'all' | 'ats' | 'photo' | string>('all');
  const [photoNote, setPhotoNote] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null);
  const refreshFree = useCallback(() => { careerApi.freeUses().then(setFreeUses).catch(() => {}); }, []);
  useEffect(() => {
    if (intent) AsyncStorage.setItem(TEMPLATE_KEY, intent.template).catch(() => {});
    else AsyncStorage.getItem(TEMPLATE_KEY).then((v) => { if (v) setTemplateState(v); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    careerApi.templates().then(setTemplates)
      .catch(() => setTemplates(TEMPLATES.map((id) => ({ id, nameEn: id, nameAr: id, descEn: '', descAr: '' }))));
    careerApi.examples().then(setRoles).catch(() => {});
    refreshFree();
  }, [refreshFree]);

  const fill = useCallback((p: CareerProfile) => {
    setCv(p.cv);
    setTargetTitle(p.targetTitle);
    setTargetCountry(p.targetCountry);
    setOpenToRemote(p.openToRemote);
    setSkillsText(p.cv.skills.join(', '));
    setLangsText(langsToText(p.cv.languages));
    setCertsText(certsToText(p.cv.certifications));
    setBulletsText(p.cv.experience.map((e) => e.bullets.join('\n')));
  }, []);

  useEffect(() => {
    careerApi.profile().then((d) => fill(d.profile)).catch(() => {
      setCv(emptyCv());
    });
  }, [fill]);

  const setBasics = (k: keyof CvData['basics'], v: string) =>
    setCv((c) => (c ? { ...c, basics: { ...c.basics, [k]: v } } : c));
  /** Pick a photo, crop it square and shrink it to 400px JPEG before it goes into the CV. */
  const pickPhoto = useCallback(async () => {
    setPhotoNote(null);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const side = Math.min(a.width || 400, a.height || 400);
      const actions = a.width && a.height && a.width !== a.height
        ? [{ crop: { originX: (a.width - side) / 2, originY: (a.height - side) / 2, width: side, height: side } }, { resize: { width: 400 } }]
        : [{ resize: { width: 400 } }];
      const out = await manipulateAsync(a.uri, actions, { compress: 0.72, format: SaveFormat.JPEG, base64: true });
      if (!out.base64) throw new Error('no data');
      setCv((c) => (c ? { ...c, basics: { ...c.basics, photo: `data:image/jpeg;base64,${out.base64}` } } : c));
      setPhotoNote({ text: t('career.cv.photoAdded'), tone: 'success' });
    } catch {
      setPhotoNote({ text: t('career.cv.photoFailed'), tone: 'danger' });
    }
  }, [t]);
  const setExp = (i: number, patch: Partial<Exp>) =>
    setCv((c) => (c ? { ...c, experience: c.experience.map((e, j) => (j === i ? { ...e, ...patch } : e)) } : c));
  const setEdu = (i: number, patch: Partial<Edu>) =>
    setCv((c) => (c ? { ...c, education: c.education.map((e, j) => (j === i ? { ...e, ...patch } : e)) } : c));

  /** The form's state folded back into one CV object. */
  const collect = useCallback((): CvData | null => {
    if (!cv) return null;
    return {
      ...cv,
      experience: cv.experience.map((e, i) => ({
        ...e,
        bullets: (bulletsText[i] || '').split('\n').map((b) => b.replace(/^[•\-*]\s*/, '').trim()).filter(Boolean),
      })),
      skills: skillsText.split(/[,،\n]/).map((s) => s.trim()).filter(Boolean),
      languages: textToLangs(langsText),
      certifications: textToCerts(certsText),
    };
  }, [cv, bulletsText, skillsText, langsText, certsText]);

  /**
   * Fill the form with an example CV (a role, or a random one). Nothing is
   * saved until the person presses Save, and the previous form can be put back.
   */
  const loadExample = useCallback(async (role: string) => {
    setLoadingExample(role);
    setMessage(null);
    try {
      const ex = await careerApi.example(role, ar ? 'ar' : 'en');
      const current = collect();
      setBeforeExample((prev) => prev ?? current);
      fill({ cv: ex.cv, targetTitle: ex.cv.basics.headline, targetCountry, openToRemote } as CareerProfile);
      setExampleLabel(ar ? ex.labelAr : ex.labelEn);
    } catch (e) {
      setMessage({ text: describe(e).message, tone: 'danger' });
    } finally {
      setLoadingExample(null);
    }
  }, [ar, collect, fill, targetCountry, openToRemote, describe]);

  const undoExample = useCallback(() => {
    if (!beforeExample) return;
    fill({ cv: beforeExample, targetTitle, targetCountry, openToRemote } as CareerProfile);
    setBeforeExample(null);
    setExampleLabel('');
  }, [beforeExample, fill, targetTitle, targetCountry, openToRemote]);

  const save = useCallback(async (): Promise<boolean> => {
    const data = collect();
    if (!data) return false;
    if (!data.basics.name.trim()) { setMessage({ text: t('career.cv.nameRequired'), tone: 'danger' }); return false; }
    setSaving(true);
    setMessage(null);
    try {
      const { profile } = await careerApi.saveProfile({ cv: data, targetTitle, targetCountry, openToRemote });
      fill(profile);
      setBeforeExample(null);
      setExampleLabel('');
      setMessage({ text: t('career.cv.savedOk'), tone: 'success' });
      return true;
    } catch (e) {
      setMessage({ text: describe(e).message, tone: 'danger' });
      return false;
    } finally {
      setSaving(false);
    }
  }, [collect, targetTitle, targetCountry, openToRemote, fill, t, describe]);

  const importFile = useCallback(async () => {
    setIntent(null);
    setMessage(null);
    setNeedsTopUp(false);
    const res = await DocumentPicker.getDocumentAsync({ type: CV_TYPES, copyToCacheDirectory: true, multiple: false }).catch(() => null);
    const asset = res && !res.canceled ? res.assets?.[0] : null;
    if (!asset) return;
    const name = asset.name || 'cv';
    if (!/\.(pdf|docx|txt)$/i.test(name)) { setMessage({ text: t('career.cv.fileType'), tone: 'danger' }); return; }
    if (typeof asset.size === 'number' && asset.size > MAX_BYTES) { setMessage({ text: t('career.cv.fileTooLarge'), tone: 'danger' }); return; }

    setImporting(true);
    try {
      const form = new FormData();
      const file = (asset as { file?: File }).file;
      if (file) form.append('cv', file);
      else form.append('cv', { uri: asset.uri, name, type: asset.mimeType || 'application/pdf' } as unknown as Blob);
      const r = await authFetch('/career/profile/import', { method: 'POST', body: form });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 402) { setNeedsTopUp(true); setMessage({ text: t('career.errors.quota'), tone: 'danger' }); }
        else if (r.status === 422) setMessage({ text: t('career.errors.file'), tone: 'danger' });
        else if (r.status === 503) setMessage({ text: t('career.errors.ai'), tone: 'danger' });
        else if (r.status === 429) setMessage({ text: t('career.errors.rate'), tone: 'danger' });
        else setMessage({ text: t('career.errors.other'), tone: 'danger' });
        return;
      }
      if (body.profile) fill(body.profile as CareerProfile);
      setMessage({ text: t('career.cv.imported'), tone: 'success' });
      setBeforeExample(null);
      setExampleLabel('');
      refreshBalance();
      refreshFree();
    } catch {
      setMessage({ text: t('career.errors.network'), tone: 'danger' });
    } finally {
      setImporting(false);
    }
  }, [fill, t, refreshBalance, refreshFree]);

  const improve = useCallback(async (i: number) => {
    const bullets = (bulletsText[i] || '').split('\n').map((b) => b.trim()).filter(Boolean);
    if (!bullets.length || !cv) return;
    setImproving(i);
    try {
      const out = await careerApi.improveBullets({ bullets, title: cv.experience[i]?.title || '', uiLanguage: i18n.language });
      setBulletsText((prev) => prev.map((b, j) => (j === i ? out.bullets.join('\n') : b)));
      setTips((prev) => ({ ...prev, [i]: out.tips }));
      refreshBalance();
      refreshFree();
    } catch (e) {
      if (errorKind(e) === 'quota') setNeedsTopUp(true);
      setMessage({ text: describe(e).message, tone: 'danger' });
    } finally {
      setImproving(null);
    }
  }, [bulletsText, cv, i18n.language, describe, refreshBalance, refreshFree]);

  /** Save the form first, so the file is exactly what is on screen, in the chosen design. */
  const download = useCallback(async (format: 'pdf' | 'docx' | 'html') => {
    if (!(await save())) return;
    try {
      await openDownload({ format, template, language: i18n.language === 'ar' ? 'ar' : 'en' });
    } catch (e) {
      setMessage({ text: describe(e).message, tone: 'danger' });
    }
  }, [i18n.language, describe, template, save]);

  if (!cv) {
    return <Screen contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.md }}><SkeletonCard /><SkeletonCard height={240} /></Screen>;
  }

  const countryChoices = targetCountry && !COUNTRIES.includes(targetCountry) ? [targetCountry, ...COUNTRIES] : COUNTRIES;
  const gap = { gap: theme.spacing.md };

  return (
    <Screen
      scroll
      keyboardAvoiding
      contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.xl, paddingBottom: theme.spacing['3xl'] }}
    >
      {(() => {
        const tp = templates.find((x) => x.id === template);
        const name = tp ? (ar ? tp.nameAr : tp.nameEn) : template;
        return (
          <Card padding="lg" variant={intent ? 'filled' : 'outlined'}>
            <View style={[styles.row, { gap: theme.spacing.md, alignItems: 'flex-start' }]}>
              <Image
                source={{ uri: templateThumbUrl(template, ar ? 'ar' : 'en') }}
                accessibilityIgnoresInvertColors
                style={{ width: 84, aspectRatio: 480 / 679, borderRadius: theme.radii.sm, backgroundColor: '#fff', borderWidth: theme.layout.hairline, borderColor: theme.colors.border }}
              />
              <View style={[styles.grow, { gap: theme.spacing.xxs }]}>
                <Text role="micro" weight="bold" tone="primary">{t('career.cv.designLabel')}</Text>
                <Text role="h4" weight="bold">{intent ? t('career.cv.designStart', { name }) : name}</Text>
                <Text role="bodySm" tone="secondary">{intent ? t('career.cv.designHow') : t('career.cv.designBody')}</Text>
              </View>
            </View>
            {intent ? (
              <View style={[styles.row, { gap: theme.spacing.sm, marginTop: theme.spacing.md, flexWrap: 'wrap' }]}>
                <View style={styles.grow}>
                  <Button title={importing ? t('career.cv.importing') : t('career.cv.designUpload')} loading={importing} onPress={importFile} fullWidth
                    iconLeft={<Ionicons name="cloud-upload-outline" size={18} color={theme.colors.textOnBrand} />} />
                </View>
                <View style={styles.grow}>
                  <Button title={t('career.cv.designManual')} variant="outline" onPress={() => setIntent(null)} fullWidth
                    iconLeft={<Ionicons name="create-outline" size={18} color={theme.colors.primary} />} />
                </View>
              </View>
            ) : (
              <View style={[styles.row, { gap: theme.spacing.sm, marginTop: theme.spacing.md }]}>
                <View style={styles.grow}>
                  <Button title={t('career.cv.designPdf')} size="sm" onPress={() => download('pdf')} fullWidth loading={saving}
                    iconLeft={<Ionicons name="download-outline" size={16} color={theme.colors.textOnBrand} />} />
                </View>
                <View style={styles.grow}>
                  <Button title={t('career.cv.designView')} size="sm" variant="outline" onPress={() => download('html')} fullWidth
                    iconLeft={<Ionicons name="eye-outline" size={16} color={theme.colors.primary} />} />
                </View>
              </View>
            )}
          </Card>
        );
      })()}

      <Card padding="lg" variant="filled">
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          <Text role="h4" weight="bold" flex>{t('career.cv.importTitle')}</Text>
          {freeUses.cv_import ? <Badge tone="success" icon="gift-outline" label={t('career.free.badge')} /> : null}
        </View>
        <Text role="bodySm" tone="secondary" style={{ marginTop: theme.spacing.xxs }}>{t('career.cv.importBody')}</Text>
        <Text role="caption" tone="muted" style={{ marginTop: theme.spacing.xxs }}>
          {freeUses.cv_import ? t('career.free.note') : t('career.costNote')}
        </Text>
        <Button
          title={importing ? t('career.cv.importing') : t('career.cv.import')}
          loading={importing}
          onPress={importFile}
          style={{ marginTop: theme.spacing.md }}
          iconLeft={<Ionicons name="cloud-upload-outline" size={18} color={theme.colors.textOnBrand} />}
        />
      </Card>

      <Card padding="lg" variant="outlined">
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          <Ionicons name="color-wand-outline" size={20} color={theme.colors.primary} />
          <Text role="h4" weight="bold" flex>{t('career.cv.examplesTitle')}</Text>
        </View>
        <Text role="bodySm" tone="secondary" style={{ marginTop: theme.spacing.xxs }}>{t('career.cv.examplesBody')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.sm, paddingTop: theme.spacing.md }}>
          <Chip label={loadingExample === 'random' ? '…' : t('career.cv.random')} active onPress={() => loadExample('random')} icon="shuffle-outline" />
          {roles.map((r) => (
            <Chip key={r.id} label={loadingExample === r.id ? '…' : (ar ? r.labelAr : r.labelEn)} active={false} onPress={() => loadExample(r.id)} />
          ))}
        </ScrollView>
      </Card>

      {exampleLabel ? (
        <Card padding="md" variant="filled">
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            <Ionicons name="information-circle-outline" size={20} color={theme.colors.warning} />
            <Text role="bodySm" flex>{t('career.cv.exampleLoaded', { role: exampleLabel })}</Text>
            {beforeExample ? <Button title={t('career.cv.undo')} size="sm" variant="ghost" onPress={undoExample} /> : null}
          </View>
        </Card>
      ) : null}

      {message ? <Text role="bodySm" tone={message.tone}>{message.text}</Text> : null}
      {needsTopUp ? <Button title={t('subscription.title')} variant="accent" onPress={() => navigation.navigate('Subscription')} /> : null}

      <View style={gap}>
        <SectionHeader title={t('career.cv.target')} />
        <Input label={t('career.cv.targetTitle')} value={targetTitle} onChangeText={setTargetTitle} />
        <Text role="bodySm" weight="bold" tone="secondary">{t('career.cv.targetCountry')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.sm }}>
          <Chip label={t('career.anywhere')} active={!targetCountry} onPress={() => setTargetCountry('')} />
          {countryChoices.map((c) => (
            <Chip key={c} label={countryName(c, i18n.language)} active={targetCountry === c} onPress={() => setTargetCountry(c)} />
          ))}
        </ScrollView>
        <View style={[styles.row, { gap: theme.spacing.md }]}>
          <Text role="body" flex>{t('career.cv.openToRemote')}</Text>
          <Switch value={openToRemote} onValueChange={setOpenToRemote} />
        </View>
      </View>

      <View style={gap}>
        <SectionHeader title={t('career.cv.basics')} />
        <Input label={t('career.cv.name')} value={cv.basics.name} onChangeText={(v) => setBasics('name', v)} required />
        <Input label={t('career.cv.headline')} value={cv.basics.headline} onChangeText={(v) => setBasics('headline', v)} />
        <Input label={t('career.cv.email')} value={cv.basics.email} onChangeText={(v) => setBasics('email', v)} keyboardType="email-address" autoCapitalize="none" />
        <Input label={t('career.cv.phone')} value={cv.basics.phone} onChangeText={(v) => setBasics('phone', v)} keyboardType="phone-pad" />
        <Input label={t('career.cv.location')} value={cv.basics.location} onChangeText={(v) => setBasics('location', v)} />
        <Input
          label={t('career.cv.link')}
          value={cv.basics.links[0]?.url || ''}
          autoCapitalize="none"
          keyboardType="url"
          onChangeText={(v) => setCv((c) => (c ? { ...c, basics: { ...c.basics, links: v ? [{ label: c.basics.links[0]?.label || 'LinkedIn', url: v }, ...c.basics.links.slice(1)] : c.basics.links.slice(1) } } : c))}
        />
        <Input label={t('career.cv.summary')} value={cv.basics.summary} onChangeText={(v) => setBasics('summary', v)} multiline numberOfLines={4} style={{ minHeight: 96, textAlignVertical: 'top' }} />
      </View>

      <View style={gap}>
        <SectionHeader title={t('career.cv.experience')} />
        {cv.experience.map((e, i) => (
          <Card key={i} padding="md" variant="outlined">
            <View style={gap}>
              <Input label={t('career.cv.jobTitle')} value={e.title} onChangeText={(v) => setExp(i, { title: v })} />
              <Input label={t('career.cv.company')} value={e.company} onChangeText={(v) => setExp(i, { company: v })} />
              <View style={[styles.row, { gap: theme.spacing.sm }]}>
                <View style={styles.grow}><Input label={t('career.cv.start')} value={e.start} onChangeText={(v) => setExp(i, { start: v })} placeholder="2022-03" /></View>
                <View style={styles.grow}><Input label={t('career.cv.end')} value={e.current ? '' : e.end} editable={!e.current} onChangeText={(v) => setExp(i, { end: v })} placeholder="2024-06" /></View>
              </View>
              <View style={[styles.row, { gap: theme.spacing.md }]}>
                <Text role="bodySm" flex>{t('career.cv.current')}</Text>
                <Switch value={e.current} onValueChange={(v) => setExp(i, { current: v, end: v ? '' : e.end })} />
              </View>
              <Input
                label={t('career.cv.bullets')}
                helperText={t('career.cv.bulletsHint')}
                value={bulletsText[i] || ''}
                onChangeText={(v) => setBulletsText((prev) => { const n = [...prev]; n[i] = v; return n; })}
                multiline
                style={{ minHeight: 110, textAlignVertical: 'top' }}
              />
              {tips[i]?.length ? (
                <View style={{ gap: theme.spacing.xxs }}>
                  {tips[i].map((tip, k) => <Text key={k} role="caption" tone="secondary">{`💡 ${tip}`}</Text>)}
                </View>
              ) : null}
              <View style={[styles.row, { gap: theme.spacing.sm }]}>
                <View style={styles.grow}>
                  <Button title={freeUses.cv_bullets ? `${t('career.cv.improve')} · ${t('career.free.badge')}` : t('career.cv.improve')} size="sm" variant="secondary" loading={improving === i} onPress={() => improve(i)}
                    iconLeft={<Ionicons name="sparkles-outline" size={16} color={theme.colors.primary} />} />
                </View>
                <Button title={t('career.cv.remove')} size="sm" variant="ghost" onPress={() => {
                  setCv((c) => (c ? { ...c, experience: c.experience.filter((_, j) => j !== i) } : c));
                  setBulletsText((prev) => prev.filter((_, j) => j !== i));
                  setTips({});
                }} />
              </View>
            </View>
          </Card>
        ))}
        <Button title={t('career.cv.addExperience')} variant="outline" onPress={() => {
          setCv((c) => (c ? { ...c, experience: [...c.experience, blankExp()] } : c));
          setBulletsText((prev) => [...prev, '']);
        }} iconLeft={<Ionicons name="add" size={18} color={theme.colors.primary} />} />
      </View>

      <View style={gap}>
        <SectionHeader title={t('career.cv.education')} />
        {cv.education.map((e, i) => (
          <Card key={i} padding="md" variant="outlined">
            <View style={gap}>
              <Input label={t('career.cv.degree')} value={e.degree} onChangeText={(v) => setEdu(i, { degree: v })} />
              <Input label={t('career.cv.field')} value={e.field} onChangeText={(v) => setEdu(i, { field: v })} />
              <Input label={t('career.cv.school')} value={e.school} onChangeText={(v) => setEdu(i, { school: v })} />
              <View style={[styles.row, { gap: theme.spacing.sm }]}>
                <View style={styles.grow}><Input label={t('career.cv.start')} value={e.start} onChangeText={(v) => setEdu(i, { start: v })} placeholder="2016" /></View>
                <View style={styles.grow}><Input label={t('career.cv.end')} value={e.end} onChangeText={(v) => setEdu(i, { end: v })} placeholder="2020" /></View>
              </View>
              <Button title={t('career.cv.remove')} size="sm" variant="ghost" onPress={() => setCv((c) => (c ? { ...c, education: c.education.filter((_, j) => j !== i) } : c))} />
            </View>
          </Card>
        ))}
        <Button title={t('career.cv.addEducation')} variant="outline" onPress={() => setCv((c) => (c ? { ...c, education: [...c.education, blankEdu()] } : c))}
          iconLeft={<Ionicons name="add" size={18} color={theme.colors.primary} />} />
      </View>

      <View style={gap}>
        <SectionHeader title={t('career.cv.skills')} />
        <Input value={skillsText} onChangeText={setSkillsText} helperText={t('career.cv.skillsHint')} multiline style={{ minHeight: 70, textAlignVertical: 'top' }} />
        <Input label={t('career.cv.languages')} value={langsText} onChangeText={setLangsText} helperText={t('career.cv.languagesHint')} />
        <Input label={t('career.cv.certifications')} value={certsText} onChangeText={setCertsText} helperText={t('career.cv.certificationsHint')} multiline style={{ minHeight: 70, textAlignVertical: 'top' }} />
      </View>

      <View style={gap}>
        <SectionHeader title={t('career.cv.templatesTitle')} />
        <Text role="bodySm" tone="secondary">{t('career.cv.templatesBody')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.xs }}>
          {[['all', t('career.cv.tplAll')], ...(templates.some((x) => x.ats) ? [['ats', t('career.cv.tplAts')]] : []), ...(templates.some((x) => x.photo) ? [['photo', t('career.cv.tplPhoto')]] : []),
            ...Array.from(new Map(templates.filter((x) => x.category).map((x) => [x.category as string, (ar ? x.categoryAr : x.categoryEn) || x.category as string])).entries())]
            .map(([k, label]) => <Chip key={k} label={label} active={tplFilter === k} onPress={() => setTplFilter(k)} />)}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.md, paddingVertical: theme.spacing.xs }}>
          {templates.filter((tp) => tplFilter === 'all' || (tplFilter === 'ats' ? tp.ats === 'best' : tplFilter === 'photo' ? tp.photo : tp.category === tplFilter)).map((tp) => {
            const on = tp.id === template;
            return (
              <Pressable
                key={tp.id}
                onPress={() => setTemplate(tp.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={ar ? tp.nameAr : tp.nameEn}
                style={{
                  width: 156, padding: theme.spacing.sm, gap: theme.spacing.xs, borderRadius: theme.radii.lg,
                  borderWidth: on ? 2 : 1, borderColor: on ? theme.colors.primary : theme.colors.border,
                  backgroundColor: theme.colors.surface,
                }}
              >
                <Image
                  source={{ uri: templateThumbUrl(tp.id, ar ? 'ar' : 'en') }}
                  accessibilityIgnoresInvertColors
                  style={{ width: '100%', aspectRatio: 480 / 679, borderRadius: theme.radii.md, backgroundColor: '#fff', borderWidth: theme.layout.hairline, borderColor: theme.colors.border }}
                />
                <View style={[styles.row, { gap: theme.spacing.xs }]}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tp.accent || theme.colors.primary }} />
                  <Text role="bodySm" weight="bold" flex numberOfLines={1}>{ar ? tp.nameAr : tp.nameEn}</Text>
                  {tp.photo ? <Ionicons name="person-circle-outline" size={15} color={theme.colors.textSecondary} /> : null}
                  {on ? <Ionicons name="checkmark-circle" size={16} color={theme.colors.primary} /> : null}
                </View>
                <Text role="micro" tone="muted" numberOfLines={2}>{ar ? tp.descAr : tp.descEn}</Text>
                <Pressable onPress={() => openExternal(templatePreviewUrl(tp.id, ar ? 'ar' : 'en'))} accessibilityRole="link" hitSlop={8}>
                  <Text role="micro" weight="bold" tone="primary">{t('career.cv.preview')}</Text>
                </Pressable>
              </Pressable>
            );
          })}
        </ScrollView>
        {templates.find((x) => x.id === template)?.photo ? (
          <Card>
            <View style={[styles.row, { gap: theme.spacing.md }]}>
              {cv.basics.photo ? (
                <Image source={{ uri: cv.basics.photo }} style={{ width: 64, height: 64, borderRadius: 32 }} accessibilityIgnoresInvertColors />
              ) : (
                <View style={{ width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderStyle: 'dashed', borderColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="camera-outline" size={26} color={theme.colors.primary} />
                </View>
              )}
              <View style={[styles.grow, { gap: 2 }]}>
                <Text role="bodySm" weight="bold">{t('career.cv.photoTitle')}</Text>
                <Text role="micro" tone="secondary">{t('career.cv.photoBody')}</Text>
              </View>
            </View>
            <View style={[styles.row, { gap: theme.spacing.sm, marginTop: theme.spacing.md }]}>
              <View style={styles.grow}>
                <Button title={cv.basics.photo ? t('career.cv.photoChange') : t('career.cv.photoUpload')} size="sm" onPress={pickPhoto} fullWidth
                  iconLeft={<Ionicons name="image-outline" size={16} color={theme.colors.textOnBrand} />} />
              </View>
              {cv.basics.photo ? <Button title={t('career.cv.photoRemove')} size="sm" variant="ghost" onPress={() => setBasics('photo', '')} /> : null}
            </View>
            {photoNote ? <Text role="micro" tone={photoNote.tone} style={{ marginTop: theme.spacing.xs }}>{photoNote.text}</Text> : null}
          </Card>
        ) : null}
      </View>

      <View style={gap}>
        <Button title={t('career.cv.save')} size="lg" loading={saving} onPress={save} fullWidth />
        <Text role="bodySm" weight="bold" tone="secondary" align="center">{t('career.cv.download')}</Text>
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          <View style={styles.grow}><Button title={t('career.cv.pdf')} variant="outline" fullWidth onPress={() => download('pdf')} /></View>
          <View style={styles.grow}><Button title={t('career.cv.word')} variant="outline" fullWidth onPress={() => download('docx')} /></View>
        </View>
      </View>
    </Screen>
  );
}
