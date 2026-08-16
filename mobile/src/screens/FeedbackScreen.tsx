/**
 * Feedback — the payoff screen.
 *
 * This is the moment the product delivers its value, and the old version
 * rendered it as four visually identical cards of bulleted text under a bare
 * number. The rebuild gives the score a real visualisation (`ScoreRing`, whose
 * colour comes from `scoreTone` so a 7/10 is the same colour on every screen),
 * a plain-language verdict so the number means something, and colour-coded
 * sections that can be scanned rather than read start to finish.
 *
 * `feedback` arrives as a route param straight from `POST /sessions/:id/answer`
 * — it is the parsed model output, so every field is treated as optional.
 */

import { memo, useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, Modal, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useAppTheme, useResponsive, useDirection } from '../theme/useTheme';
import { scoreTone } from '../theme/tokens';
import { Screen, Text, Button, Card, Badge, ScoreRing } from '../components';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Feedback'>;

type Tone = 'success' | 'warning' | 'danger' | 'primary' | 'accent';

const REPORT_REASONS = [
  'reportInaccurate',
  'reportHarsh',
  'reportIrrelevant',
  'reportLanguage',
  'reportOther',
] as const;
type ReportReason = (typeof REPORT_REASONS)[number];

/** Normalises whatever the model returned into a string list. */
function toList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

/* ------------------------------------------------------------------ *
 * Sub-components
 * ------------------------------------------------------------------ */

