/**
 * The minute statement — every credit and debit against the balance.
 *
 * WHY THIS SCREEN EXISTS. The product bills time, and a balance that only shows
 * a single number turns every "where did my minutes go?" into an argument the
 * user cannot check and support cannot settle. The server already keeps an
 * append-only `time_ledger` for exactly this reason; this is its only user-
 * facing reader. The published terms send the user here to check consumption
 * before requesting a refund, which makes accuracy a contractual property of
 * this screen and not a nicety.
 *
 * EVERY ROW IS mm:ss, NEVER WHOLE MINUTES. `GET /user/ledger` returns both
 * `seconds` (exact) and `minutes` (floored), and rendering the floored one
 * would break the statement's one job: twenty 1m59s interviews each render as
 * "1 minute" — 20 accounted for while 40 were actually taken. Flooring a
 * balance errs in the user's favour; flooring a list of debits understates what
 * was taken twenty times over. So `seconds` is what is shown, and
 * `balanceAfterSeconds` is shown beside it so any row can be reconciled against
 * the one below it.
 *
 * Pagination is keyset (`before=<id>`), not offset: the ledger is append-only
 * and unbounded, and an OFFSET page shifts rows under the reader the moment a
 * new entry lands mid-scroll.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, FlatList, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { api } from '../api/client';
import { useAppTheme } from '../theme/useTheme';
import {
  Screen, Text, Card, Badge, EmptyState, SkeletonRow,
} from '../components';
import {
  formatClock, minutesOf, type BalanceSnapshot, useBalance,
} from '../store/balance';
import { minuteCountLabel, relativeTime } from './mainShared';

const PAGE_SIZE = 25;

/** The `kind` column of `time_ledger`, verbatim. */
type LedgerKind =
  | 'trial_grant' | 'purchase' | 'subscription_grant' | 'promo_grant'
  | 'admin_grant' | 'consumption' | 'refund' | 'expiry' | 'adjustment';

interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  bucket: 'perpetual' | 'subscription';
  /** Signed and exact. Positive credits, negative debits. */
  seconds: number;
  /** Floored, and deliberately unused — see the note at the top of this file. */
  minutes: number;
  balanceAfterSeconds: number;
  meetingSessionId: string | null;
  paymentId: string | null;
  note: string | null;
  createdAt: string;
}

interface LedgerResponse {
  entries: LedgerEntry[];
  balance: BalanceSnapshot;
  nextBefore: string | null;
}

/** Icon per movement type. Credits point in, debits point out. */
const ICONS: Record<LedgerKind, keyof typeof Ionicons.glyphMap> = {
  trial_grant: 'gift-outline',
  purchase: 'card-outline',
  subscription_grant: 'refresh-circle-outline',
  promo_grant: 'pricetag-outline',
  admin_grant: 'person-add-outline',
  consumption: 'mic-outline',
  refund: 'return-up-back-outline',
  expiry: 'time-outline',
  adjustment: 'build-outline',
};

/* ------------------------------------------------------------------ *
 * One movement
 * ------------------------------------------------------------------ */

