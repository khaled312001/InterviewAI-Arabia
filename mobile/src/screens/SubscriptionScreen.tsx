/**
 * SubscriptionScreen — the store.
 *
 * It stopped being a subscription page when metering moved from "5 questions a
 * day" to a balance of interview MINUTES. It now sells two different things
 * that are priced on two different axes:
 *
 *   - a PACK: a one-off purchase of minutes that never expire and stack,
 *   - a SUBSCRIPTION: a monthly allowance of minutes that renews and does not
 *     roll over, plus the premium tracks and the waived flat fees.
 *
 * The yearly plan is gone. It is not hidden behind a flag here — the server no
 * longer returns it from `/payments/config`, and this screen renders whatever
 * that endpoint sends, so there is nothing to remove locally.
 *
 * THE RULE THIS SCREEN EXISTS TO KEEP: no number on it is written in the app.
 * Prices, minute counts, per-minute rates and saving percentages come from
 * `GET /payments/config`; the balance, the trial length and every flat fee come
 * from `GET /user/balance`. The previous build hardcoded the daily limit in
 * three screens and they drifted from the server and from each other. Anything
 * the API has not sent is not rendered at all — a blank row is honest, an
 * invented one is not.
 */

import { ReactNode, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, StyleSheet, Platform, Pressable, Linking, AppState, Keyboard, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MotiView, AnimatePresence } from 'moti';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';

import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { useBalance, formatClock } from '../store/balance';
import { useAppTheme, useResponsive } from '../theme/useTheme';
import {
  Screen, Text, Card, Button, Badge, EmptyState, SectionHeader, Skeleton, Input,
} from '../components';
import { balanceLabel, durationLabel, formatShortDate, minuteCountLabel } from './mainShared';

/* ------------------------------------------------------------------ *
 * API shapes
 * ------------------------------------------------------------------ */

type PlanKind = 'pack' | 'subscription';

/** One entry of `plans` from GET /payments/config — see the backend's
 *  services/payments/plans.js#planList for the authoritative shape. A pack
 *  carries `minutes`, a subscription carries `minutesPerMonth`; both are
 *  optional here because a catalogue change must degrade to "not shown"
 *  rather than to `undefined` on screen. */
interface PlanSpec {
  code: string;
  kind: PlanKind;
  labelAr: string;
  labelEn: string;
  /** Integer piastres. The decimal amount is `amountEgp`. */
  amountCents: number;
  amountEgp: number;
  popular?: boolean;
  pricePerMinuteEgp?: number;

  /** Packs. */
  grantSeconds?: number;
  minutes?: number;
  neverExpires?: boolean;

  /** Subscriptions. */
  days?: number;
  months?: number;
  cycleSeconds?: number;
  minutesPerMonth?: number;
  rollsOver?: boolean;
  savingPct?: number;
  monthlyEquivalentEgp?: number;
}

interface PaymentsConfig {
  provider?: string;
  enabled: boolean;
  mock?: boolean;
  currency: string;
  /** An ARRAY, not a map keyed by plan code. */
  plans: PlanSpec[];
}

interface SubscriptionStatus {
  active: boolean;
  plan: 'free' | 'premium';
  /** Set even when no Subscription row exists (e.g. premium granted by an
   *  admin), so it is the more reliable source for "active until". */
  premiumUntil: string | null;
  subscription: {
    id: string;
    planCode: string;
    status: string;
    startedAt: string;
    expiresAt: string;
    autoRenew: boolean;
  } | null;
}

/** FAQ order — the objection people actually raise first is "do these expire?". */
const FAQ_KEYS = ['expiry', 'counted', 'topup', 'packVsSub', 'payment', 'cancel'] as const;

const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 180_000;