function FooterBar({ children }: { children: React.ReactNode }) {
  const theme = useAppTheme();
  const { maxWidth, screenPadding } = useResponsive();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        backgroundColor: theme.colors.bgElevated,
        borderTopWidth: theme.layout.hairline,
        borderTopColor: theme.colors.border,
        paddingTop: theme.spacing.md,
        paddingBottom: theme.spacing.md + insets.bottom,
      }}
    >
      <View
        style={{
          width: '100%',
          alignSelf: 'center',
          maxWidth,
          paddingHorizontal: screenPadding,
          gap: theme.spacing.xs,
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** One bullet inside a feedback section. Memoised — a long model answer plus
 *  three lists re-renders on every state change otherwise. */
const BulletRow = memo(function BulletRow({
  text, tone, icon,
}: {
  text: string;
  tone: Tone;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  const theme = useAppTheme();
  return (
    <View style={[styles.bulletRow, { gap: theme.spacing.md }]}>
      <Ionicons
        name={icon}
        size={theme.layout.icon.md}
        color={theme.colors[tone]}
        style={{ marginTop: theme.spacing.xxs }}
      />
      <Text role="bodySm" flex>{text}</Text>
    </View>
  );
});

function SectionCard({
  title, tone, icon, children,
}: {
  title: string;
  tone: Tone;
  icon: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
}) {
  const theme = useAppTheme();
  const mutedKey = `${tone}Muted` as const;

  return (
    <Card variant="elevated" padding="lg">
      <View style={{ gap: theme.spacing.md }}>
        <View style={[styles.sectionHead, { gap: theme.spacing.md }]}>
          <View
            style={[
              styles.sectionIcon,
              {
                width: theme.layout.avatar.sm,
                height: theme.layout.avatar.sm,
                borderRadius: theme.radii.sm,
                backgroundColor: theme.colors[mutedKey],
              },
            ]}
          >
            <Ionicons name={icon} size={theme.layout.icon.md} color={theme.colors[tone]} />
          </View>
          <Text role="h4" weight="bold" flex accessibilityRole="header">{title}</Text>
        </View>
        {children}
      </View>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Report sheet
 * ------------------------------------------------------------------ */

function ReportSheet({
  visible, onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [sent, setSent] = useState(false);

  const close = useCallback(() => {
    onClose();
    // Reset after the dismiss animation so the sheet doesn't flicker.
    setTimeout(() => { setReason(null); setSent(false); }, theme.motion.duration.normal);
  }, [onClose, theme.motion.duration.normal]);

  const submit = useCallback(() => {
    // NOTE: there is no user-facing report endpoint. The backend exposes only
    // `GET /admin/reports` and `POST /admin/reports/:id/resolve`, and rows in
    // `answer_reports` can currently only be created server-side. The reason is
    // captured and acknowledged here; wiring it up needs a new endpoint (see
    // the API-gap note that ships with this screen).
    setSent(true);
  }, []);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        onPress={close}
        style={[styles.overlay, { backgroundColor: theme.colors.overlay, padding: theme.spacing.xl }]}
      >
        <Pressable
          accessibilityRole="none"
          onPress={() => {}}
          style={[
            styles.overlayCard,
            {
              maxWidth: theme.layout.maxContentWidth * 0.6,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.xl,
              padding: theme.spacing.xl,
              gap: theme.spacing.lg,
            },
            theme.shadow.xl,
          ]}
        >
          {sent ? (
            <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
              <View
                style={[
                  styles.sectionIcon,
                  {
                    width: theme.layout.avatar.lg,
                    height: theme.layout.avatar.lg,
                    borderRadius: theme.radii.pill,
                    backgroundColor: theme.colors.successMuted,
                  },
                ]}
              >
                <Ionicons name="checkmark-circle" size={theme.layout.icon.xl} color={theme.colors.success} />
              </View>
              <Text role="h3" weight="bold" align="center">{t('feedback.reportDone')}</Text>
              <Text role="bodySm" tone="muted" align="center">{t('feedback.reportDoneBody')}</Text>
              <Button title={t('common.close')} variant="secondary" onPress={close} style={{ marginTop: theme.spacing.xs }} />
            </View>
          ) : (
            <>
              <View style={{ gap: theme.spacing.xs }}>
                <Text role="h3" weight="bold">{t('feedback.reportTitle')}</Text>
                <Text role="bodySm" tone="muted">{t('feedback.reportBody')}</Text>
              </View>

              <View
                accessibilityRole="radiogroup"
                accessibilityLabel={t('feedback.reportTitle')}
                style={{ gap: theme.spacing.sm }}
              >
                {REPORT_REASONS.map((key) => {
                  const selected = reason === key;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => setReason(key)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={t(`feedback.${key}`)}
                      style={({ pressed }) => [
                        styles.reasonRow,
                        {
                          minHeight: theme.layout.touchTarget,
                          paddingHorizontal: theme.spacing.lg,
                          paddingVertical: theme.spacing.md,
                          borderRadius: theme.radii.md,
                          borderWidth: 1.5,
                          gap: theme.spacing.md,
                          backgroundColor: selected ? theme.colors.primaryMuted : theme.colors.surface,
                          borderColor: selected ? theme.colors.primaryBorder : theme.colors.border,
                          opacity: pressed ? 0.75 : 1,
                        },
                      ]}
                    >
                      <Ionicons
                        name={selected ? 'radio-button-on' : 'radio-button-off'}
                        size={theme.layout.icon.md}
                        color={selected ? theme.colors.primary : theme.colors.textDisabled}
                      />
                      <Text role="bodySm" weight={selected ? 'bold' : 'regular'} flex>
                        {t(`feedback.${key}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={{ gap: theme.spacing.sm }}>
                <Button title={t('feedback.reportSubmit')} onPress={submit} disabled={!reason} />
                <Button title={t('common.cancel')} variant="ghost" onPress={close} />
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export function FeedbackScreen({ route, navigation }: Props) {
  const { feedback, nextQuestion, sessionId } = route.params;
  const { t } = useTranslation();
  const theme = useAppTheme();
  const { arrowForward } = useDirection();

  const [reporting, setReporting] = useState(false);

  const score = useMemo(() => {
    const n = Number(feedback?.score);
    return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 0;
  }, [feedback?.score]);

  const tone = scoreTone(score);
  const verdict = tone === 'success' ? 'Great' : tone === 'warning' ? 'Good' : 'Weak';

  const strengths = useMemo(() => toList(feedback?.strengths), [feedback?.strengths]);
  const weaknesses = useMemo(() => toList(feedback?.weaknesses), [feedback?.weaknesses]);
  const improvement = typeof feedback?.improvement === 'string' ? feedback.improvement.trim() : '';
  const modelAnswer = typeof feedback?.model_answer === 'string' ? feedback.model_answer.trim() : '';

  const onNext = useCallback(() => {
    if (nextQuestion) {
      // `category` is intentionally empty — the interview screen resolves it
      // from `GET /sessions/:id`, which is the only source that survives a
      // `replace`. The route's param type requires the key to be present.
      navigation.replace('Interview', { sessionId, firstQuestion: nextQuestion, category: {} });
    } else {
      navigation.replace('SessionSummary', { sessionId });
    }
  }, [navigation, nextQuestion, sessionId]);

  return (
    <Screen
      scroll
      contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.lg }}
      footer={
        <FooterBar>
          <Button
            title={nextQuestion ? t('interview.next') : t('feedback.finish')}
            size="lg"
            onPress={onNext}
            iconRight={
              <Ionicons
                name={nextQuestion ? arrowForward : 'stats-chart'}
                size={theme.layout.icon.md}
                color={theme.colors.onPrimary}
              />
            }
            accessibilityLabel={nextQuestion ? t('interview.next') : t('feedback.finish')}
          />
          {/* Kept at the default `md` height: `sm` is 40px, under the 48px
              accessible minimum, and this is a full-width footer control. */}
          <Button
            title={t('feedback.report')}
            variant="ghost"
            onPress={() => setReporting(true)}
            haptic={false}
            accessibilityHint={t('feedback.reportBody')}
          />
        </FooterBar>
      }
    >
      {/* ---------------- Score ---------------- */}
      <MotiView
        from={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', ...theme.motion.easing.spring }}
      >
        <Card variant="elevated" padding="lg">
          <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <Text role="micro" weight="bold" tone="muted">{t('feedback.kicker')}</Text>

            <ScoreRing
              score={score}
              size={theme.layout.avatar.xl + theme.spacing['3xl']}
              strokeWidth={theme.spacing.sm}
              label={t('feedback.outOf')}
            />

            <Text role="h2" weight="bold" align="center" tone={tone}>
              {t(`feedback.verdict${verdict}`)}
            </Text>
            <Text
              role="bodySm"
              tone="muted"
              align="center"
              // Caps the measure so the supporting line stays readable on wide
              // viewports; there is no "prose width" token yet (see report).
              style={{ maxWidth: theme.layout.maxContentWidth * 0.55 }}
            >
              {t(`feedback.verdict${verdict}Body`)}
            </Text>
          </View>
        </Card>
      </MotiView>

      {/* ---------------- Degraded-evaluation notices ---------------- */}
      {feedback?.stub ? (
        <Card variant="outlined" padding="md" style={{ borderColor: theme.colors.warning }}>
          <View style={[styles.noticeRow, { gap: theme.spacing.md }]}>
            <Ionicons name="flask-outline" size={theme.layout.icon.lg} color={theme.colors.warning} />
            <View style={styles.noticeText}>
              <Text role="bodySm" weight="bold" tone="warning">{t('feedback.stubTitle')}</Text>
              <Text role="caption" tone="muted" style={{ marginTop: theme.spacing.xxs }}>
                {t('feedback.stubBody')}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      {feedback?.error ? (
        <Card variant="outlined" padding="md" style={{ borderColor: theme.colors.danger }}>
          <View style={[styles.noticeRow, { gap: theme.spacing.md }]}>
            <Ionicons name="alert-circle-outline" size={theme.layout.icon.lg} color={theme.colors.danger} />
            <Text role="bodySm" weight="bold" tone="danger" flex>{t('feedback.errorTitle')}</Text>
          </View>
        </Card>
      ) : null}

      {/* ---------------- Strengths ---------------- */}
      <MotiView
        from={{ opacity: 0, translateY: theme.spacing.md }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: theme.motion.duration.normal, delay: theme.motion.stagger }}
      >
        <SectionCard title={t('feedback.strengths')} tone="success" icon="checkmark-circle">
          {strengths.length ? (
            <View style={{ gap: theme.spacing.md }}>
              {strengths.map((s, i) => (
                <BulletRow key={`${i}-${s.slice(0, 12)}`} text={s} tone="success" icon="checkmark-circle-outline" />
              ))}
            </View>
          ) : (
            <Text role="bodySm" tone="muted">{t('feedback.noStrengths')}</Text>
          )}
        </SectionCard>
      </MotiView>

      {/* ---------------- Weaknesses ---------------- */}
      <MotiView
        from={{ opacity: 0, translateY: theme.spacing.md }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: theme.motion.duration.normal, delay: theme.motion.stagger * 2 }}
      >
        <SectionCard title={t('feedback.weaknesses')} tone="warning" icon="construct">
          {weaknesses.length ? (
            <View style={{ gap: theme.spacing.md }}>
              {weaknesses.map((s, i) => (
                <BulletRow key={`${i}-${s.slice(0, 12)}`} text={s} tone="warning" icon="alert-circle-outline" />
              ))}
            </View>
          ) : (
            <Text role="bodySm" tone="muted">{t('feedback.noWeaknesses')}</Text>
          )}
        </SectionCard>
      </MotiView>

      {/* ---------------- Improvement ---------------- */}
      {improvement ? (
        <MotiView
          from={{ opacity: 0, translateY: theme.spacing.md }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: theme.motion.duration.normal, delay: theme.motion.stagger * 3 }}
        >
          <SectionCard title={t('feedback.improvement')} tone="primary" icon="bulb">
            <Text role="body">{improvement}</Text>
          </SectionCard>
        </MotiView>
      ) : null}

      {/* ---------------- Model answer ---------------- */}
      {modelAnswer ? (
        <MotiView
          from={{ opacity: 0, translateY: theme.spacing.md }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: theme.motion.duration.normal, delay: theme.motion.stagger * 4 }}
        >
          <SectionCard title={t('feedback.modelAnswer')} tone="accent" icon="ribbon">
            <View
              style={{
                backgroundColor: theme.colors.accentMuted,
                borderRadius: theme.radii.md,
                padding: theme.spacing.lg,
                gap: theme.spacing.sm,
              }}
            >
              <Badge label={t('feedback.modelAnswer')} tone="accent" icon="sparkles" />
              <Text role="body">{modelAnswer}</Text>
            </View>
          </SectionCard>
        </MotiView>
      ) : null}

      <ReportSheet visible={reporting} onClose={() => setReporting(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionHead: { flexDirection: 'row', alignItems: 'center' },
  sectionIcon: { alignItems: 'center', justifyContent: 'center' },

  bulletRow: { flexDirection: 'row', alignItems: 'flex-start' },

  noticeRow: { flexDirection: 'row', alignItems: 'flex-start' },
  noticeText: { flex: 1 },

  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  overlayCard: { width: '100%' },
  reasonRow: { flexDirection: 'row', alignItems: 'center' },
});