const Row = React.memo(function Row({ entry }: { entry: LedgerEntry }) {
  const theme = useAppTheme();
  const { t } = useTranslation();

  const credit = entry.seconds >= 0;
  const tone = credit ? theme.colors.success : theme.colors.text;

  return (
    <Card style={styles.row}>
      <View
        style={[
          styles.icon,
          {
            borderRadius: theme.radii.pill,
            backgroundColor: credit ? theme.colors.successMuted : theme.colors.surfaceAlt,
          },
        ]}
      >
        <Ionicons
          name={ICONS[entry.kind] ?? 'ellipse-outline'}
          size={18}
          color={credit ? theme.colors.success : theme.colors.textSecondary}
        />
      </View>

      <View style={styles.rowBody}>
        <Text role="bodySm" weight="bold" numberOfLines={1}>
          {t(`ledger.kind.${entry.kind}`, { defaultValue: entry.kind })}
        </Text>
        <Text role="caption" tone="secondary" numberOfLines={1}>
          {[
            relativeTime(entry.createdAt, t),
            entry.meetingSessionId
              ? t('ledger.meetingRef', { id: entry.meetingSessionId })
              : null,
          ].filter(Boolean).join(' · ')}
        </Text>
        <Text role="caption" tone="secondary">
          {t('ledger.runningBalance', { clock: formatClock(entry.balanceAfterSeconds) })}
        </Text>
      </View>

      <View style={styles.rowAmount}>
        {/* The sign is a real character, not colour alone: colour is not
            available to every reader and this is a financial figure. */}
        <Text role="body" weight="bold" style={{ color: tone }}>
          {credit ? '+' : '−'}{formatClock(Math.abs(entry.seconds))}
        </Text>
        {entry.bucket === 'subscription' && (
          <Badge tone="primary" size="sm" label={t('ledger.bucket.subscription')} />
        )}
      </View>
    </Card>
  );
});

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export function LedgerScreen() {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const applyBalance = useBalance((s) => s.apply);

  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [balance, setBalance] = useState<BalanceSnapshot | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (before?: string) => {
    try {
      const { data } = await api.get<LedgerResponse>('/user/ledger', {
        params: { limit: PAGE_SIZE, ...(before ? { before } : {}) },
      });
      setEntries((prev) => (before ? [...prev, ...data.entries] : data.entries));
      setBalance(data.balance);
      setNextBefore(data.nextBefore);
      // The response already carries a fresh snapshot, so the shared store is
      // updated from it rather than costing a second GET on the way back.
      applyBalance(data.balance);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [applyBalance]);

  useEffect(() => {
    (async () => { await load(); setLoading(false); })();
  }, [load]);

  // A meeting started from another tab spends against the same balance, so the
  // statement is re-read whenever this screen comes back into view.
  useFocusEffect(useCallback(() => {
    if (!loading) load();
  }, [load, loading]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onEndReached = useCallback(async () => {
    if (!nextBefore || paging) return;
    setPaging(true);
    await load(nextBefore);
    setPaging(false);
  }, [nextBefore, paging, load]);

  const header = (
    <Card style={styles.summary}>
      <Text role="caption" tone="secondary">{t('ledger.balanceTitle')}</Text>
      <Text role="display" weight="bold">
        {minuteCountLabel(minutesOf(balance?.availableSeconds), t)}
      </Text>
      <Text role="caption" tone="secondary">
        {t('ledger.balanceExact', { clock: formatClock(balance?.availableSeconds) })}
      </Text>

      {/* Held seconds are the difference between "your balance" and "what you
          can start an interview with" — unexplained, it reads as missing time. */}
      {!!balance?.heldSeconds && (
        <Text role="caption" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
          {t('ledger.heldNote', { clock: formatClock(balance.heldSeconds) })}
        </Text>
      )}

      {!!balance?.subSeconds && !!balance?.subExpiresAt && (
        <Text role="caption" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
          {t('ledger.subNote', {
            label: minuteCountLabel(minutesOf(balance.subSeconds), t),
            date: new Date(balance.subExpiresAt).toLocaleDateString(),
          })}
        </Text>
      )}
    </Card>
  );

  if (loading) {
    return (
      <Screen scroll>
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </Screen>
    );
  }

  if (failed && !entries.length) {
    return (
      <Screen>
        <EmptyState
          icon="cloud-offline-outline"
          tone="danger"
          title={t('ledger.failed')}
          actionLabel={t('ledger.retry')}
          onAction={onRefresh}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        renderItem={({ item }) => <Row entry={item} />}
        ListHeaderComponent={header}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          <EmptyState
            icon="receipt-outline"
            title={t('ledger.empty')}
            description={t('ledger.emptyBody')}
          />
        }
        ListFooterComponent={
          nextBefore ? (
            <Pressable
              onPress={onEndReached}
              accessibilityRole="button"
              style={[styles.more, { minHeight: theme.layout.touchTarget }]}
            >
              <Text role="bodySm" weight="bold" tone="primary">
                {t('ledger.loadMore')}
              </Text>
            </Pressable>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: theme.spacing.xl }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { gap: 2, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  icon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: 1 },
  rowAmount: { alignItems: 'flex-end', gap: 4 },
  more: { alignItems: 'center', justifyContent: 'center' },
});
