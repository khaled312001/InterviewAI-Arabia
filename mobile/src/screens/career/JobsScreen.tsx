import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, ScrollView, Pressable, AppState } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { useAppTheme } from '../../theme/useTheme';
import { Screen, Text, Button, Input, EmptyState, SkeletonCard } from '../../components';
import { careerApi, countryName, type JobCard, type Overview, type SearchResult } from './careerApi';
import { Chip, JobRow, useCareerError, styles } from './careerUi';

type Mode = 'forYou' | 'search';
const PAGE = 20;
/** How often the open search asks whether new jobs arrived. */
const POLL_MS = 90_000;

/**
 * The Jobs tab: jobs ranked against the person's CV ("For you"), and a free
 * worldwide search. Every row opens JobDetail; applying always happens on the
 * original listing.
 */
export function JobsScreen({ navigation }: any) {
  const theme = useAppTheme();
  const { t, i18n } = useTranslation();
  const describe = useCareerError();

  const [mode, setMode] = useState<Mode>('forYou');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [matches, setMatches] = useState<JobCard[] | null>(null);
  const [matchTitle, setMatchTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [country, setCountry] = useState('');
  const [remote, setRemote] = useState(false);
  const [countries, setCountries] = useState<{ key: string; name: string; count: number }[]>([]);
  const [results, setResults] = useState<JobCard[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [meta, setMeta] = useState<Pick<SearchResult, 'live' | 'query' | 'relaxed' | 'checkedAt'> | null>(null);
  const [fresh, setFresh] = useState(0);
  const seq = useRef(0);
  const lastParams = useRef<Record<string, string | number | undefined>>({});

  const loadForYou = useCallback(async () => {
    try {
      setError(null);
      const ov = await careerApi.overview();
      setOverview(ov);
      if (!ov.hasProfile) { setMatches([]); return; }
      const m = await careerApi.matches();
      setMatches(m.jobs);
      setMatchTitle(m.query.title);
    } catch (e) {
      setError(describe(e).message);
      setMatches((prev) => prev ?? []);
    }
  }, [describe]);

  // Back from the CV builder or a job: the profile or tracked state may have changed.
  useFocusEffect(useCallback(() => { loadForYou(); }, [loadForYou]));

  useEffect(() => {
    careerApi.facets(i18n.language).then((f) => setCountries(f.countries.slice(0, 14))).catch(() => {});
  }, [i18n.language]);

  const runSearch = useCallback(async (nextPage = 1) => {
    const mine = ++seq.current;
    setSearching(true);
    setNotice(null);
    try {
      const params = {
        q: q.trim() || undefined,
        country: country || undefined,
        workplace: remote ? 'remote' : undefined,
      };
      const data = await careerApi.search({ ...params, page: nextPage, pageSize: PAGE });
      if (mine !== seq.current) return;
      lastParams.current = params;
      if (nextPage === 1) {
        setMeta({ live: data.live, query: data.query, relaxed: data.relaxed, checkedAt: data.checkedAt });
        setFresh(0);
      }
      setTotal(data.total);
      setPage(nextPage);
      setResults((prev) => (nextPage === 1 || !prev ? data.jobs : [...prev, ...data.jobs]));
    } catch (e) {
      if (mine === seq.current) { setNotice(describe(e).message); setResults((prev) => prev ?? []); }
    } finally {
      if (mine === seq.current) setSearching(false);
    }
  }, [q, country, remote, describe]);

  // While the search is open, ask every 90 s whether new jobs arrived for it,
  // and offer them rather than reshuffling the list under the reader's thumb.
  useEffect(() => {
    if (mode !== 'search' || !meta?.checkedAt) return undefined;
    let active = AppState.currentState === 'active';
    const tick = () => {
      if (!active) return;
      careerApi.newCount({ ...lastParams.current, since: meta.checkedAt })
        .then((r) => setFresh(r.count))
        .catch(() => {});
    };
    const id = setInterval(tick, POLL_MS);
    const sub = AppState.addEventListener('change', (s) => { active = s === 'active'; if (active) tick(); });
    return () => { clearInterval(id); sub.remove(); };
  }, [mode, meta?.checkedAt]);

  // Filters apply immediately; the text box applies on submit.
  useEffect(() => { if (mode === 'search') runSearch(1); }, [mode, country, remote]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveAlert = useCallback(async () => {
    if (!q.trim() && !country) { setNotice(t('career.alerts.needQuery')); return; }
    try {
      const name = [q.trim(), country, remote ? t('career.workplace.remote') : ''].filter(Boolean).join(' · ');
      await careerApi.saveSearch({
        name: name.slice(0, 120),
        query: { q: q.trim(), country, workplace: remote ? 'remote' : '' },
        frequency: 'daily',
      });
      setNotice(t('career.alerts.created'));
    } catch (e) {
      setNotice(describe(e).message);
    }
  }, [q, country, remote, t, describe]);

  const openJob = useCallback((job: JobCard) => navigation.navigate('JobDetail', { jobId: job.id, title: job.title }), [navigation]);
  const goHub = useCallback(() => navigation.navigate('CareerHub'), [navigation]);
  const goCv = useCallback(() => navigation.navigate('CvBuilder'), [navigation]);

  return (
    <Screen scroll keyboardAvoiding contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.lg }}>
      <View style={[styles.row, { gap: theme.spacing.md }]}>
        <View style={styles.grow}>
          <Text role="h2" weight="bold">{t('career.tab')}</Text>
        </View>
        <Pressable
          onPress={goHub}
          accessibilityRole="button"
          accessibilityLabel={t('career.hub.title')}
          style={[styles.row, {
            gap: theme.spacing.xs, paddingHorizontal: theme.spacing.md, minHeight: theme.layout.control.sm,
            borderRadius: theme.radii.pill, backgroundColor: theme.colors.primaryMuted,
          }]}
        >
          <Ionicons name="briefcase-outline" size={18} color={theme.colors.primary} />
          <Text role="bodySm" weight="bold" tone="primary">{t('career.hub.title')}</Text>
        </Pressable>
      </View>

      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        <Chip label={t('career.forYou')} active={mode === 'forYou'} onPress={() => setMode('forYou')} icon="sparkles-outline" />
        <Chip label={t('career.search')} active={mode === 'search'} onPress={() => setMode('search')} icon="search-outline" />
      </View>

      {mode === 'forYou' ? (
        <View style={{ gap: theme.spacing.md }}>
          {matches === null ? (
            <><SkeletonCard /><SkeletonCard /><SkeletonCard /></>
          ) : overview && !overview.hasProfile ? (
            <EmptyState
              icon="document-text-outline"
              title={t('career.noProfileTitle')}
              description={t('career.noProfileBody')}
              actionLabel={t('career.buildCv')}
              onAction={goCv}
            />
          ) : error ? (
            <EmptyState icon="cloud-offline-outline" tone="danger" title={t('career.loadFailed')} description={error} actionLabel={t('common.retry')} onAction={loadForYou} />
          ) : (
            <>
              <View>
                <Text role="h4" weight="bold">{t('career.matchTitle')}</Text>
                {matchTitle ? <Text role="caption" tone="muted">{t('career.matchSubtitle', { title: matchTitle })}</Text> : null}
              </View>
              {matches.length ? matches.map((j) => <JobRow key={j.id} job={j} onPress={openJob} />) : (
                <EmptyState icon="search-outline" title={t('career.noResults')} description={t('career.noResultsBody')} actionLabel={t('career.search')} onAction={() => setMode('search')} />
              )}
            </>
          )}
        </View>
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          <Input
            value={q}
            onChangeText={setQ}
            placeholder={t('career.searchPlaceholder')}
            iconLeft="search-outline"
            returnKeyType="search"
            onSubmitEditing={() => runSearch(1)}
            autoCorrect={false}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.sm }}>
            <Chip label={t('career.remoteOnly')} active={remote} onPress={() => setRemote((r) => !r)} icon="globe-outline" />
            <Chip label={t('career.allCountries')} active={!country} onPress={() => setCountry('')} />
            {countries.map((c) => (
              <Chip key={c.key} label={c.name} active={country === c.key} onPress={() => setCountry(c.key)} />
            ))}
          </ScrollView>

          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            <Text role="caption" tone="muted" flex>{results ? t('career.results', { count: total }) : ''}</Text>
            <Button title={t('career.alerts.create')} size="sm" variant="ghost" onPress={saveAlert}
              iconLeft={<Ionicons name="notifications-outline" size={16} color={theme.colors.primary} />} />
          </View>
          {notice ? <Text role="bodySm" tone="secondary">{notice}</Text> : null}

          {meta && results && !searching ? (
            <View style={{ gap: theme.spacing.xs }}>
              <View style={[styles.row, { gap: theme.spacing.xs }]}>
                <Ionicons name={meta.live ? 'radio' : 'refresh-circle-outline'} size={16} color={meta.live ? theme.colors.danger : theme.colors.textMuted} />
                <Text role="caption" tone={meta.live ? 'primary' : 'muted'} flex accessibilityLiveRegion="polite">
                  {meta.live
                    ? t('career.live.status', { sources: meta.live.sources.length, count: meta.live.count })
                    : t('career.live.auto', { time: meta.checkedAt ? new Date(meta.checkedAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) : '' })}
                </Text>
              </View>
              {meta.query?.translated && (meta.query.searched || meta.query.country) ? (
                <Text role="caption" tone="muted">
                  {t('career.live.searchingFor', {
                    q: [meta.query.searched, meta.query.country ? countryName(meta.query.country, i18n.language) : '', meta.query.remote ? t('career.workplace.remote') : ''].filter(Boolean).join(' · '),
                  })}
                </Text>
              ) : null}
              {meta.relaxed ? <Text role="caption" tone="warning">{t('career.live.relaxed')}</Text> : null}
            </View>
          ) : null}

          {fresh > 0 ? (
            <Button
              title={t('career.live.newJobs', { count: fresh })}
              size="sm"
              onPress={() => runSearch(1)}
              iconLeft={<Ionicons name="arrow-up" size={16} color={theme.colors.onPrimary} />}
            />
          ) : null}

          {results === null || (searching && page === 1 && !results.length) ? (
            <><SkeletonCard /><SkeletonCard /></>
          ) : results.length ? (
            <>
              {results.map((j) => <JobRow key={j.id} job={j} onPress={openJob} />)}
              {results.length < total ? (
                <Button title={t('career.loadMore')} variant="outline" loading={searching} onPress={() => runSearch(page + 1)} />
              ) : null}
            </>
          ) : (
            <EmptyState icon="search-outline" title={t('career.noResults')} description={t('career.noResultsBody')} />
          )}
        </View>
      )}
    </Screen>
  );
}
