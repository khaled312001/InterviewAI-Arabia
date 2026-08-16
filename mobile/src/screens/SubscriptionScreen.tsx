/**
 * SubscriptionScreen — the screen that makes money.
 *
 * Treated as a real pricing page rather than a settings row: one dominant
 * decision (monthly vs yearly), a concrete free-vs-premium comparison instead
 * of adjectives, social proof, an FAQ that kills the common objections, and a
 * CTA that is always on screen.
 *
 * Prices are never hardcoded — they come from GET /payments/config so the
 * product owner can change them server-side without shipping an app update.
 * When `enabled` is false the page still sells, but the CTA degrades into an
 * honest "not yet" instead of a button that throws a 503.
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
import { useAppTheme, useResponsive } from '../theme/useTheme';
import {
  Screen, Text, Card, Button, Badge, EmptyState, SectionHeader, Skeleton, Input,
} from '../components';

/* ------------------------------------------------------------------ *
 * API shapes
 * ------------------------------------------------------------------ */

/** The two billing periods this screen sells. The catalogue also carries a
 *  `quarterly` plan; it is deliberately not offered here to keep the decision
 *  binary — `planFor()` looks plans up by code, so adding it is a one-liner. */
type PlanKey = 'monthly' | 'yearly';

/** One entry of `plans` from GET /payments/config — see the backend's
 *  services/payments/plans.js#planList for the authoritative shape. */
interface PlanSpec {
  code: string;
  labelAr: string;
  labelEn: string;
  /** Integer piastres. The decimal amount is `amountEgp`. */
  amountCents: number;
  amountEgp: number;
  days: number;
  popular: boolean;
  savingPct: number;
  monthlyEquivalentEgp: number;
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

/** Rows of the comparison table. Copy lives in i18n, order lives here. */
const BENEFIT_KEYS = [
  'questions', 'tracks', 'feedback', 'live', 'cv', 'history', 'support',
] as const;

/** FAQ order — most common objection first. */
const FAQ_KEYS = ['cancel', 'difference', 'payment', 'activation', 'arabic'] as const;

const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 180_000;

/** Group thousands without depending on Intl (Hermes ships a partial ICU). */
function groupDigits(value: number) {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Index the plan catalogue by code.
 *
 * `plans` arrives as an array. It is tolerated as an object here only so a
 * backend that later switches to a keyed map does not blank out every price on
 * the paywall before the app ships an update.
 */
function planFor(config: PaymentsConfig | null, code: PlanKey): PlanSpec | undefined {
  const raw = config?.plans;
  const list: PlanSpec[] = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  return list.find((p) => p?.code === code);
}

/** Decimal EGP for a plan, falling back to the minor-unit field. */
function priceOf(plan: PlanSpec | undefined) {
  if (!plan) return 0;
  if (typeof plan.amountEgp === 'number') return plan.amountEgp;
  if (typeof plan.amountCents === 'number') return plan.amountCents / 100;
  return 0;
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

const BenefitRow = memo(function BenefitRow({
  label, free, premium, last,
}: { label: string; free: string; premium: string; last: boolean }) {
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
      <View style={[styles.cellFeature, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md }]}>
        <Text role="bodySm">{label}</Text>
      </View>

      <View style={[styles.cell, { paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.md }]}>
        <Text role="caption" tone="muted" align="center">{free}</Text>
      </View>

      <View
        style={[
          styles.cell,
          {
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: theme.spacing.md,
            backgroundColor: theme.colors.accentMuted,
          },
        ]}
      >
        <Text role="caption" weight="bold" align="center" tone="inherit" style={{ color: theme.colors.accentText }}>
          {premium}
        </Text>
      </View>
    </View>
  );
});

const StatTile = memo(function StatTile({ value, label }: { value: string; label: string }) {
  const theme = useAppTheme();
  return (
    <View style={[styles.statTile, { gap: theme.spacing.xxs }]}>
      <Text role="h3" weight="bold" align="center" tone="primary">{value}</Text>
      <Text role="micro" tone="muted" align="center">{label}</Text>
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
      <View style={{ gap: theme.spacing.md }}>
        <Skeleton height={theme.layout.control.md} radius={theme.radii.pill} />
        <Skeleton height={196} radius={theme.radii.lg} />
      </View>
      <View style={{ gap: theme.spacing.sm }}>
        <Skeleton width="45%" height={18} />
        <Skeleton height={theme.layout.control.md} radius={theme.radii.lg} />
        <Skeleton height={theme.layout.control.md} radius={theme.radii.lg} />
        <Skeleton height={theme.layout.control.md} radius={theme.radii.lg} />
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

  const [config, setConfig] = useState<PaymentsConfig | null>(null);
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [plan, setPlan] = useState<PlanKey>('yearly');
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
  const [justActivated, setJustActivated] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartedAt = useRef(0);
  const phoneRef = useRef<TextInput>(null);

  /* ---------------------------- data ---------------------------- */

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const [cfg, st] = await Promise.all([
        api.get<PaymentsConfig>('/payments/config'),
        api.get<SubscriptionStatus>('/subscriptions/status').catch(() => null),
      ]);
      setConfig(cfg.data);
      if (st) setStatus(st.data);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const { data } = await api.get<SubscriptionStatus>('/subscriptions/status');
      setStatus(data);
      if (data.active) {
        stopPolling();
        setAwaitingPayment(false);
        setPollTimedOut(false);
        setJustActivated(true);
        await refreshMe().catch(() => {});
      }
      return data.active;
    } catch {
      return false;
    }
  }, [refreshMe, stopPolling]);

