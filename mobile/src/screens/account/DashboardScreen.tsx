import React, { useCallback, useState } from 'react';
import { View, Linking, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';

import { api } from '../../api/client';
import { useAuth } from '../../store/auth';
import { useBalance } from '../../store/balance';
import { useAppTheme } from '../../theme/useTheme';
import {
  Screen, Text, Card, ListRow, Badge, Button, Input, SkeletonCard, SectionHeader,
} from '../../components';
import { balanceLabel, formatShortDate } from '../mainShared';
import { careerApi, percentTone, type Overview } from '../career/careerApi';
import { calendarApi, type CalendarStatus } from '../calendar/calendarApi';
import {
  accountApi, PLAY_STORE_URL, WEBSITE_URL, type DesktopStatus,
} from './accountApi';

interface SubStatus {
  active: boolean;
  plan: 'free' | 'premium';
  premiumUntil: string | null;
}

const open = (url: string) => { Linking.openURL(url).catch(() => {}); };

/**
 * Everything a customer has with us, on one screen: the practice-interview
 * plan and minutes, the career tools, the live assistant and calendar, the
 * desktop app's plan (once its account is linked) and the apps to install.
 * Each section loads on its own, so one slow service never blanks the page.
 */
export function DashboardScreen({ navigation }: any) {
  const theme = useAppTheme();
  const { t, i18n } = useTranslation();
  const user = useAuth((s) => s.user);
  const balance = useBalance((s) => s.balance);
  const refreshBalance = useBalance((s) => s.refresh);

  const [sub, setSub] = useState<SubStatus | null>(null);
  const [career, setCareer] = useState<Overview | null>(null);
  const [calendar, setCalendar] = useState<CalendarStatus | null>(null);
  const [desktop, setDesktop] = useState<DesktopStatus | null>(null);

  const load = useCallback(() => {
    refreshBalance().catch(() => {});
    api.get<SubStatus>('/subscriptions/status').then((r) => setSub(r.data)).catch(() => {});
    careerApi.overview().then(setCareer).catch(() => {});
    calendarApi.status().then(setCalendar).catch(() => {});
    accountApi.desktop().then(setDesktop).catch(() => setDesktop(null));
  }, [refreshBalance]);

  useFocusEffect(load);

  const date = (v?: string | null) => formatShortDate(v, i18n.language);
  const appsTotal = career ? Object.values(career.applications).reduce((n, x) => n + (x || 0), 0) : 0;
  const freeLeft = career?.freeUses ? Object.values(career.freeUses).filter(Boolean).length : 0;
  const premium = sub?.active ?? balance?.plan === 'premium';

  return (
    <Screen scroll contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.lg, paddingBottom: theme.spacing['3xl'] }}>
      <View>
        <Text role="h3" weight="bold">{t('dashboard.hello', { name: user?.name || '' })}</Text>
        <Text role="bodySm" tone="secondary">{user?.email}</Text>
      </View>

      {/* ---------------------------------------------- practice interviews */}
      <SectionHeader title={t('dashboard.practice.title')} />
      <Card padding="none">
        <ListRow
          icon="time-outline"
          iconTone="primary"
          title={t('dashboard.practice.balance')}
          subtitle={balance ? balanceLabel(balance.availableSeconds, t) : '…'}
          onPress={() => navigation.navigate('Ledger')}
          divider
        />
        <ListRow
          icon="diamond-outline"
          iconTone="accent"
          title={t('dashboard.practice.plan')}
          subtitle={premium
            ? (sub?.premiumUntil ? t('dashboard.practice.premiumUntil', { date: date(sub.premiumUntil) }) : t('dashboard.practice.premium'))
            : t('dashboard.practice.free')}
          trailing={<Badge tone={premium ? 'success' : 'neutral'} label={premium ? t('dashboard.active') : t('dashboard.practice.freeBadge')} />}
          onPress={() => navigation.navigate('Subscription')}
          divider
        />
        <ListRow
          icon="mic-outline"
          iconTone="success"
          title={t('dashboard.practice.start')}
          onPress={() => navigation.navigate('Main', { screen: 'Home' })}
        />
      </Card>

      {/* ---------------------------------------------------------- career */}
      <SectionHeader title={t('dashboard.career.title')} />
      {!career ? <SkeletonCard height={200} /> : (
        <Card padding="none">
          <ListRow
            icon="document-text-outline"
            iconTone="primary"
            title={t('career.hub.cv')}
            subtitle={career.hasProfile && career.cvScore != null ? t('career.hub.cvScore', { score: career.cvScore }) : t('career.hub.cvMissing')}
            trailing={career.cvScore != null ? <Badge tone={percentTone(career.cvScore)} label={String(career.cvScore)} /> : undefined}
            onPress={() => navigation.navigate('CvBuilder')}
            divider
          />
          <ListRow
            icon="sparkles-outline"
            iconTone="accent"
            title={t('career.hub.versions')}
            trailing={career.versions ? <Badge label={String(career.versions)} /> : undefined}
            onPress={() => navigation.navigate('CvVersions')}
            divider
          />
          <ListRow
            icon="albums-outline"
            iconTone="success"
            title={t('career.hub.applications')}
            trailing={appsTotal ? <Badge label={String(appsTotal)} /> : undefined}
            onPress={() => navigation.navigate('Applications')}
            divider
          />
          <ListRow
            icon="notifications-outline"
            iconTone="warning"
            title={t('career.hub.alerts')}
            trailing={career.savedSearches ? <Badge label={String(career.savedSearches)} /> : undefined}
            onPress={() => navigation.navigate('SavedSearches')}
            divider
          />
          <ListRow
            icon="briefcase-outline"
            iconTone="primary"
            title={t('dashboard.career.jobs')}
            subtitle={freeLeft ? t('dashboard.career.freeLeft', { count: freeLeft }) : undefined}
            onPress={() => navigation.navigate('Main', { screen: 'Jobs' })}
          />
        </Card>
      )}

      {/* ------------------------------------------ live assistant + calendar */}
      <SectionHeader title={t('dashboard.live.title')} />
      <Card padding="none">
        <ListRow
          icon="headset-outline"
          iconTone="accent"
          title={t('assist.title')}
          subtitle={t('dashboard.live.assistHint')}
          onPress={() => navigation.navigate('AssistSetup')}
          divider
        />
        <ListRow
          icon="calendar-outline"
          iconTone="primary"
          title={t('calendar.title')}
          subtitle={calendar?.connected
            ? t('dashboard.live.calendarOn', { email: calendar.email || '' })
            : t('dashboard.live.calendarOff')}
          trailing={calendar ? <Badge tone={calendar.connected ? 'success' : 'neutral'} label={calendar.connected ? t('dashboard.connected') : t('dashboard.notConnected')} /> : undefined}
          onPress={() => navigation.navigate('Calendar')}
        />
      </Card>

      {/* --------------------------------------------------------- desktop */}
      <SectionHeader title={t('dashboard.desktop.title')} />
      <DesktopCard status={desktop} onChange={setDesktop} date={date} />

      {/* ----------------------------------------------------- phone & web */}
      <SectionHeader title={t('dashboard.apps.title')} />
      <Card padding="none">
        {Platform.OS === 'web' ? (
          <ListRow
            icon="logo-google-playstore"
            iconTone="success"
            title={t('dashboard.apps.android')}
            subtitle={t('dashboard.apps.androidHint')}
            onPress={() => open(PLAY_STORE_URL)}
            divider
          />
        ) : null}
        <ListRow
          icon="globe-outline"
          iconTone="primary"
          title={t('dashboard.apps.web')}
          subtitle={`${WEBSITE_URL.replace('https://', '')}/app`}
          onPress={() => open(`${WEBSITE_URL}/app`)}
          divider
        />
        <ListRow
          icon="settings-outline"
          iconTone="neutral"
          title={t('settings.title')}
          onPress={() => navigation.navigate('Settings')}
        />
      </Card>
    </Screen>
  );
}