/** Group thousands without depending on Intl (Hermes ships a partial ICU). */
function groupDigits(value: number) {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Money with up to two decimals, trailing zeros trimmed.
 *
 * A per-minute rate is 1.67 EGP and rounding it to 2 turns a real figure into a
 * wrong one — the old `groupDigits`-only helper did exactly that.
 */
function formatAmount(value: number) {
  if (!Number.isFinite(value)) return '';
  if (Number.isInteger(value)) return groupDigits(value);
  const fixed = value.toFixed(2).replace(/\.?0+$/, '');
  const [whole, frac] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

/** `plans` arrives as an array; an object is tolerated only so a backend that
 *  later switches to a keyed map does not blank every price on the paywall. */
function planArray(config: PaymentsConfig | null): PlanSpec[] {
  const raw = config?.plans;
  if (Array.isArray(raw)) return raw;
  return Object.values(raw ?? {}) as PlanSpec[];
}

/* ------------------------------------------------------------------ *
 * Small presentational pieces
 * ------------------------------------------------------------------ */

/** Staggered entrance so the page assembles instead of snapping in. */
function Reveal({ index = 0, children }: { index?: number; children: ReactNode }) {
  const theme = useAppTheme();
  return (
    <MotiView
      from={{ opacity: 0, translateY: 14 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{
        type: 'timing',
        duration: theme.motion.duration.normal,
        delay: index * theme.motion.stagger,
      }}
    >
      {children}
    </MotiView>
  );
}

/**
 * One buyable product.
 *
 * Deliberately the same component for both kinds: a pack and a subscription
 * differ in the lines they carry, not in how they are chosen, and two card
 * components would drift apart the first time the selected state changed.
 */
const PlanCard = memo(function PlanCard({
  name, price, lines, badge, popular, selected, onSelect,
}: {
  name: string;
  price: string;
  lines: string[];
  badge?: string;
  popular?: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const theme = useAppTheme();
  const { t } = useTranslation();

  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={t('subscription.selectPlan', { name })}
      accessibilityHint={price}
      style={({ pressed }) => [
        {
          borderRadius: theme.radii.lg,
          borderWidth: selected ? 1.5 : theme.layout.hairline,
          borderColor: selected ? theme.colors.accentBorder : theme.colors.border,
          backgroundColor: selected ? theme.colors.accentMuted : theme.colors.surface,
          padding: theme.spacing.lg,
          gap: theme.spacing.xs,
          minHeight: theme.layout.touchTarget,
          transform: [{ scale: pressed ? 0.99 : 1 }],
        },
      ]}
    >
      <View style={[styles.rowCenter, { gap: theme.spacing.sm }]}>
        <View
          style={[
            styles.center,
            {
              width: theme.layout.icon.lg,
              height: theme.layout.icon.lg,
              borderRadius: theme.radii.pill,
              borderWidth: 1.5,
              borderColor: selected ? theme.colors.accent : theme.colors.borderStrong,
              backgroundColor: selected ? theme.colors.accent : 'transparent',
            },
          ]}
        >
          {selected ? (
            <Ionicons name="checkmark" size={theme.layout.icon.xs} color={theme.colors.onAccent} />
          ) : null}
        </View>

        <Text role="body" weight="bold" flex numberOfLines={1}>{name}</Text>

        {popular ? <Badge label={t('subscription.popular')} tone="accent" icon="flame" /> : null}
        {badge ? <Badge label={badge} tone="success" /> : null}
      </View>

      <View style={[styles.rowCenter, { gap: theme.spacing.sm }]}>
        <Text role="h3" weight="bold">{price}</Text>
      </View>

      {lines.map((line) => (
        <Text key={line} role="caption" tone="secondary">{line}</Text>
      ))}
    </Pressable>
  );
});

const CompareRow = memo(function CompareRow({
  label, free, pack, sub, last,
}: { label: string; free: string; pack: string; sub: string; last: boolean }) {
  const theme = useAppTheme();

  return (
    <View
      style={[
        styles.tableRow,
        {
          minHeight: theme.layout.touchTarget,
          borderBottomWidth: last ? 0 : theme.layout.hairline,
          borderBottomColor: theme.colors.divider,
        },
      ]}
    >
      <View style={[styles.cellFeature, { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md }]}>
        <Text role="caption">{label}</Text>
      </View>
      <View style={[styles.cell, { paddingHorizontal: theme.spacing.xs, paddingVertical: theme.spacing.md }]}>
        <Text role="micro" tone="muted" align="center">{free}</Text>
      </View>
      <View style={[styles.cell, { paddingHorizontal: theme.spacing.xs, paddingVertical: theme.spacing.md }]}>
        <Text role="micro" tone="muted" align="center">{pack}</Text>
      </View>
      <View
        style={[
          styles.cell,
          {
            paddingHorizontal: theme.spacing.xs,
            paddingVertical: theme.spacing.md,
            backgroundColor: theme.colors.accentMuted,
          },
        ]}
      >
        <Text role="micro" weight="bold" align="center" tone="inherit" style={{ color: theme.colors.accentText }}>
          {sub}
        </Text>
      </View>
    </View>
  );
});

const FaqItem = memo(function FaqItem({
  question, answer, open, onToggle, last,
}: { question: string; answer: string; open: boolean; onToggle: () => void; last: boolean }) {
  const theme = useAppTheme();

  return (
    <View
      style={{
        borderBottomWidth: last ? 0 : theme.layout.hairline,
        borderBottomColor: theme.colors.divider,
      }}
    >
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={question}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [
          styles.faqHead,
          {
            minHeight: theme.layout.touchTarget,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
            gap: theme.spacing.md,
            backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
          },
        ]}
      >
        <Text role="bodySm" weight="bold" flex>{question}</Text>
        <MotiView
          animate={{ rotate: open ? '180deg' : '0deg' }}
          transition={{ type: 'timing', duration: theme.motion.duration.fast }}
        >
          <Ionicons name="chevron-down" size={theme.layout.icon.md} color={theme.colors.textMuted} />
        </MotiView>
      </Pressable>

      <AnimatePresence>
        {open ? (
          <MotiView
            from={{ opacity: 0, translateY: -6 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={{ opacity: 0, translateY: -6 }}
            transition={{ type: 'timing', duration: theme.motion.duration.fast }}
            style={{
              paddingHorizontal: theme.spacing.lg,
              paddingBottom: theme.spacing.lg,
            }}
          >
            <Text role="bodySm" tone="secondary">{answer}</Text>
          </MotiView>
        ) : null}
      </AnimatePresence>
    </View>
  );
});

/** Loading state that mirrors the real page instead of a bare spinner. */
function PricingSkeleton() {
  const theme = useAppTheme();
  return (
    <View style={{ gap: theme.spacing['2xl'], paddingTop: theme.spacing.lg }}>
      <Skeleton height={168} radius={theme.radii.xl} />
      <Skeleton height={96} radius={theme.radii.lg} />
      <View style={{ gap: theme.spacing.sm }}>
        <Skeleton width="45%" height={18} />
        <Skeleton height={116} radius={theme.radii.lg} />
        <Skeleton height={116} radius={theme.radii.lg} />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export function SubscriptionScreen({ navigation }: any) {
  const { t, i18n } = useTranslation();
  const theme = useAppTheme();
  const { maxWidth } = useResponsive();
  const user = useAuth((s) => s.user);
  const refreshMe = useAuth((s) => s.refreshMe);
  const balance = useBalance((s) => s.balance);
  const refreshBalance = useBalance((s) => s.refresh);

  const [config, setConfig] = useState<PaymentsConfig | null>(null);
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  /** Asked for only after the gateway rejects the checkout for a missing one. */
  const [phone, setPhone] = useState('');
  const [phoneRequired, setPhoneRequired] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [awaitingPayment, setAwaitingPayment] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  /** What just landed — the two purchases have different good news. */
  const [justBought, setJustBought] = useState<PlanKind | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartedAt = useRef(0);
  /** The balance the moment checkout opened. A purchase is confirmed by the
   *  minutes ARRIVING, which is true for a pack and a subscription alike. */
  const secondsBeforeCheckout = useRef(0);
  const wasActiveBeforeCheckout = useRef(false);
  const phoneRef = useRef<TextInput>(null);

  /* ---------------------------- data ---------------------------- */

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const [cfg, st] = await Promise.all([
        api.get<PaymentsConfig>('/payments/config'),
        api.get<SubscriptionStatus>('/subscriptions/status').catch(() => null),
        // Also the call that grants the free trial, so opening the store on a
        // brand-new account shows ten minutes rather than zero.
        refreshBalance().catch(() => {}),
      ]);
      setConfig(cfg.data);
      if (st) setStatus(st.data);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [refreshBalance]);

  useEffect(() => { load(); }, [load]);

  const plans = useMemo(() => planArray(config), [config]);
  const packs = useMemo(() => plans.filter((p) => p.kind === 'pack'), [plans]);
  const subs = useMemo(() => plans.filter((p) => p.kind === 'subscription'), [plans]);

  /** Pre-select what the catalogue itself marks popular — the 60-minute pack
   *  today — so the CTA is never a dead button on arrival. */
  useEffect(() => {
    if (selectedCode || plans.length === 0) return;
    const preferred = packs.find((p) => p.popular) ?? packs[0] ?? plans[0];
    if (preferred) setSelectedCode(preferred.code);
  }, [packs, plans, selectedCode]);

  const selected = useMemo(
    () => plans.find((p) => p.code === selectedCode) ?? null,
    [plans, selectedCode],
  );

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /**
   * Did the purchase land?
   *
   * The webhook — not the redirect back — is what credits the account, so this
   * watches for the effect rather than trusting the return trip. Minutes
   * arriving is the signal for both product kinds; the subscription flag is
   * checked too because a renewal can activate before the cycle grant runs.
   */
  const checkPurchase = useCallback(async () => {
    try {
      const [st] = await Promise.all([
        api.get<SubscriptionStatus>('/subscriptions/status').catch(() => null),
        refreshBalance().catch(() => {}),
      ]);
      if (st) setStatus(st.data);

      const now = useBalance.getState().balance?.availableSeconds ?? 0;
      const credited = now > secondsBeforeCheckout.current;
      const activated = !!st?.data.active && !wasActiveBeforeCheckout.current;

      if (credited || activated) {
        stopPolling();
        setAwaitingPayment(false);
        setPollTimedOut(false);
        setJustBought(activated ? 'subscription' : 'pack');
        await refreshMe().catch(() => {});
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [refreshBalance, refreshMe, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    setAwaitingPayment(true);
    setPollTimedOut(false);
    setJustBought(null);
    secondsBeforeCheckout.current = balance?.availableSeconds ?? 0;
    wasActiveBeforeCheckout.current = !!status?.active;
    pollStartedAt.current = Date.now();
    pollRef.current = setInterval(async () => {
      const done = await checkPurchase();
      if (!done && Date.now() - pollStartedAt.current > POLL_TIMEOUT_MS) {
        stopPolling();
        setAwaitingPayment(false);
        setPollTimedOut(true);
      }
    }, POLL_INTERVAL_MS);
  }, [balance?.availableSeconds, checkPurchase, status?.active, stopPolling]);

  useEffect(() => stopPolling, [stopPolling]);

  /**
   * Lift the pinned footer above the keyboard while the phone field is open.
   * Only iOS needs this: Android resizes the window (`adjustResize`) and the
   * web keyboard does not overlay the viewport.
   */
  useEffect(() => {
    if (Platform.OS !== 'ios' || !phoneRequired) return;
    const show = Keyboard.addListener('keyboardWillShow', (e) =>
      setKeyboardInset(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardInset(0));
    return () => { show.remove(); hide.remove(); setKeyboardInset(0); };
  }, [phoneRequired]);

  /** Returning from the payment browser is the highest-signal moment to check. */
  useEffect(() => {
    if (!awaitingPayment) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkPurchase();
    });
    return () => sub.remove();
  }, [awaitingPayment, checkPurchase]);

  /* --------------------------- derived --------------------------- */

  const isPremium = balance?.plan === 'premium' || status?.active || user?.plan === 'premium';
  const paymentsEnabled = !!config?.enabled;
  const costs = balance?.costs ?? null;

  const currencyLabel = useMemo(
    () => t(`subscription.currency.${config?.currency ?? 'EGP'}`, { defaultValue: config?.currency ?? '' }),
    [t, config?.currency],
  );

  const money = useCallback(
    (amount: number) => `${formatAmount(amount)} ${currencyLabel}`.trim(),
    [currencyLabel],
  );

  const planName = useCallback(
    (plan: PlanSpec) => (i18n.language.startsWith('ar') ? plan.labelAr : plan.labelEn) || plan.code,
    [i18n.language],
  );

  const expiryDate = useMemo(() => {
    // Premium can be granted without a Subscription row, in which case only
    // `premiumUntil` carries the date — reading the row alone hid the expiry.
    const raw = status?.subscription?.expiresAt ?? status?.premiumUntil;
    return formatShortDate(raw, i18n.language);
  }, [status?.subscription?.expiresAt, status?.premiumUntil, i18n.language]);

  /* --------------------------- actions --------------------------- */

  const onToggleFaq = useCallback((key: string) => {
    setOpenFaq((prev) => (prev === key ? null : key));
  }, []);

  const onCheckout = useCallback(async () => {
    if (!paymentsEnabled || checkingOut || !selected) return;

    // Matches the server's own rule (min 8 chars) rather than guessing a
    // stricter Egyptian format the gateway may well accept.
    const digits = phone.replace(/\D/g, '');
    if (phoneRequired && digits.length < 8) {
      setPhoneError(t('subscription.phoneInvalid'));
      phoneRef.current?.focus();
      return;
    }

    setCheckingOut(true);
    setCheckoutError(null);
    setPhoneError(null);
    try {
      const { data } = await api.post('/payments/checkout', {
        plan: selected.code,
        ...(digits ? { phone: digits } : null),
      });
      // EasyKash returns a hosted-checkout `redirectUrl`; `iframeUrl` is
      // tolerated so a gateway swap does not dead-end the button.
      const url: string | undefined = data?.redirectUrl ?? data?.iframeUrl;
      if (!url) throw new Error('missing redirect url');

      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined') window.location.assign(url);
      } else {
        await Linking.openURL(url);
      }
      startPolling();
    } catch (err: any) {
      // The gateway requires a mobile number and we never collect one at
      // sign-up, so this is the *expected* first response for most users.
      // Reveal the field and ask, instead of dead-ending on the server's
      // bilingual error string.
      if (err?.response?.status === 400 && err?.response?.data?.details?.field === 'phone') {
        setPhoneRequired(true);
        setPhoneError(t('subscription.phoneRequired'));
        // The field only mounts on this state change — focus on the next frame.
        requestAnimationFrame(() => phoneRef.current?.focus());
        return;
      }
      setCheckoutError(err?.response?.data?.error || t('subscription.checkoutError'));
    } finally {
      setCheckingOut(false);
    }
  }, [paymentsEnabled, checkingOut, selected, phone, phoneRequired, startPolling, t]);

  const onChangePhone = useCallback((value: string) => {
    setPhone(value);
    setPhoneError(null);
  }, []);

  /* ---------------------------- render ---------------------------- */

  const ctaLabel = !paymentsEnabled
    ? t('subscription.ctaSoon')
    : checkingOut
      ? t('subscription.ctaRedirecting')
      : !selected
        ? t('subscription.ctaPickPlan')
        : selected.kind === 'pack'
          ? t('subscription.ctaBuy', { price: money(selected.amountEgp) })
          : isPremium
            ? t('subscription.ctaRenew', { price: money(selected.amountEgp) })
            : t('subscription.ctaSubscribe', { price: money(selected.amountEgp) });

  const footer = loading || loadFailed ? null : (
    <View
      style={[
        styles.footer,
        {
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.spacing.md,
          marginBottom: keyboardInset,
          borderTopWidth: theme.layout.hairline,
          borderTopColor: theme.colors.border,
          backgroundColor: theme.colors.bgElevated,
        },
        theme.shadow.lg,
      ]}
    >
      <View style={[styles.footerInner, maxWidth ? { maxWidth } : null, { gap: theme.spacing.sm }]}>
        {phoneRequired ? (
          <Input
            ref={phoneRef}
            label={t('subscription.phoneLabel')}
            placeholder={t('subscription.phonePlaceholder')}
            helperText={t('subscription.phoneHint')}
            error={phoneError ?? undefined}
            value={phone}
            onChangeText={onChangePhone}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            iconLeft="call-outline"
            returnKeyType="go"
            onSubmitEditing={onCheckout}
            required
          />
        ) : null}

        {checkoutError ? (
          <View style={[styles.inlineNotice, { gap: theme.spacing.sm }]}>
            <Ionicons name="alert-circle" size={theme.layout.icon.md} color={theme.colors.danger} />
            <Text role="caption" tone="danger" flex>{checkoutError}</Text>
          </View>
        ) : null}

        <Button
          title={ctaLabel}
          onPress={onCheckout}
          variant="accent"
          size="lg"
          loading={checkingOut}
          disabled={!paymentsEnabled || !selected}
          accessibilityLabel={ctaLabel}
          accessibilityHint={t('subscription.footerNote')}
          iconLeft={
            !checkingOut && paymentsEnabled
              ? <Ionicons name="lock-closed" size={theme.layout.icon.sm} color={theme.colors.onAccent} />
              : null
          }
        />
        <Text role="micro" tone="muted" align="center">{t('subscription.footerNote')}</Text>
      </View>
    </View>
  );

  if (loading) {
    return (
      <Screen scroll edges={['bottom']} testID="subscription-loading">
        <PricingSkeleton />
      </Screen>
    );
  }

  if (loadFailed) {
    return (
      <Screen edges={['bottom']} testID="subscription-error">
        <View style={styles.centered}>
          <EmptyState
            icon="cloud-offline-outline"
            title={t('subscription.errorTitle')}
            description={t('subscription.errorBody')}
            actionLabel={t('common.retry')}
            onAction={() => { setLoading(true); load(); }}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll edges={['bottom']} footer={footer} testID="subscription">
      {/* ---------------------------- Hero ---------------------------- */}
      <Reveal index={0}>
        <LinearGradient
          colors={[...theme.gradients.hero]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.hero,
            {
              borderRadius: theme.radii.xl,
              padding: theme.spacing.xl,
              marginTop: theme.spacing.lg,
              gap: theme.spacing.md,
            },
            theme.shadow.lg,
          ]}
        >
          <Badge label={t('subscription.heroBadge')} tone="accent" size="md" icon="time" />

          <Text role="h2" weight="bold" tone="onBrand">{t('subscription.heroTitle')}</Text>
          <Text role="bodySm" tone="onBrand" style={styles.heroSubtitle}>
            {t('subscription.heroSubtitle')}
          </Text>

          <View style={[styles.heroTrust, { gap: theme.spacing.md, marginTop: theme.spacing.xs }]}>
            {[
              { icon: 'shield-checkmark' as const, label: t('subscription.trustSecure') },
              { icon: 'card-outline' as const, label: t('subscription.trustNoCard') },
              { icon: 'infinite-outline' as const, label: t('subscription.trustNoExpiry') },
            ].map((item) => (
              <View key={item.label} style={[styles.heroTrustItem, { gap: theme.spacing.xs }]}>
                <Ionicons name={item.icon} size={theme.layout.icon.xs} color={theme.colors.textOnBrand} />
                <Text role="micro" tone="onBrand" style={styles.heroSubtitle}>{item.label}</Text>
              </View>
            ))}
          </View>
        </LinearGradient>
      </Reveal>

      {/* --------------------------- Balance --------------------------- */}
      <Reveal index={1}>
        <Card variant="elevated" padding="lg" style={{ marginTop: theme.spacing.lg, gap: theme.spacing.xs }}>
          <Text role="caption" tone="muted">{t('subscription.balanceTitle')}</Text>
          {balance ? (
            <>
              <Text role="display" weight="bold">
                {balanceLabel(balance.availableSeconds, t)}
              </Text>
              <Text role="caption" tone="muted">
                {balance.availableSeconds > 0
                  ? t('subscription.balanceExact', { clock: formatClock(balance.availableSeconds) })
                  : t('subscription.balanceEmpty')}
              </Text>
              {balance.subSeconds > 0 && balance.subExpiresAt ? (
                <Text role="caption" tone="secondary">
                  {t('subscription.balanceSubPart', {
                    label: minuteCountLabel(Math.floor(balance.subSeconds / 60), t),
                    date: formatShortDate(balance.subExpiresAt, i18n.language),
                  })}
                </Text>
              ) : null}

              {/* The statement is reachable from the number it explains. The
                  published terms tell the user to check consumption here
                  before asking for a refund, so it cannot be buried. */}
              <Pressable
                onPress={() => navigation.navigate('Ledger')}
                accessibilityRole="button"
                accessibilityLabel={t('ledger.title')}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.xs,
                  minHeight: theme.layout.touchTarget,
                }}
              >
                <Ionicons name="receipt-outline" size={16} color={theme.colors.primary} />
                <Text role="bodySm" weight="bold" tone="primary">{t('ledger.title')}</Text>
              </Pressable>
            </>
          ) : (
            <Text role="bodySm" tone="muted">{t('subscription.balanceLoading')}</Text>
          )}
        </Card>
      </Reveal>

      {/* ---------------- Purchase landed / active plan ---------------- */}
      {justBought ? (
        <Reveal index={2}>
          <Card
            variant="outlined"
            padding="md"
            style={{
              marginTop: theme.spacing.lg,
              backgroundColor: theme.colors.successMuted,
              borderColor: theme.colors.success,
            }}
          >
            <View style={[styles.rowCenter, { gap: theme.spacing.md }]}>
              <Ionicons name="checkmark-circle" size={theme.layout.icon.xl} color={theme.colors.success} />
              <View style={styles.flex}>
                <Text role="h4" weight="bold" tone="success">
                  {t(justBought === 'subscription' ? 'subscription.activatedTitle' : 'subscription.creditedTitle')}
                </Text>
                <Text role="caption" tone="secondary" style={{ marginTop: theme.spacing.xxs }}>
                  {justBought === 'subscription'
                    ? t('subscription.activatedBody')
                    : t('subscription.creditedBody', {
                      label: balanceLabel(balance?.availableSeconds ?? 0, t),
                    })}
                </Text>
              </View>
            </View>
          </Card>
        </Reveal>
      ) : isPremium ? (
        <Reveal index={2}>
          <Card variant="filled" padding="md" style={{ marginTop: theme.spacing.lg }}>
            <View style={[styles.rowCenter, { gap: theme.spacing.md }]}>
              <Ionicons name="star" size={theme.layout.icon.xl} color={theme.colors.accent} />
              <View style={styles.flex}>
                <Text role="h4" weight="bold">{t('subscription.activeTitle')}</Text>
                {expiryDate ? (
                  <Text role="caption" tone="muted" style={{ marginTop: theme.spacing.xxs }}>
                    {t('subscription.activeUntil', { date: expiryDate })}
                  </Text>
                ) : null}
              </View>
            </View>
            <Text role="caption" tone="secondary" style={{ marginTop: theme.spacing.sm }}>
              {t('subscription.activeBody')}
            </Text>
          </Card>
        </Reveal>
      ) : null}

      {/* ------------------------ Pending payment ------------------------ */}
      {awaitingPayment || pollTimedOut ? (
        <Reveal index={2}>
          <Card
            variant="outlined"
            padding="md"
            style={{
              marginTop: theme.spacing.lg,
              backgroundColor: theme.colors.warningMuted,
              borderColor: theme.colors.warning,
            }}
          >
            <View style={[styles.rowCenter, { gap: theme.spacing.md }]}>
              <MotiView
                from={{ opacity: 0.4 }}
                animate={{ opacity: 1 }}
                transition={{
                  type: 'timing',
                  duration: theme.motion.duration.deliberate,
                  loop: !pollTimedOut,
                  repeatReverse: true,
                }}
              >
                <Ionicons
                  name={pollTimedOut ? 'help-circle' : 'hourglass-outline'}
                  size={theme.layout.icon.xl}
                  color={theme.colors.warning}
                />
              </MotiView>
              <View style={styles.flex}>
                <Text role="h4" weight="bold">{t('subscription.pendingTitle')}</Text>
                <Text role="caption" tone="secondary" style={{ marginTop: theme.spacing.xxs }}>
                  {pollTimedOut ? t('subscription.pendingTimeout') : t('subscription.pendingBody')}
                </Text>
              </View>
            </View>
            <Button
              title={t('subscription.pendingCheck')}
              onPress={() => { void checkPurchase(); }}
              variant="outline"
              size="sm"
              fullWidth={false}
              style={{ marginTop: theme.spacing.md }}
              accessibilityLabel={t('subscription.pendingCheck')}
            />
          </Card>
        </Reveal>
      ) : null}

      {/* ------------------------ Payments disabled ---------------------- */}
      {!paymentsEnabled ? (
        <Reveal index={2}>
          <Card
            variant="outlined"
            padding="md"
            style={{
              marginTop: theme.spacing.lg,
              backgroundColor: theme.colors.warningMuted,
              borderColor: theme.colors.warning,
            }}
          >
            <View style={[styles.rowCenter, { gap: theme.spacing.md }]}>
              <Ionicons name="construct-outline" size={theme.layout.icon.xl} color={theme.colors.warning} />
              <View style={styles.flex}>
                <Text role="h4" weight="bold">{t('subscription.disabledTitle')}</Text>
                <Text role="caption" tone="secondary" style={{ marginTop: theme.spacing.xxs }}>
                  {t('subscription.disabledBody')}
                </Text>
              </View>
            </View>
            <Button
              title={t('subscription.ctaMaybeLater')}
              onPress={() => navigation?.goBack?.()}
              variant="ghost"
              size="sm"
              fullWidth={false}
              style={{ marginTop: theme.spacing.sm }}
              accessibilityLabel={t('subscription.ctaMaybeLater')}
            />
          </Card>
        </Reveal>
      ) : null}

      {/* ----------------------------- Packs ----------------------------- */}
      {packs.length ? (
        <Reveal index={3}>
          <View style={{ marginTop: theme.spacing['2xl'] }}>
            <SectionHeader
              title={t('subscription.packsTitle')}
              subtitle={t('subscription.packsSubtitle')}
            />
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={t('subscription.packsTitle')}
              style={{ gap: theme.spacing.sm }}
            >
              {packs.map((plan) => (
                <PlanCard
                  key={plan.code}
                  name={planName(plan)}
                  price={money(plan.amountEgp)}
                  popular={plan.popular}
                  selected={selectedCode === plan.code}
                  onSelect={() => setSelectedCode(plan.code)}
                  lines={[
                    // Only what the catalogue actually sent. A pack with no
                    // `minutes` renders without the line rather than with a
                    // guess.
                    typeof plan.minutes === 'number'
                      ? minuteCountLabel(plan.minutes, t) : null,
                    typeof plan.pricePerMinuteEgp === 'number'
                      ? t('subscription.perMinute', { amount: money(plan.pricePerMinuteEgp) }) : null,
                    plan.neverExpires ? t('subscription.neverExpires') : null,
                  ].filter(Boolean) as string[]}
                />
              ))}
            </View>
          </View>
        </Reveal>
      ) : null}

      {/* ------------------------- Subscriptions ------------------------- */}
      {subs.length ? (
        <Reveal index={4}>
          <View style={{ marginTop: theme.spacing['2xl'] }}>
            <SectionHeader
              title={t('subscription.subsTitle')}
              subtitle={t('subscription.subsSubtitle')}
            />
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={t('subscription.subsTitle')}
              style={{ gap: theme.spacing.sm }}
            >
              {subs.map((plan) => (
                <PlanCard
                  key={plan.code}
                  name={planName(plan)}
                  price={money(plan.amountEgp)}
                  badge={plan.savingPct ? t('subscription.saveBadge', { percent: plan.savingPct }) : undefined}
                  selected={selectedCode === plan.code}
                  onSelect={() => setSelectedCode(plan.code)}
                  lines={[
                    typeof plan.minutesPerMonth === 'number'
                      ? t('subscription.minutesPerMonth', {
                        label: minuteCountLabel(plan.minutesPerMonth, t),
                      })
                      : null,
                    typeof plan.monthlyEquivalentEgp === 'number' && (plan.months ?? 1) > 1
                      ? t('subscription.monthlyEquivalent', { amount: money(plan.monthlyEquivalentEgp) })
                      : null,
                    plan.rollsOver === false ? t('subscription.noRollover') : null,
                    t('subscription.subPerks'),
                  ].filter(Boolean) as string[]}
                />
              ))}
            </View>
          </View>
        </Reveal>
      ) : null}

      {/* --------------------- How minutes are counted -------------------- *
       *
       * Rendered only when the server has actually sent the flat fees. A
       * pricing explainer with a blank in it is worse than no explainer.
       * ------------------------------------------------------------------ */}
      {costs ? (
        <Reveal index={5}>
          <View style={{ marginTop: theme.spacing['2xl'] }}>
            <SectionHeader
              title={t('subscription.costsTitle')}
              subtitle={t('subscription.costsSubtitle')}
            />
            <Card variant="outlined" padding="lg" style={{ gap: theme.spacing.sm }}>
              {[
                { icon: 'timer-outline' as const, text: t('subscription.costMeeting') },
                { icon: 'cloud-offline-outline' as const, text: t('subscription.costSkipped') },
                {
                  icon: 'help-circle-outline' as const,
                  text: costs.minTurnSeconds > 0
                    ? t('subscription.costTurnFloor', { label: durationLabel(costs.minTurnSeconds, t) })
                    : `${t('subscription.rowFloor')}: ${t('subscription.cellNoFloor')}`,
                },
                {
                  icon: 'create-outline' as const,
                  text: costs.practiceAnswerSeconds > 0
                    ? t('subscription.costPractice', { label: durationLabel(costs.practiceAnswerSeconds, t) })
                    : `${t('subscription.rowPractice')}: ${t('subscription.costFree')}`,
                },
                {
                  icon: 'document-text-outline' as const,
                  text: costs.cvAnalysisSeconds > 0
                    ? t('subscription.costCv', { label: durationLabel(costs.cvAnalysisSeconds, t) })
                    : `${t('subscription.rowCv')}: ${t('subscription.costFree')}`,
                },
                { icon: 'gift-outline' as const, text: t('subscription.costEval') },
              ].map((row) => (
                <View key={row.text} style={[styles.costRow, { gap: theme.spacing.sm }]}>
                  <Ionicons name={row.icon} size={theme.layout.icon.md} color={theme.colors.textMuted} />
                  <Text role="bodySm" tone="secondary" flex>{row.text}</Text>
                </View>
              ))}
            </Card>
          </View>
        </Reveal>
      ) : null}

      {/* --------------------------- Comparison --------------------------- */}
      {costs && balance ? (
        <Reveal index={6}>
          <View style={{ marginTop: theme.spacing['2xl'] }}>
            <SectionHeader
              title={t('subscription.compareTitle')}
              subtitle={t('subscription.compareSubtitle')}
            />

            <Card variant="outlined" padding="none">
              <View
                style={[
                  styles.tableRow,
                  {
                    borderBottomWidth: theme.layout.hairline,
                    borderBottomColor: theme.colors.border,
                    backgroundColor: theme.colors.surfaceAlt,
                  },
                ]}
              >
                <View style={[styles.cellFeature, { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm }]}>
                  <Text role="micro" weight="bold" tone="muted">{t('subscription.colFeature')}</Text>
                </View>
                <View style={[styles.cell, { paddingVertical: theme.spacing.sm }]}>
                  <Text role="micro" weight="bold" tone="muted" align="center">{t('subscription.colFree')}</Text>
                </View>
                <View style={[styles.cell, { paddingVertical: theme.spacing.sm }]}>
                  <Text role="micro" weight="bold" tone="muted" align="center">{t('subscription.colPack')}</Text>
                </View>
                <View
                  style={[
                    styles.cell,
                    { paddingVertical: theme.spacing.sm, backgroundColor: theme.colors.accentMuted },
                  ]}
                >
                  <Text role="micro" weight="bold" align="center" tone="inherit" style={{ color: theme.colors.accentText }}>
                    {t('subscription.colSub')}
                  </Text>
                </View>
              </View>

              <CompareRow
                label={t('subscription.rowMinutes')}
                free={balance.trialSeconds > 0 ? durationLabel(balance.trialSeconds, t) : t('subscription.cellNone')}
                pack={t('subscription.cellPerPack')}
                sub={subs[0]?.minutesPerMonth
                  ? t('subscription.cellPerMonth', {
                    label: minuteCountLabel(subs[0].minutesPerMonth as number, t),
                  })
                  : t('subscription.cellIncluded')}
                last={false}
              />
              <CompareRow
                label={t('subscription.rowExpiry')}
                free={t('subscription.cellNever')}
                pack={t('subscription.cellNever')}
                sub={t('subscription.cellMonthly')}
                last={false}
              />
              <CompareRow
                label={t('subscription.rowTracks')}
                free={t('subscription.cellNone')}
                pack={t('subscription.cellNone')}
                sub={t('subscription.cellIncluded')}
                last={false}
              />
              <CompareRow
                label={t('subscription.rowCv')}
                free={durationLabel(costs.cvAnalysisSeconds, t)}
                pack={durationLabel(costs.cvAnalysisSeconds, t)}
                sub={t('subscription.costFree')}
                last={false}
              />
              <CompareRow
                label={t('subscription.rowPractice')}
                free={durationLabel(costs.practiceAnswerSeconds, t)}
                pack={durationLabel(costs.practiceAnswerSeconds, t)}
                sub={t('subscription.costFree')}
                last={false}
              />
              <CompareRow
                label={t('subscription.rowFloor')}
                free={durationLabel(costs.minTurnSeconds, t)}
                pack={durationLabel(costs.minTurnSeconds, t)}
                sub={t('subscription.cellNoFloor')}
                last
              />
            </Card>
          </View>
        </Reveal>
      ) : null}

      {/* ------------------------------- FAQ ------------------------------- */}
      <Reveal index={7}>
        <View style={{ marginTop: theme.spacing['2xl'] }}>
          <SectionHeader title={t('subscription.faqTitle')} />
          <Card variant="outlined" padding="none">
            {FAQ_KEYS.map((key, i) => (
              <FaqItem
                key={key}
                question={t(`subscription.faq.${key}.q`)}
                answer={t(`subscription.faq.${key}.a`)}
                open={openFaq === key}
                onToggle={() => onToggleFaq(key)}
                last={i === FAQ_KEYS.length - 1}
              />
            ))}
          </Card>
        </View>
      </Reveal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },

  hero: { overflow: 'hidden' },
  // The onBrand ink is pure white; secondary hero copy needs it a shade softer
  // and the token set has no "on-brand muted" role.
  heroSubtitle: { opacity: 0.86 },
  heroTrust: { flexDirection: 'row', flexWrap: 'wrap' },
  heroTrustItem: { flexDirection: 'row', alignItems: 'center' },

  costRow: { flexDirection: 'row', alignItems: 'flex-start' },

  tableRow: { flexDirection: 'row', alignItems: 'stretch' },
  cellFeature: { flex: 1.6, justifyContent: 'center' },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  faqHead: { flexDirection: 'row', alignItems: 'center' },

  footer: { width: '100%' },
  footerInner: { width: '100%', alignSelf: 'center' },
  inlineNotice: { flexDirection: 'row', alignItems: 'center' },
});