  /** Poll after checkout — the webhook, not the redirect, is what activates. */
  const startPolling = useCallback(() => {
    stopPolling();
    setAwaitingPayment(true);
    setPollTimedOut(false);
    pollStartedAt.current = Date.now();
    pollRef.current = setInterval(async () => {
      const active = await checkStatus();
      if (!active && Date.now() - pollStartedAt.current > POLL_TIMEOUT_MS) {
        stopPolling();
        setAwaitingPayment(false);
        setPollTimedOut(true);
      }
    }, POLL_INTERVAL_MS);
  }, [checkStatus, stopPolling]);

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
      if (state === 'active') checkStatus();
    });
    return () => sub.remove();
  }, [awaitingPayment, checkStatus]);

  /* --------------------------- derived --------------------------- */

  const isPremium = status?.active ?? user?.plan === 'premium';
  const paymentsEnabled = !!config?.enabled;

  const currencyLabel = useMemo(
    () => t(`subscription.currency.${config?.currency ?? 'EGP'}`, { defaultValue: config?.currency ?? '' }),
    [t, config?.currency],
  );

  const money = useCallback(
    (amount: number) => `${groupDigits(amount)} ${currencyLabel}`.trim(),
    [currencyLabel],
  );

  const monthlyPrice = useMemo(() => priceOf(planFor(config, 'monthly')), [config]);
  const yearlyPrice = useMemo(() => priceOf(planFor(config, 'yearly')), [config]);
  const yearlyIfMonthly = monthlyPrice * 12;
  const savingAmount = Math.max(0, yearlyIfMonthly - yearlyPrice);
  const savingPercent = yearlyIfMonthly > 0 ? Math.round((savingAmount / yearlyIfMonthly) * 100) : 0;
  const selectedPrice = plan === 'yearly' ? yearlyPrice : monthlyPrice;

  const expiryDate = useMemo(() => {
    // Premium can be granted without a Subscription row, in which case only
    // `premiumUntil` carries the date — reading the row alone hid the expiry.
    const raw = status?.subscription?.expiresAt ?? status?.premiumUntil;
    if (!raw) return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    try {
      return d.toLocaleDateString(i18n.language === 'ar' ? 'ar-EG' : 'en-GB', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
    } catch {
      return d.toISOString().slice(0, 10);
    }
  }, [status?.subscription?.expiresAt, i18n.language]);

  /* --------------------------- actions --------------------------- */

  const onSelectPlan = useCallback((key: PlanKey) => setPlan(key), []);
  const onToggleFaq = useCallback((key: string) => {
    setOpenFaq((prev) => (prev === key ? null : key));
  }, []);

  const onCheckout = useCallback(async () => {
    if (!paymentsEnabled || checkingOut) return;

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
        plan,
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
  }, [paymentsEnabled, checkingOut, plan, phone, phoneRequired, startPolling, t]);

  const onChangePhone = useCallback((value: string) => {
    setPhone(value);
    setPhoneError(null);
  }, []);

  /* ---------------------------- render ---------------------------- */

  const ctaLabel = !paymentsEnabled
    ? t('subscription.ctaSoon')
    : checkingOut
      ? t('subscription.ctaRedirecting')
      : isPremium
        ? t('subscription.ctaRenew', { price: money(selectedPrice) })
        : t('subscription.ctaSubscribe', { price: money(selectedPrice) });

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
          disabled={!paymentsEnabled}
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
          <Badge label={t('subscription.heroBadge')} tone="accent" size="md" icon="sparkles" />

          <Text role="h2" weight="bold" tone="onBrand">{t('subscription.heroTitle')}</Text>
          <Text role="bodySm" tone="onBrand" style={styles.heroSubtitle}>
            {t('subscription.heroSubtitle')}
          </Text>

          <View style={[styles.heroTrust, { gap: theme.spacing.md, marginTop: theme.spacing.xs }]}>
            {[
              { icon: 'shield-checkmark' as const, label: t('subscription.trustSecure') },
              { icon: 'card-outline' as const, label: t('subscription.trustNoCard') },
              { icon: 'time-outline' as const, label: t('subscription.trustCancel') },
            ].map((item) => (
              <View key={item.label} style={[styles.heroTrustItem, { gap: theme.spacing.xs }]}>
                <Ionicons name={item.icon} size={theme.layout.icon.xs} color={theme.colors.textOnBrand} />
                <Text role="micro" tone="onBrand" style={styles.heroSubtitle}>{item.label}</Text>
              </View>
            ))}
          </View>
        </LinearGradient>
      </Reveal>

      {/* --------------------- Activation / status --------------------- */}
      {justActivated ? (
        <Reveal index={1}>
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
                <Text role="h4" weight="bold" tone="success">{t('subscription.activatedTitle')}</Text>
                <Text role="caption" tone="secondary" style={{ marginTop: theme.spacing.xxs }}>
                  {t('subscription.activatedBody')}
                </Text>
              </View>
            </View>
          </Card>
        </Reveal>
      ) : isPremium ? (
        <Reveal index={1}>
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
              onPress={checkStatus}
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

      {/* --------------------------- Plan picker --------------------------- */}
      <Reveal index={3}>
        <View style={{ marginTop: theme.spacing['2xl'] }}>
          <SectionHeader title={t('subscription.billingTitle')} />

          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={t('subscription.billingTitle')}
            style={[
              styles.segment,
              {
                backgroundColor: theme.colors.surfaceSunken,
                borderRadius: theme.radii.pill,
                padding: theme.spacing.xs,
                gap: theme.spacing.xs,
              },
            ]}
          >
            {(['monthly', 'yearly'] as PlanKey[]).map((key) => {
              const selected = plan === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => onSelectPlan(key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={t(`subscription.${key}`)}
                  style={({ pressed }) => [
                    styles.segmentItem,
                    {
                      // Full control height so each half clears the 48px target.
                      height: theme.layout.control.md,
                      borderRadius: theme.radii.pill,
                      gap: theme.spacing.sm,
                      backgroundColor: selected ? theme.colors.surface : 'transparent',
                      transform: [{ scale: pressed ? 0.98 : 1 }],
                    },
                    selected ? theme.shadow.sm : null,
                  ]}
                >
                  <Text role="bodySm" weight="bold" tone={selected ? 'default' : 'muted'}>
                    {t(`subscription.${key}`)}
                  </Text>
                  {key === 'yearly' && savingPercent > 0 ? (
                    <Badge label={t('subscription.saveBadge', { percent: savingPercent })} tone="success" />
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          {/* Price card */}
          <Card
            variant="elevated"
            padding="lg"
            style={[
              { marginTop: theme.spacing.md },
              plan === 'yearly'
                ? { borderColor: theme.colors.accentBorder, borderWidth: 1.5 }
                : null,
            ]}
          >
            {plan === 'yearly' ? (
              <View style={{ marginBottom: theme.spacing.md }}>
                <Badge label={t('subscription.mostPopular')} tone="accent" size="md" icon="flame" />
              </View>
            ) : null}

            <MotiView
              key={plan}
              from={{ opacity: 0, translateY: 8 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: theme.motion.duration.fast }}
            >
              <View style={[styles.priceRow, { gap: theme.spacing.sm }]}>
                <Text role="display" weight="bold">{money(selectedPrice)}</Text>
                <Text role="body" tone="muted" style={{ marginBottom: theme.spacing.xs }}>
                  {plan === 'yearly' ? t('subscription.perYear') : t('subscription.perMonth')}
                </Text>
              </View>

              <Text role="bodySm" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
                {plan === 'yearly'
                  ? t('subscription.equivalentMonthly', { amount: money(yearlyPrice / 12) })
                  : t('subscription.billedMonthly')}
              </Text>

              {plan === 'yearly' && savingAmount > 0 ? (
                <View style={[styles.rowCenter, { gap: theme.spacing.sm, marginTop: theme.spacing.md }]}>
                  <Ionicons name="pricetag" size={theme.layout.icon.sm} color={theme.colors.success} />
                  <Text role="bodySm" weight="bold" tone="success" flex>
                    {t('subscription.savingAmount', { amount: money(savingAmount) })}
                  </Text>
                </View>
              ) : null}
            </MotiView>
          </Card>
        </View>
      </Reveal>

      {/* --------------------------- Comparison --------------------------- */}
      <Reveal index={4}>
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
              <View style={[styles.cellFeature, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm }]}>
                <Text role="micro" weight="bold" tone="muted">{t('subscription.colFeature')}</Text>
              </View>
              <View style={[styles.cell, { paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.sm }]}>
                <Text role="micro" weight="bold" tone="muted" align="center">{t('subscription.colFree')}</Text>
              </View>
              <View
                style={[
                  styles.cell,
                  {
                    paddingHorizontal: theme.spacing.sm,
                    paddingVertical: theme.spacing.sm,
                    backgroundColor: theme.colors.accentMuted,
                  },
                ]}
              >
                <Text
                  role="micro"
                  weight="bold"
                  align="center"
                  tone="inherit"
                  style={{ color: theme.colors.accentText }}
                >
                  {t('subscription.colPremium')}
                </Text>
              </View>
            </View>

            {BENEFIT_KEYS.map((key, i) => (
              <BenefitRow
                key={key}
                label={t(`subscription.benefits.${key}.label`)}
                free={t(`subscription.benefits.${key}.free`)}
                premium={t(`subscription.benefits.${key}.premium`)}
                last={i === BENEFIT_KEYS.length - 1}
              />
            ))}
          </Card>
        </View>
      </Reveal>

      {/* -------------------------- Social proof -------------------------- */}
      <Reveal index={5}>
        <View style={{ marginTop: theme.spacing['2xl'] }}>
          <SectionHeader title={t('subscription.proofTitle')} />

          <Card variant="outlined" padding="md">
            <View style={styles.statsRow}>
              <StatTile value={t('subscription.proofRatingValue')} label={t('subscription.proofRatingLabel')} />
              <View
                style={[
                  styles.statDivider,
                  { width: theme.layout.hairline, backgroundColor: theme.colors.divider },
                ]}
              />
              <StatTile value={t('subscription.proofLearnersValue')} label={t('subscription.proofLearnersLabel')} />
              <View
                style={[
                  styles.statDivider,
                  { width: theme.layout.hairline, backgroundColor: theme.colors.divider },
                ]}
              />
              <StatTile value={t('subscription.proofSessionsValue')} label={t('subscription.proofSessionsLabel')} />
            </View>
          </Card>

          <Card variant="filled" padding="md" style={{ marginTop: theme.spacing.md }}>
            <View style={[styles.rowCenter, { gap: theme.spacing.xxs, marginBottom: theme.spacing.sm }]}>
              {[0, 1, 2, 3, 4].map((i) => (
                <Ionicons key={i} name="star" size={theme.layout.icon.xs} color={theme.colors.accent} />
              ))}
            </View>
            <Text role="bodySm" weight="bold">{t('subscription.testimonialQuote')}</Text>
            <Text role="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
              {t('subscription.testimonialAuthor')} · {t('subscription.testimonialRole')}
            </Text>
          </Card>
        </View>
      </Reveal>

      {/* ------------------------------- FAQ ------------------------------- */}
      <Reveal index={6}>
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
  rowCenter: { flexDirection: 'row', alignItems: 'center' },

  hero: { overflow: 'hidden' },
  // The onBrand ink is pure white; secondary hero copy needs it a shade softer
  // and the token set has no "on-brand muted" role.
  heroSubtitle: { opacity: 0.86 },
  heroTrust: { flexDirection: 'row', flexWrap: 'wrap' },
  heroTrustItem: { flexDirection: 'row', alignItems: 'center' },

  segment: { flexDirection: 'row' },
  segmentItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },

  priceRow: { flexDirection: 'row', alignItems: 'flex-end' },

  tableRow: { flexDirection: 'row', alignItems: 'stretch' },
  cellFeature: { flex: 1.5, justifyContent: 'center' },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  statsRow: { flexDirection: 'row', alignItems: 'center' },
  statTile: { flex: 1 },
  // Width comes from `theme.layout.hairline` at the call site.
  statDivider: { alignSelf: 'stretch' },

  faqHead: { flexDirection: 'row', alignItems: 'center' },

  footer: { width: '100%' },
  footerInner: { width: '100%', alignSelf: 'center' },
  inlineNotice: { flexDirection: 'row', alignItems: 'center' },
});