function DesktopCard({
  status, onChange, date,
}: { status: DesktopStatus | null; onChange: (s: DesktopStatus | null) => void; date: (v?: string | null) => string }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const link = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      onChange(await accountApi.linkDesktop(email.trim(), password));
      setPassword('');
      setShowForm(false);
    } catch (e: any) {
      const code = e?.response?.data?.code;
      const status = e?.response?.status;
      setError(
        code === 'DESKTOP_BAD_LOGIN' ? t('dashboard.desktop.errBadLogin')
          : code === 'DESKTOP_LINKED_ELSEWHERE' ? t('dashboard.desktop.errElsewhere')
            : status === 429 ? t('dashboard.desktop.errTooMany')
              : t('dashboard.desktop.errOther'),
      );
    } finally {
      setBusy(false);
    }
  }, [email, password, onChange, t]);

  const unlink = useCallback(async () => {
    setBusy(true);
    try {
      await accountApi.unlinkDesktop();
      onChange(await accountApi.desktop());
    } catch {
      /* the next visit shows the real state */
    } finally {
      setBusy(false);
    }
  }, [onChange]);

  if (!status) return <SkeletonCard height={140} />;

  const s = status.subscription;
  const download = () => open(`${WEBSITE_URL}${status.downloadPath}`);
  const pricing = () => open(`${WEBSITE_URL}${status.pricingPath}`);
  const stateTone = s?.state === 'active' ? 'success' : s?.state === 'exhausted' ? 'warning' : 'danger';

  if (status.available && status.linked) {
    return (
      <Card style={{ gap: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text role="body" weight="bold">{s ? s.planLabel : t('dashboard.desktop.noPlan')}</Text>
            <Text role="caption" tone="muted">{status.email}</Text>
          </View>
          {s ? <Badge tone={stateTone} label={t(`dashboard.desktop.state.${s.state}`)} /> : null}
        </View>
        {status.unreachable ? <Text role="bodySm" tone="warning">{t('dashboard.desktop.unreachable')}</Text> : null}
        {status.banned ? <Text role="bodySm" tone="danger">{t('dashboard.desktop.banned')}</Text> : null}
        {s ? (
          <View style={{ gap: theme.spacing.xs }}>
            <Text role="bodySm">{t('dashboard.desktop.answers', { left: s.answersLeft, total: s.answersTotal })}</Text>
            <Text role="bodySm" tone="secondary">{t('dashboard.desktop.period', { from: date(s.startsAt), to: date(s.endsAt) })}</Text>
          </View>
        ) : !status.unreachable ? <Text role="bodySm" tone="secondary">{t('dashboard.desktop.noPlanHint')}</Text> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          <Button title={t('dashboard.desktop.download')} onPress={download} size="sm" />
          {!s || s.state !== 'active' ? <Button title={t('dashboard.desktop.plans')} onPress={pricing} size="sm" variant="outline" /> : null}
          {status.via === 'password' ? <Button title={t('dashboard.desktop.unlink')} onPress={unlink} size="sm" variant="ghost" loading={busy} /> : null}
        </View>
      </Card>
    );
  }

  return (
    <Card style={{ gap: theme.spacing.md }}>
      <Text role="body" weight="bold">{t('dashboard.desktop.pitch')}</Text>
      <Text role="bodySm" tone="secondary">{t('dashboard.desktop.pitchHint')}</Text>
      {status.available && showForm ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Input
            label={t('dashboard.desktop.email')}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          <Input
            label={t('dashboard.desktop.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            passwordToggle
            autoComplete="password"
            error={error || undefined}
          />
          <Button title={t('dashboard.desktop.link')} onPress={link} loading={busy} disabled={!email.trim() || !password} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {status.available && !showForm ? (
          <Button title={t('dashboard.desktop.haveAccount')} onPress={() => setShowForm(true)} size="sm" />
        ) : null}
        <Button title={t('dashboard.desktop.plans')} onPress={pricing} size="sm" variant="outline" />
        <Button title={t('dashboard.desktop.download')} onPress={download} size="sm" variant="ghost" />
      </View>
    </Card>
  );
}
