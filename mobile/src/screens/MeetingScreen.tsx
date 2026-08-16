/**
 * Live mock interview — the "call" screen.
 *
 * This is a video-call surface, not a form: a full-bleed stage with the AI
 * interviewer at its centre, floating chrome (top bar, self-view, captions,
 * control bar) composited on top, and every panel that would steal the stage
 * demoted to a bottom sheet.
 *
 * How a turn works
 *   1. The recognizer stays open continuously; the utterance is only committed
 *      after `SILENCE_MS` of quiet, so thinking pauses don't cut the candidate
 *      off mid-sentence.
 *   2. The committed text goes to `/meeting/turn`, which replies with the
 *      interviewer's next line plus coaching tips for the *next* answer.
 *   3. The reply is spoken by the platform's own neural voice, which starts
 *      immediately and needs no round-trip of ours. Server TTS remains as the
 *      fallback for engines with no usable voice for the interview language.
 *
 * Language
 *   Chosen before the call on MeetingSetupScreen and carried in
 *   `route.params.language`. It drives the questions, the voice, the
 *   recognizer locale and the final evaluation — everything, not just copy.
 *
 * Platform
 *   Every camera, microphone, voice, level and recorder call goes through
 *   `src/media`, which Metro resolves to a browser implementation on web and an
 *   Expo one on device. So this screen holds no `Platform.OS` media branch and
 *   no browser global: where the two platforms genuinely differ it reads
 *   `capabilities` — and, where the difference costs the candidate something,
 *   says so in the UI before they can be surprised by it.
 *
 * Session recording
 *   A review artifact of the call, delivered as a download on web and through
 *   the share sheet on device. It is not the same recording on both: on web it
 *   captures the whole call including the interviewer, while on Android the
 *   recognizer owns the one microphone client the OS gives an app, so the file
 *   is video only. `capabilities.recorder` says which, and the control bar
 *   repeats it under the record button.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, StyleSheet, Pressable, Platform, ScrollView, ActivityIndicator, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView, AnimatePresence } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { SvgUri } from 'react-native-svg';
import { useTranslation } from 'react-i18next';

import { api, API_BASE } from '../api/client';
import { secureStorage } from '../storage/secureStorage';
import { useAuth } from '../store/auth';
import { useBalance, formatClock } from '../store/balance';
import { useAppTheme, useResponsive, useDirection } from '../theme/useTheme';
import { Screen, Text, Button, Card, Badge, ScoreRing } from '../components';
import { balanceLabel, durationLabel } from './mainShared';
import {
  capabilities, useCamera, useInterviewerVoice, useLevelMeter,
  useSessionRecorder, useSpeechRecognizer,
} from '../media';
import type { SpeechLang } from '../media';
import { RESUME_LISTEN_MS, SILENCE_MS } from '../media/tuning';
import { PERSONA, personaAvatarUrl } from './interviewerPersona';

/* ------------------------------------------------------------------ *
 * 1. Stage palette
 *
 * The call chrome is composited over a live camera feed and an avatar tile.
 * A camera image is the same pixels in light mode and dark mode, so anything
 * layered on top of it must stay fixed: a theme-reactive scrim would flip
 * white call text onto a light background the moment the user switched theme,
 * and the captions would become unreadable. These are the only colour
 * literals allowed in this file, and they are used *only* by the overlay
 * chrome (stage, top bar, captions, self-view, control bar).
 *
 * Modal surfaces — the tips sheet, the end-call dialog, the result screen —
 * take over the viewport rather than sit on video, so they use the normal
 * semantic roles from the theme.
 * ------------------------------------------------------------------ */

const STAGE = {
  bg:          '#0B1020',
  bgDeep:      '#05070F',
  scrim:       'rgba(5,7,15,0.72)',
  scrimClear:  'rgba(5,7,15,0)',
  chrome:      'rgba(9,13,26,0.78)',
  chromeSoft:  'rgba(255,255,255,0.12)',
  chromeDim:   'rgba(255,255,255,0.05)',
  border:      'rgba(255,255,255,0.16)',
  borderDim:   'rgba(255,255,255,0.08)',
  tile:        '#18233B',
  ink:         '#FFFFFF',
  inkMuted:    'rgba(255,255,255,0.72)',
  inkFaint:    'rgba(255,255,255,0.45)',
  danger:      '#EF4444',
  dangerSoft:  'rgba(239,68,68,0.22)',
  dangerBorder:'rgba(239,68,68,0.55)',
  dangerInk:   '#FCA5A5',
  live:        '#10B981',
  liveSoft:    'rgba(16,185,129,0.20)',
  liveInk:     '#6EE7B7',
  warn:        '#F59E0B',
  warnSoft:    'rgba(245,158,11,0.20)',
  warnInk:     '#FCD34D',
} as const;

/**
 * Video-tile geometry. These are aspect-ratio-driven pixel sizes for image
 * surfaces, not spacing/radii/type values — a 4:3 self-view has no meaningful
 * expression on the 4pt grid. Everything else on this screen comes from the
 * theme scale.
 */
const VIDEO = {
  pipRatio: 0.26,   // fraction of viewport width
  pipMin: 96,
  pipMax: 132,
  pipAspect: 4 / 3, // height / width
  avatarRatio: 0.40,
  avatarMin: 128,
  avatarMax: 208,
} as const;

/* ------------------------------------------------------------------ *
 * 2. Tuning
 * ------------------------------------------------------------------ */

/** How long a transient notice stays on the stage. Timing of the UI, not of the
 *  media — everything the two platforms must agree on lives in `media/tuning`. */
const NOTICE_MS = 5500;

/**
 * The two fault states have to tell the candidate where to go and fix the
 * problem, and that is the one place the answer genuinely differs: site
 * permissions in a browser, app permissions in the OS settings. Read off the
 * media layer's own descriptor rather than off `Platform`, and used for copy
 * only — no behaviour hangs on it.
 */
const MEDIA_COPY = capabilities.platform === 'web'
  ? {
      deniedBody: 'meeting.mediaDeniedBody',
      unsupportedTitle: 'meeting.mediaUnsupportedTitle',
      unsupportedBody: 'meeting.mediaUnsupportedBody',
      sttUnsupported: 'meeting.sttUnsupported',
    }
  : {
      deniedBody: 'meeting.mediaDeniedBodyDevice',
      unsupportedTitle: 'meeting.mediaUnsupportedTitleDevice',
      unsupportedBody: 'meeting.mediaUnsupportedBodyDevice',
      sttUnsupported: 'meeting.sttUnsupportedDevice',
    };

/* ------------------------------------------------------------------ *
 * 3. Types + helpers
 * ------------------------------------------------------------------ */

type TurnRole = 'assistant' | 'user';
interface Turn { role: TurnRole; content: string; at: number }
interface Tip { id: number; text: string; at: number }

type MeetingState = 'preparing' | 'active' | 'closing' | 'ended';
type Presence = 'idle' | 'listening' | 'thinking' | 'speaking';
type EvalPhase = 'idle' | 'loading' | 'ready' | 'none' | 'error';
type NoticeTone = 'info' | 'danger' | 'success';

interface Evaluation {
  overall_score?: number;
  summary?: string;
  strengths?: string[];
  weaknesses?: string[];
  advice?: string;
}

/**
 * The meter, exactly as the server reports it.
 *
 * Every field is server-computed and the screen only displays it. The client
 * keeps its own `elapsed` timer for the call chrome, but that number has never
 * been — and must never become — an input to what the user is charged.
 */
interface Billing {
  meetingId: string;
  /** What can still be spent in THIS interview. Drives the countdown. */
  remainingSeconds: number;
  remainingMinutes: number;
  /** Charged so far for this interview. */
  billedSeconds: number;
  /** Wall-clock deliberately NOT charged — a drop, a lock screen, a kill. */
  skippedSeconds: number;
  /** How often to heartbeat. Server-tunable, so never a constant here. */
  tickSeconds: number;
  lowWaterSeconds: number;
  warn: boolean;
  exhausted: boolean;
}

/** The receipt shown after the interview, from `POST /meeting/finish`. */
interface Receipt {
  billedSeconds: number;
  skippedSeconds: number;
  remainingSeconds: number;
}

/** Why `/meeting/start` refused, in the server's own numbers. */
interface StartBlocked {
  requiredSeconds: number;
  balanceSeconds: number;
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function apiErrorMessage(err: any, fallback: string): string {
  return err?.response?.data?.error || err?.message || fallback;
}

/**
 * The API's stable error identifier, e.g. QUOTA_EXCEEDED / AI_UNAVAILABLE /
 * PREMIUM_REQUIRED. Falls back to the HTTP status when an older build of the
 * server is still deployed and has no `code` in the body.
 */
type ApiErrorKind = 'quota' | 'premium' | 'ai' | 'expired' | 'unknown';

function apiErrorKind(err: any): ApiErrorKind {
  const code = err?.response?.data?.code;
  if (code === 'QUOTA_EXCEEDED') return 'quota';
  if (code === 'PREMIUM_REQUIRED') return 'premium';
  if (code === 'AI_UNAVAILABLE') return 'ai';
  // The sweeper settled this meeting while the app was away. Not an error the
  // user caused, and the only sane response is to close out into the
  // evaluation for what did happen.
  if (code === 'MEETING_EXPIRED') return 'expired';
  const status = err?.response?.status;
  if (status === 402) return 'quota';
  if (status === 409) return 'expired';
  if (status === 503 || status === 502) return 'ai';
  return 'unknown';
}

/** `details.balanceSeconds` / `details.requiredSeconds` off a 402 body. */
function quotaDetails(err: any): StartBlocked {
  const d = err?.response?.data?.details ?? {};
  return {
    requiredSeconds: Number(d.requiredSeconds) || 0,
    balanceSeconds: Number(d.balanceSeconds) || 0,
  };
}

/* ------------------------------------------------------------------ *
 * 4. Chrome primitives
 * ------------------------------------------------------------------ */

/** Small translucent pill used for the state / REC indicators in the top bar. */
function StatusChip({
  label, dotColor, ink = STAGE.ink, bg = STAGE.chrome, pulse = false,
}: {
  label: string;
  dotColor: string;
  ink?: string;
  bg?: string;
  pulse?: boolean;
}) {
  const theme = useAppTheme();
  const dot = theme.spacing.sm;

  return (
    <View
      style={[
        styles.row,
        {
          gap: theme.spacing.xs,
          paddingVertical: theme.spacing.xs,
          paddingHorizontal: theme.spacing.md,
          borderRadius: theme.radii.pill,
          backgroundColor: bg,
          borderWidth: theme.layout.hairline,
          borderColor: STAGE.border,
        },
      ]}
    >
      <View style={{ width: dot, height: dot }}>
        {pulse ? (
          <MotiView
            from={{ opacity: 1, scale: 1 }}
            animate={{ opacity: 0.25, scale: 0.7 }}
            transition={{ type: 'timing', duration: theme.motion.duration.deliberate, loop: true }}
            style={{ width: dot, height: dot, borderRadius: theme.radii.pill, backgroundColor: dotColor }}
          />
        ) : (
          <View style={{ width: dot, height: dot, borderRadius: theme.radii.pill, backgroundColor: dotColor }} />
        )}
      </View>
      <Text role="micro" weight="bold" tone="inherit" style={{ color: ink }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

type ControlTone = 'default' | 'muted' | 'recording' | 'end';

/**
 * One circular call control with its purpose spelled out underneath — the
 * user explicitly asked that no button require guessing what it does.
 */
function ControlButton({
  icon, label, a11yLabel, a11yHint, onPress,
  tone = 'default', disabled = false, wide = false, rotateIcon,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  a11yLabel: string;
  a11yHint?: string;
  onPress: () => void;
  tone?: ControlTone;
  disabled?: boolean;
  wide?: boolean;
  rotateIcon?: string;
}) {
  const theme = useAppTheme();
  const size = theme.layout.control.lg;
  const circleW = wide ? size + theme.spacing['2xl'] : size;

  const fill =
    disabled ? STAGE.chromeDim
    : tone === 'end' || tone === 'recording' ? STAGE.danger
    : tone === 'muted' ? STAGE.dangerSoft
    : STAGE.chromeSoft;

  const ink =
    disabled ? STAGE.inkFaint
    : tone === 'muted' ? STAGE.dangerInk
    : STAGE.ink;

  const borderColor =
    disabled ? STAGE.borderDim
    : tone === 'muted' ? STAGE.dangerBorder
    : STAGE.border;

  return (
    <View style={{ width: circleW, alignItems: 'center', gap: theme.spacing.xxs }}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityHint={a11yHint}
        accessibilityState={{ disabled }}
        hitSlop={theme.spacing.xs}
        style={({ pressed }) => [
          styles.center,
          {
            width: circleW,
            height: size,
            borderRadius: theme.radii.pill,
            backgroundColor: fill,
            borderWidth: theme.layout.hairline,
            borderColor,
            opacity: disabled ? 0.6 : 1,
            transform: [{ scale: pressed && !disabled ? 0.93 : 1 }],
          },
        ]}
      >
        {tone === 'recording' ? (
          <MotiView
            pointerEvents="none"
            from={{ opacity: 0.8, scale: 1 }}
            animate={{ opacity: 0, scale: 1.4 }}
            transition={{ type: 'timing', duration: theme.motion.duration.deliberate * 2, loop: true, repeatReverse: false }}
            style={[
              StyleSheet.absoluteFillObject,
              { borderRadius: theme.radii.pill, borderWidth: theme.spacing.xxs, borderColor: STAGE.danger },
            ]}
          />
        ) : null}
        <Ionicons
          name={icon}
          size={theme.layout.icon.lg}
          color={ink}
          style={rotateIcon ? { transform: [{ rotate: rotateIcon }] } : undefined}
        />
      </Pressable>
      <Text
        role="micro"
        weight="bold"
        tone="inherit"
        numberOfLines={1}
        align="center"
        style={{ color: disabled ? STAGE.inkFaint : STAGE.inkMuted }}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * A persistent notice on the stage, with one way out.
 *
 * Deliberately NOT the transient `notice` toast: a balance warning that
 * vanishes after 5.5 seconds is a warning the candidate will miss while they
 * are mid-sentence. The same lesson the mic-lost banner already learned.
 */
function StageBanner({
  icon, tone, title, body, actionLabel, onAction,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'warn' | 'danger';
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  const theme = useAppTheme();
  const warn = tone === 'warn';

  return (
    <View
      style={[
        styles.row,
        {
          width: '100%',
          maxWidth: theme.layout.maxContentWidth,
          gap: theme.spacing.sm,
          alignItems: 'flex-start',
          padding: theme.spacing.md,
          borderRadius: theme.radii.md,
          borderWidth: theme.layout.hairline,
          backgroundColor: warn ? STAGE.warnSoft : STAGE.dangerSoft,
          borderColor: warn ? STAGE.border : STAGE.dangerBorder,
        },
      ]}
    >
      <Ionicons
        name={icon}
        size={theme.layout.icon.md}
        color={warn ? STAGE.warnInk : STAGE.dangerInk}
      />
      <View style={{ flex: 1, gap: theme.spacing.xxs }}>
        <Text role="bodySm" weight="bold" tone="inherit" style={{ color: STAGE.ink }}>
          {title}
        </Text>
        <Text role="caption" tone="inherit" style={{ color: STAGE.inkMuted }}>
          {body}
        </Text>
      </View>
      <Pressable
        onPress={onAction}
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        hitSlop={theme.spacing.xs}
        style={({ pressed }) => [
          styles.center,
          {
            height: theme.layout.control.sm,
            paddingHorizontal: theme.spacing.md,
            borderRadius: theme.radii.pill,
            backgroundColor: STAGE.chromeSoft,
            borderWidth: theme.layout.hairline,
            borderColor: STAGE.border,
            opacity: pressed ? 0.75 : 1,
          },
        ]}
      >
        <Text role="micro" weight="bold" tone="inherit" style={{ color: STAGE.ink }} numberOfLines={1}>
          {actionLabel}
        </Text>
      </Pressable>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * 5. The interviewer stage
 * ------------------------------------------------------------------ */

function InterviewerStage({
  name, role, gender, categoryName, avatarUrl, accent, presence, awaitingStart, level, size,
}: {
  name: string;
  role: string;
  gender: 'male' | 'female';
  categoryName?: string;
  avatarUrl: string;
  accent: string;
  presence: Presence;
  awaitingStart: boolean;
  level: number;
  size: number;
}) {
  const theme = useAppTheme();
  const { t } = useTranslation();

  // Arabic conjugates the verb to the interviewer's gender, so "is speaking"
  // is a different string for Sarah and for Ahmed — hence a key per gender
  // rather than one string with a name interpolated into it.
  const g = gender === 'male' ? 'M' : 'F';

  const ringColor =
    presence === 'speaking' ? accent
    : presence === 'listening' ? STAGE.live
    : presence === 'thinking' ? STAGE.warn
    : STAGE.chromeSoft;

  const presenceLabel =
    presence === 'speaking' ? t(`meeting.presenceSpeaking${g}`)
    : presence === 'listening' ? t(`meeting.presenceListening${g}`)
    : presence === 'thinking' ? t(`meeting.presenceThinking${g}`)
    : awaitingStart ? t(`meeting.presenceReady${g}`)
    : t('meeting.presenceIdle');

  const presenceInk =
    presence === 'speaking' ? STAGE.ink
    : presence === 'listening' ? STAGE.liveInk
    : presence === 'thinking' ? STAGE.warnInk
    : STAGE.inkMuted;

  const presenceBg =
    presence === 'listening' ? STAGE.liveSoft
    : presence === 'thinking' ? STAGE.warnSoft
    : STAGE.chrome;

  const halo = size * 1.6;

  return (
    <View style={[styles.center, { gap: theme.spacing.md }]}>
      <View style={[styles.center, { width: halo, height: halo }]}>
        {/* Ambient glow — always present so the stage never looks like a
            cut-out circle pasted on a flat background. */}
        <View
          style={{
            position: 'absolute',
            width: halo,
            height: halo,
            borderRadius: theme.radii.pill,
            backgroundColor: accent,
            opacity: 0.10,
          }}
        />

        {/* Speaking: rings driven by the live voice envelope. */}
        {presence === 'speaking' ? (
          <>
            <MotiView
              animate={{ scale: 1 + level * 0.22, opacity: 0.16 + level * 0.24 }}
              transition={{ type: 'timing', duration: theme.motion.duration.instant }}
              style={{
                position: 'absolute',
                width: size * 1.42,
                height: size * 1.42,
                borderRadius: theme.radii.pill,
                backgroundColor: accent,
              }}
            />
            <MotiView
              animate={{ scale: 1 + level * 0.12, opacity: 0.28 + level * 0.32 }}
              transition={{ type: 'timing', duration: theme.motion.duration.instant }}
              style={{
                position: 'absolute',
                width: size * 1.16,
                height: size * 1.16,
                borderRadius: theme.radii.pill,
                backgroundColor: accent,
              }}
            />
          </>
        ) : null}

        {/* Listening: a slow, calm breath so the screen never feels frozen. */}
        {presence === 'listening' ? (
          <MotiView
            from={{ scale: 1, opacity: 0.45 }}
            animate={{ scale: 1.28, opacity: 0 }}
            transition={{ type: 'timing', duration: theme.motion.duration.deliberate * 4, loop: true, repeatReverse: false }}
            style={{
              position: 'absolute',
              width: size * 1.12,
              height: size * 1.12,
              borderRadius: theme.radii.pill,
              borderWidth: theme.spacing.xxs,
              borderColor: STAGE.live,
            }}
          />
        ) : null}

        <View
          style={[
            styles.center,
            {
              width: size,
              height: size,
              borderRadius: theme.radii.pill,
              backgroundColor: accent,
              borderWidth: theme.spacing.xs,
              borderColor: ringColor,
              overflow: 'hidden',
            },
          ]}
        >
          {/* The only platform branch left in this file, and it is not a media
              one: it is how a single remote SVG gets painted. The browser
              renders it with its own <img>, which is what the live build
              already ships and what no SVG parser can be guaranteed to match
              pixel for pixel; native has no <img>, so it fetches and parses the
              same URL, and falls back to the initial if the network says no. */}
          {Platform.OS === 'web' ? (
            // @ts-ignore — web-only HTMLImageElement
            <img
              src={avatarUrl}
              alt={name}
              width={size}
              height={size}
              style={{ width: size, height: size, display: 'block' }}
            />
          ) : (
            <SvgUri
              uri={avatarUrl}
              width={size}
              height={size}
              fallback={(
                <Text role="display" weight="bold" tone="inherit" style={{ color: STAGE.ink }}>
                  {name.slice(0, 1)}
                </Text>
              )}
            />
          )}
        </View>
      </View>

      <View style={[styles.center, { gap: theme.spacing.xxs }]}>
        <Text role="h3" weight="bold" tone="inherit" style={{ color: STAGE.ink }} align="center">
          {name}
        </Text>
        <Text role="bodySm" tone="inherit" style={{ color: STAGE.inkMuted }} align="center">
          {role}
        </Text>
      </View>

      <View style={[styles.row, { gap: theme.spacing.sm, flexWrap: 'wrap', justifyContent: 'center' }]}>
        <View
          style={[
            styles.row,
            {
              gap: theme.spacing.sm,
              paddingVertical: theme.spacing.xs,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radii.pill,
              backgroundColor: presenceBg,
              borderWidth: theme.layout.hairline,
              borderColor: STAGE.border,
            },
          ]}
        >
          {presence === 'thinking' ? <ActivityIndicator size="small" color={STAGE.warnInk} /> : null}
          {presence === 'speaking' ? <VoiceMeter level={level} color={STAGE.ink} /> : null}
          {presence === 'listening' ? (
            <View
              style={{
                width: theme.spacing.sm,
                height: theme.spacing.sm,
                borderRadius: theme.radii.pill,
                backgroundColor: STAGE.live,
              }}
            />
          ) : null}
          <Text role="caption" weight="bold" tone="inherit" style={{ color: presenceInk }}>
            {presenceLabel}
          </Text>
        </View>

        {categoryName ? (
          <View
            style={{
              paddingVertical: theme.spacing.xs,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radii.pill,
              backgroundColor: STAGE.chromeDim,
              borderWidth: theme.layout.hairline,
              borderColor: STAGE.borderDim,
            }}
          >
            <Text role="micro" weight="bold" tone="inherit" style={{ color: STAGE.inkMuted }} numberOfLines={1}>
              {categoryName}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Five bars riding the voice envelope — reads as "audio", not decoration. */
function VoiceMeter({ level, color }: { level: number; color: string }) {
  const theme = useAppTheme();
  const bars = [0.55, 0.85, 1, 0.8, 0.5];
  const unit = theme.spacing.md;

  return (
    <View style={[styles.row, { gap: theme.spacing.xxs, height: unit, alignItems: 'center' }]}>
      {bars.map((weight, i) => (
        <MotiView
          key={i}
          animate={{ height: Math.max(theme.spacing.xxs, unit * weight * (0.25 + level * 0.75)) }}
          transition={{ type: 'timing', duration: theme.motion.duration.instant }}
          style={{ width: theme.spacing.xxs, borderRadius: theme.radii.pill, backgroundColor: color }}
        />
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * 6. Bottom sheet shell (design-system surface, not stage chrome)
 * ------------------------------------------------------------------ */

function Sheet({
  visible, onClose, children, maxWidth,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
}) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} accessibilityViewIsModal>
      <Pressable
        style={[styles.sheetBackdrop, { backgroundColor: theme.colors.overlay }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
      >
        {/* Swallow taps inside the sheet. `accessible={false}` keeps the sheet
            from collapsing into a single unlabelled node for screen readers. */}
        <Pressable
          onPress={() => {}}
          accessible={false}
          importantForAccessibility="no"
          style={[styles.sheetStop, maxWidth ? { maxWidth } : null]}
        >
          <MotiView
            from={{ translateY: theme.spacing['4xl'], opacity: 0 }}
            animate={{ translateY: 0, opacity: 1 }}
            transition={{ type: 'timing', duration: theme.motion.duration.normal }}
            style={{
              backgroundColor: theme.colors.bgElevated,
              borderTopLeftRadius: theme.radii.xl,
              borderTopRightRadius: theme.radii.xl,
              borderTopWidth: theme.layout.hairline,
              borderColor: theme.colors.border,
              paddingTop: theme.spacing.md,
              paddingBottom: theme.spacing.xl + insets.bottom,
              paddingHorizontal: theme.spacing.xl,
              gap: theme.spacing.lg,
            }}
          >
            <View
              style={{
                alignSelf: 'center',
                width: theme.spacing['4xl'],
                height: theme.spacing.xs,
                borderRadius: theme.radii.pill,
                backgroundColor: theme.colors.borderStrong,
              }}
            />
            {children}
          </MotiView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * 7. Screen
 * ------------------------------------------------------------------ */

export function MeetingScreen({ route, navigation }: any) {
  const theme = useAppTheme();
  const { t, i18n } = useTranslation();
  const { width, isPhone } = useResponsive();
  const insets = useSafeAreaInsets();
  const dir = useDirection();
  const userName = useAuth((s) => s.user?.name);
  const refreshBalance = useBalance((s) => s.refresh);
  const setAvailableSeconds = useBalance((s) => s.setAvailableSeconds);

  const params = route?.params ?? {};
  const categoryId = params.categoryId;
  const categoryName: string | undefined = params.categoryName;
  const context = params.context;
  /**
   * The interview language, chosen on the setup screen. Everything the
   * candidate hears, says and is graded on follows it: `/meeting/turn`,
   * `/meeting/finish`, the synthesised voice and the recognizer's locale.
   * Older navigation entries (a deep link, a restored state) carry no value,
   * so it falls back to the app's UI language rather than to a hardcoded 'ar'.
   */
  const language: SpeechLang = params.language === 'en' ? 'en'
    : params.language === 'ar' ? 'ar'
    : (i18n.language === 'en' ? 'en' : 'ar');

  const hrGender: 'male' | 'female' = context?.gender === 'male' ? 'male' : 'female';
  const persona = PERSONA[hrGender];
  const hrName = t(hrGender === 'male' ? 'meeting.hrMaleName' : 'meeting.hrFemaleName');
  const hrRole = t(hrGender === 'male' ? 'meeting.hrMaleRole' : 'meeting.hrFemaleRole');
  const hrAvatar = personaAvatarUrl(hrGender);

  const youInitial = (userName?.trim()?.[0] ?? '?').toUpperCase();

  /* -------------------- refs -------------------- */

  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Re-open-the-mic timer. Everything else about listening belongs to the
   *  recognizer; this is only the pause after the interviewer stops. */
  const resumeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Mirrors the camera's mic flag for callbacks that fire a turn later. */
  const micOnRef = useRef(true);

  const turnsRef = useRef<Turn[]>([]);
  /** The server's billing clock for this call. Threaded through every /turn,
   *  every tick and /finish, so the meter and the conversation stay the same
   *  interview even if the app is backgrounded and resumed. */
  const meetingIdRef = useRef<string | null>(null);
  /** True once the meeting has been settled — by /finish or by /end. Guards
   *  against settling twice when the screen unmounts moments later. */
  const clockClosedRef = useRef(false);
  /**
   * The last balance the server reported and when it arrived. The countdown
   * between heartbeats is interpolated from this pair rather than counted
   * independently, so the display can drift by at most one tick and always
   * snaps back to the server's number.
   */
  const billingAtRef = useRef<{ remaining: number; at: number } | null>(null);
  const startedAtRef = useRef(Date.now());
  const tipCounterRef = useRef(0);
  const stateRef = useRef<MeetingState>('preparing');
  const endedRef = useRef(false);
  const endingRef = useRef(false);
  const startingRef = useRef(false);
  const evaluatingRef = useRef(false);
  const sendUserMessageRef = useRef<(text: string) => void>(() => {});
  const teardownRef = useRef<(opts?: { saveRecording?: boolean }) => void>(() => {});
  /**
   * What an unmount should do with a take that is still being written.
   *
   * Defaults to saving — leaving mid-call (Back, a deep link) must not throw
   * the footage away. `concludeCall` overwrites it first, because "Discard and
   * finish" unmounts the screen milliseconds later and a hardcoded `true` here
   * would hand the candidate back the very file they asked us to drop.
   */
  const saveOnExitRef = useRef(true);

  /* -------------------- state -------------------- */

  const [turns, setTurns] = useState<Turn[]>([]);
  const [tips, setTips] = useState<Tip[]>([]);

  const [thinking, setThinking] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);

  const [elapsed, setElapsed] = useState(0);
  const [meetingState, setMeetingState] = useState<MeetingState>('preparing');
  const [notice, setNotice] = useState<{ text: string; tone: NoticeTone } | null>(null);

  const [captionsOn, setCaptionsOn] = useState(true);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [endPromptOpen, setEndPromptOpen] = useState(false);

  const [evalPhase, setEvalPhase] = useState<EvalPhase>('idle');
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalErrorKind, setEvalErrorKind] = useState<ApiErrorKind>('unknown');

  /** Mirrors `meetingIdRef` as state, purely so the heartbeat effect starts
   *  when a meeting id arrives late — the legacy path where /turn opens the
   *  meeting because /start never ran. */
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [startBlocked, setStartBlocked] = useState<StartBlocked | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  useEffect(() => { stateRef.current = meetingState; }, [meetingState]);

  /**
   * Take the server's meter reading.
   *
   * Called from /start, every tick and every turn — the three responses that
   * carry a `billing` block. It also nudges the app-wide balance so Home is
   * already right when the user lands back on it.
   */
  const rememberMeeting = useCallback((id: string | null) => {
    meetingIdRef.current = id;
    setMeetingId(id);
  }, []);

  const applyBilling = useCallback((next?: Billing | null) => {
    if (!next) return;
    billingAtRef.current = { remaining: next.remainingSeconds, at: Date.now() };
    setBilling(next);
    setAvailableSeconds(next.remainingSeconds);
  }, [setAvailableSeconds]);

  /* -------------------- notices -------------------- */

  const showNotice = useCallback((text: string, tone: NoticeTone = 'info') => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice({ text, tone });
    noticeTimerRef.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  /* -------------------- exit -------------------- */

  /**
   * The screen's own promise: the call is not over until this component is
   * gone, and a recording in flight is saved on the way out.
   *
   * ITS POSITION IN THIS FILE IS THE FIX. React runs unmount destructors in the
   * order their effects were *created*, and each media hook registers its own
   * (`useCamera` → `release()`, `useSessionRecorder` → `release({save})`, …).
   * Declared after the hooks, this cleanup ran last — every hook had already
   * released itself in hook-declaration order, which stops the camera tracks
   * *before* the recorder is asked to flush and truncates or empties the take
   * (contract.ts: "Must be called before the camera/mic tracks are stopped so
   * the encoder can still flush"). Declared here it runs first, so `teardown`
   * is once again the single ordered exit; the per-hook cleanups that follow
   * are no-ops because every `release()` is idempotent.
   *
   * Do not move this below the `useCamera` / `useSessionRecorder` calls.
   *
   * `teardownRef` is filled by an unconditional effect further down, so it is
   * populated by the time this destructor runs.
   */
  useEffect(() => {
    endedRef.current = false;
    return () => {
      teardownRef.current({ saveRecording: saveOnExitRef.current });
      // Leaving mid-call (Back, a deep link, a tab switch on web) must not
      // leave the meter running. `closeClock` is a no-op once /finish has
      // settled, so the ordinary path is unaffected.
      void closeClockRef.current();
    };
  }, []);

  /* -------------------- media -------------------- *
   *
   * Five hooks, one per capture concern, each resolved per platform by Metro.
   * Between them they own every device handle this screen used to hold itself:
   * the stream, the audio graph, the recognizer, the recorder and their
   * teardown order. What is left here is the interview.
   * ------------------------------------------------------------------ */

  const camera = useCamera({
    active: meetingState !== 'ended',
    initialFacing: 'front',
  });

  const voice = useInterviewerVoice({
    /**
     * The one call that bypasses the axios client — it wants the raw audio
     * body, not JSON — and the only reason it stays in the screen: the token
     * lives with the auth store here, not in the media layer.
     */
    fetchServerTts: async ({ text, gender, language: lang }) => {
      const token = await secureStorage.getItem('access_token');
      const res = await fetch(`${API_BASE}/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text, gender, language: lang }),
      });
      if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
      return res.arrayBuffer();
    },
  });

  const meter = useLevelMeter();

  const recorder = useSessionRecorder({
    handle: camera.handle,
    onNotice: (key, tone) => {
      // The recorder reports in keys. Where the file actually lands is the one
      // thing it cannot phrase for us, so the "saved" line is redirected to the
      // wording that matches this platform's delivery.
      const resolved = key === 'recordingSaved' && capabilities.recorder.delivery !== 'download'
        ? 'recordingSavedDevice'
        : key;
      showNotice(t(`meeting.${resolved}`), tone);
    },
  });

  const recognizer = useSpeechRecognizer({
    language,
    silenceMs: SILENCE_MS,
    onFinal: (text) => { if (!endedRef.current) sendUserMessageRef.current(text); },
    onError: (code) => {
      // Permission wording, which is the honest reading of both codes on web.
      // On native a permanent `service-not-allowed` also flips
      // `recognizer.supported`, and the effect watching that flag replaces this
      // notice with the "no speech engine" wording a moment later — the right
      // copy wins without the screen having to branch on platform.
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        showNotice(t(MEDIA_COPY.deniedBody), 'danger');
      }
    },
  });

  // Aliased so the ~200 references below read as call state rather than as
  // plumbing — these are the nine values that used to be `useState` here.
  const { listening, interim } = recognizer;
  const { level } = meter;
  const { recording, elapsedMs: recElapsed } = recorder;
  const {
    enabled: camOn, micEnabled: micOn, ready: streamReady, fault: mediaFault,
  } = camera;

  useEffect(() => { micOnRef.current = micOn; }, [micOn]);

  /* -------------------- turn bookkeeping -------------------- */

  const pushTurn = useCallback((turn: Turn) => {
    turnsRef.current = [...turnsRef.current, turn];
    setTurns(turnsRef.current);
  }, []);

  const historySnapshot = useCallback(
    () => turnsRef.current.map((x) => ({ role: x.role, content: x.content })),
    [],
  );

  /* -------------------- listening -------------------- */

  /**
   * Re-open the mic after the interviewer stops. The delay is what keeps the
   * recognizer from catching the tail of the synthesised voice — on a phone
   * there is no acoustic echo cancellation between the two, so this turn
   * discipline is load-bearing rather than polite.
   */
  const scheduleListen = useCallback(() => {
    if (resumeRef.current) clearTimeout(resumeRef.current);
    resumeRef.current = setTimeout(() => {
      resumeRef.current = null;
      if (endedRef.current || stateRef.current !== 'active') return;
      // Muted while the interviewer was still talking. The recognizer opens its
      // own capture, so nothing but this check keeps a muted mic from listening.
      if (!micOnRef.current) return;
      recognizer.start();
    }, RESUME_LISTEN_MS);
  }, [recognizer]);

  /* -------------------- the interviewer's voice -------------------- */

  /**
   * Voice the interviewer's line and drive the stage while it plays.
   *
   * The media layer decides *how* — a local neural voice first, server TTS
   * second — and reports which one made it through, because only one of them
   * has a waveform the presence ring can be driven from.
   *
   * A failure in either path still calls `onDone`: the conversation carries on
   * silently rather than deadlocking on a voice that never arrives.
   */
  const speak = useCallback(async (line: string, onDone?: () => void) => {
    if (endedRef.current) { setThinking(false); onDone?.(); return; }

    // "Thinking" stays on until audio actually starts: flipping to "speaking"
    // while the voice is still downloading shows a talking avatar in silence.
    setAiSpeaking(false);
    meter.stop();

    const outcome = await voice.speak({
      text: line,
      lang: language,
      gender: hrGender,
      onStart: (by, analysable) => {
        if (endedRef.current) return;
        setThinking(false);
        setAiSpeaking(true);
        // Only the server-TTS element plays through a stream there is anything
        // to measure; every other path rides the synthesised envelope.
        if (by === 'server-tts') meter.startTtsWaveform(analysable);
        else meter.startEnvelope();
      },
      onEnd: () => {
        setAiSpeaking(false);
        meter.stop();
        if (!endedRef.current) onDone?.();
      },
    });

    setThinking(false);
    // `heard: false` means nothing reached the speaker and no `onEnd` is coming,
    // so the turn has to be advanced from here or the interview stalls on a
    // line nobody ever hears.
    if (!outcome.heard) {
      setAiSpeaking(false);
      meter.stop();
      if (!endedRef.current) onDone?.();
    }
  }, [hrGender, language, meter, voice]);

  /* -------------------- session recording -------------------- */

  const toggleRecording = useCallback(() => {
    if (recording) { void recorder.stop({ save: true }); return; }
    // Where the preview *is* the recorder, there is nothing to record with the
    // camera off — say so rather than fail on tap.
    if (capabilities.recorder.locksCameraControls && !camOn) {
      showNotice(t('meeting.recordNeedsCamera'), 'info');
      return;
    }
    void recorder.start();
  }, [camOn, recorder, recording, showNotice, t]);

  /* -------------------- teardown -------------------- */

  /**
   * The one place media is released. Everything that can hold the camera light
   * on, keep a recognizer listening, or keep audio playing is stopped here, and
   * the order is load-bearing: handlers off before anything is aborted, the
   * recorder flushed before the source it is writing from disappears, the
   * camera last because its light must not outlive the call.
   */
  const teardown = useCallback((opts?: { saveRecording?: boolean }) => {
    endedRef.current = true;

    recognizer.release();
    if (resumeRef.current) { clearTimeout(resumeRef.current); resumeRef.current = null; }
    if (noticeTimerRef.current) { clearTimeout(noticeTimerRef.current); noticeTimerRef.current = null; }

    voice.release();
    meter.release();
    recorder.release({ save: opts?.saveRecording ?? true });
    camera.release();
  }, [camera, meter, recognizer, recorder, voice]);

  useEffect(() => { teardownRef.current = teardown; });

  /* -------------------- media init -------------------- *
   *
   * Acquisition, the ended-while-prompting race and the retry that must not
   * leave two captures live all belong to `useCamera` now. The unmount promise
   * that used to live here has moved *above* the hook calls — see the "exit"
   * block; its position is load-bearing.
   * ------------------------------------------------------------------ */

  /**
   * Warm the voice list while the candidate is still reading the start screen.
   * The list is empty on a cold engine and only fills asynchronously; paying
   * that wait here rather than on the interviewer's opening line is the
   * difference between an instant greeting and a second of dead air.
   */
  const { warmUp: warmUpVoice } = voice;
  useEffect(() => { void warmUpVoice(); }, [warmUpVoice]);

  /**
   * A camera fault raised *after* the call started.
   *
   * Only native can reach this — `onMountError` fires whenever the device
   * refuses to (re)open a session — and the answer there is a notice, not the
   * full-screen wall: the interview is still running, the recognizer is still
   * on the candidate's voice, and replacing the UI would strand all of it. The
   * self-view drops to its placeholder by itself, since `Preview` renders no
   * capture while `fault` is set. `stateRef` rather than `meetingState` so a
   * later state change does not re-announce a fault already reported.
   */
  useEffect(() => {
    if (!mediaFault) return;
    if (stateRef.current === 'preparing' || stateRef.current === 'ended') return;
    showNotice(
      t(mediaFault === 'denied' ? MEDIA_COPY.deniedBody : MEDIA_COPY.unsupportedBody),
      'danger',
    );
  }, [mediaFault, showNotice, t]);

  /**
   * Speech recognition dying mid-call.
   *
   * `supported` is a constant on web but real state on native: the recognizer
   * flips it false when the engine reports `service-not-allowed`, or when
   * `start()` throws often enough to count as broken. Sampling it once in
   * `startMeeting` therefore missed the only case that matters — the candidate
   * loses the mic *during* the interview, the "Tap to talk" pill quietly
   * disappears, and the LIVE chip keeps counting over a call they can no longer
   * take part in. This reacts to the flip, and the banner below it stays on
   * screen (a toast would be gone in 5.5s) with the way out.
   */
  const sttOk = recognizer.supported;
  useEffect(() => {
    if (sttOk) return;
    if (stateRef.current === 'preparing' || stateRef.current === 'ended') return;
    showNotice(t(MEDIA_COPY.sttUnsupported), 'danger');
  }, [sttOk, showNotice, t]);

  // Elapsed timer only runs while the interview is actually running. It also
  // paces the countdown re-render, which is why it stays at one second.
  useEffect(() => {
    if (meetingState !== 'active' && meetingState !== 'closing') return undefined;
    const id = setInterval(() => setElapsed(Date.now() - startedAtRef.current), 1000);
    return () => clearInterval(id);
  }, [meetingState]);

  /* -------------------- the billing heartbeat -------------------- *
   *
   * The clock the user is charged by. It carries no AI and no payload: it just
   * tells the server "I am still here", and the server bills the wall-clock
   * between two heartbeats. A gap larger than the server's tolerance is billed
   * at ZERO rather than clamped — so a dead network, a locked phone or a
   * backgrounded app costs nothing, and the seconds show up on the receipt as
   * time we did not charge for.
   *
   * That also means a failed tick needs no recovery here: the seconds land on
   * the next one, and the server decides whether they were real.
   * ------------------------------------------------------------------ */
  const tickSeconds = billing?.tickSeconds;
  useEffect(() => {
    if (meetingState !== 'active' && meetingState !== 'closing') return undefined;
    if (!meetingId) return undefined;

    // The interval the SERVER asked for (`meeting_tick_seconds`, tunable
    // without a deploy), with a floor so a bad value cannot hammer the endpoint
    // into its rate limit — a 429'd tick is a gap, and a gap is billed at zero.
    // The 15 is only a fallback for a response that carried no billing block;
    // it is a timer, never a number shown to anyone.
    const period = Math.max(5, tickSeconds ?? 15) * 1000;
    const id = setInterval(async () => {
      if (endedRef.current) return;
      try {
        const { data } = await api.post(`/meeting/${meetingId}/tick`);
        applyBilling(data?.billing);
      } catch (err) {
        if (apiErrorKind(err) === 'expired') {
          showNotice(t('meeting.expired'), 'danger');
          concludeRef.current({ saveRecording: true });
        }
      }
    }, period);
    return () => clearInterval(id);
  }, [meetingId, meetingState, tickSeconds, applyBilling, showNotice, t]);

  /* -------------------- conversation -------------------- */

  const runTurn = useCallback(async (
    history: { role: TurnRole; content: string }[],
    userMessage: string,
  ): Promise<boolean> => {
    setThinking(true);
    try {
      const { data } = await api.post('/meeting/turn', {
        categoryId, history, userMessage, language, context,
        // Omitted only if /start never succeeded. The server then binds the
        // turn to whatever live meeting this account already has, and opens a
        // balance-checked one if there is none — so the interview survives a
        // failed /start, and omitting the field is never the cheaper path.
        ...(meetingIdRef.current ? { meetingId: meetingIdRef.current } : null),
      });
      if (endedRef.current) { setThinking(false); return true; }

      if (data?.meetingId) rememberMeeting(String(data.meetingId));
      applyBilling(data?.billing);

      const reply: string = data?.reply ?? '';
      pushTurn({ role: 'assistant', content: reply, at: Date.now() });

      if (Array.isArray(data?.tips) && data.tips.length) {
        const now = Date.now();
        const fresh: Tip[] = data.tips.map((text: string) => ({
          id: ++tipCounterRef.current, text, at: now,
        }));
        setTips((prev) => [...fresh, ...prev].slice(0, 8));
      }

      const closing = data?.status === 'closing';
      if (closing) setMeetingState('closing');

      // `thinking` is cleared by `speak` the moment the voice starts, so the
      // avatar never sits in a silent "speaking" state while TTS downloads.
      void speak(reply, () => {
        if (closing) concludeRef.current({ saveRecording: true });
        else scheduleListen();
      });
      return true;
    } catch (err: any) {
      setThinking(false);
      if (endedRef.current) return false;

      const kind = apiErrorKind(err);

      // The meeting was settled underneath us (the app was away long enough
      // for the sweeper to close it). Nothing is recoverable in this call, but
      // the conversation so far is still worth evaluating — and /finish is
      // free and never refused.
      if (kind === 'expired') {
        showNotice(t('meeting.expired'), 'danger');
        concludeRef.current({ saveRecording: true });
        return false;
      }

      // Out of minutes. The server has already served its goodwill closing
      // turn by the time it returns this, so the interview is over: end into
      // the evaluation rather than leaving the user on a stalled stage. With
      // no turns at all there is nothing to evaluate, so the pre-call wall is
      // shown instead.
      if (kind === 'quota') {
        if (turnsRef.current.length === 0) {
          setStartBlocked(quotaDetails(err));
          setMeetingState('preparing');
          return false;
        }
        showNotice(apiErrorMessage(err, t('meeting.quotaBody')), 'danger');
        concludeRef.current({ saveRecording: true });
        return false;
      }

      showNotice(apiErrorMessage(err, t('meeting.turnFailed')), 'danger');
      return false;
    }
  }, [applyBilling, categoryId, context, language, pushTurn, rememberMeeting,
    scheduleListen, showNotice, speak, t]);

  const sendUserMessage = useCallback((text: string) => {
    // History is snapshotted *before* the new line is appended: the server
    // receives `history` plus `userMessage`, so appending first would send the
    // candidate's answer twice.
    const history = historySnapshot();
    pushTurn({ role: 'user', content: text, at: Date.now() });
    void runTurn(history, text);
  }, [historySnapshot, pushTurn, runTurn]);

  useEffect(() => { sendUserMessageRef.current = sendUserMessage; }, [sendUserMessage]);

  const startMeeting = useCallback(async () => {
    if (startingRef.current || stateRef.current !== 'preparing') return;
    if (!camera.ready) { showNotice(t(MEDIA_COPY.deniedBody), 'danger'); return; }
    startingRef.current = true;
    setStartBlocked(null);

    /**
     * Open the billing clock BEFORE the first model call.
     *
     * Two things happen here that cannot happen anywhere else: a new account's
     * free trial is granted (lazily, on first use), and the server refuses an
     * interview it cannot fund. Refusing up front is the kinder failure — a
     * call that dies eight seconds in is worse than one that never opened, and
     * this one explains itself with the server's own numbers.
     */
    try {
      const { data } = await api.post('/meeting/start', {
        categoryId,
        client: capabilities.platform,
        // The id THIS screen is already holding, if any — the server resumes
        // only a meeting the client can name. Presenting nothing means "a new
        // interview", and the server then settles and closes anything else
        // still live on the account: one live meeting per user is what stops
        // two tabs from spending one wall-clock between them.
        ...(meetingIdRef.current ? { resumeMeetingId: meetingIdRef.current } : null),
      });
      rememberMeeting(data?.meetingId ? String(data.meetingId) : null);
      clockClosedRef.current = false;
      applyBilling(data?.billing);
    } catch (err: any) {
      if (apiErrorKind(err) === 'quota') {
        // The one refusal that must stop the call before it opens.
        setStartBlocked(quotaDetails(err));
        startingRef.current = false;
        return;
      }
      // Anything else (offline, 5xx) must NOT block the interview: /turn opens
      // a metered meeting when it receives no id — with the same balance check
      // this call just failed to reach — so the interview still goes ahead.
      rememberMeeting(null);
      showNotice(apiErrorMessage(err, t('meeting.turnFailed')), 'danger');
    }

    startedAtRef.current = Date.now();
    setElapsed(0);
    setMeetingState('active');
    // A device with no recognizer at all is a supported path, not an edge case:
    // the interview still runs, the candidate just cannot answer out loud.
    if (!recognizer.supported) showNotice(t(MEDIA_COPY.sttUnsupported), 'danger');

    const ok = await runTurn([], '');
    startingRef.current = false;
    if (!ok && !endedRef.current) setMeetingState('preparing');
  }, [applyBilling, camera.ready, categoryId, recognizer.supported, rememberMeeting,
    runTurn, showNotice, t]);

  /* -------------------- ending -------------------- */

  /**
   * Settle the meeting without an evaluation.
   *
   * Used when the call produced too little to evaluate, so `/finish` will never
   * be called and the meeting would otherwise sit `live` — holding minutes the
   * user cannot spend — until the sweeper reaches it. Best-effort: the sweeper
   * is the backstop, so a failure here is not worth telling anyone about.
   */
  const closeClock = useCallback(async () => {
    // The REF, not the state: this runs from an unmount destructor, where a
    // stale closure over state would settle the wrong meeting or none at all.
    const id = meetingIdRef.current;
    if (!id || clockClosedRef.current) return;
    clockClosedRef.current = true;
    try {
      await api.post(`/meeting/${id}/end`);
    } catch {
      /* the server's sweeper settles it within the abandon window */
    }
    refreshBalance().catch(() => {});
  }, [refreshBalance]);

  const closeClockRef = useRef(closeClock);
  useEffect(() => { closeClockRef.current = closeClock; });

  const requestEvaluation = useCallback(async () => {
    if (evaluatingRef.current) return;
    const history = historySnapshot();
    if (history.length < 2) {
      setEvalPhase('none');
      void closeClock();
      return;
    }

    evaluatingRef.current = true;
    setEvalPhase('loading');
    setEvalError(null);
    setEvalErrorKind('unknown');
    try {
      const { data } = await api.post('/meeting/finish', {
        categoryId, history, language, context,
        ...(meetingIdRef.current ? { meetingId: meetingIdRef.current } : null),
      });
      // /finish settles the meeting itself, so the clock is closed even though
      // this screen never called /end.
      clockClosedRef.current = true;
      setEvaluation(data?.evaluation ?? null);
      setEvalPhase(data?.evaluation ? 'ready' : 'none');
      // The receipt. `skippedSeconds` is the whole trust argument for billing
      // by time, printed on the user's own bill.
      setReceipt(data?.billing ?? null);
      refreshBalance().catch(() => {});
    } catch (err: any) {
      setEvalErrorKind(apiErrorKind(err));
      setEvalError(apiErrorMessage(err, t('meeting.evalFailedBody')));
      setEvalPhase('error');
    } finally {
      evaluatingRef.current = false;
    }
  }, [categoryId, closeClock, context, historySnapshot, language, refreshBalance, t]);

  const leaveScreen = useCallback(() => {
    if (navigation?.canGoBack?.()) navigation.goBack();
    else navigation?.navigate?.('Main');
  }, [navigation]);

  /**
   * Buy minutes without hanging up.
   *
   * This is a stack PUSH, so the meeting screen stays mounted: the camera, the
   * recognizer and the heartbeat all keep running behind the store, and a
   * top-up that completes simply raises the balance the next tick reads. Ending
   * the call to sell someone something is how you lose both.
   */
  const goBuyMinutes = useCallback(() => {
    navigation?.navigate?.('Subscription');
  }, [navigation]);

  /**
   * The single exit path. Guarded so a double-tap on "end" cannot bill a
   * second `/meeting/finish`, and reachable from every state.
   */
  const concludeCall = useCallback((opts: { saveRecording: boolean }) => {
    setEndPromptOpen(false);
    if (endingRef.current) return;
    endingRef.current = true;
    endedRef.current = true;

    const hadTurns = turnsRef.current.length > 0;
    // Remembered before teardown: with no turns the screen unmounts in this
    // same tick, and the unmount cleanup would otherwise re-arm a save over the
    // discard the candidate just chose.
    saveOnExitRef.current = opts.saveRecording;
    teardownRef.current({ saveRecording: opts.saveRecording });

    if (!hadTurns) {
      // Nothing to evaluate, so no /finish is coming — settle the clock here
      // or the reservation sits out the whole abandon window.
      void closeClockRef.current();
      leaveScreen();
      return;
    }

    setMeetingState('ended');
    void requestEvaluation();
  }, [leaveScreen, requestEvaluation]);

  const concludeRef = useRef(concludeCall);
  useEffect(() => { concludeRef.current = concludeCall; }, [concludeCall]);

  const requestEnd = useCallback(() => {
    if (endingRef.current) return;
    setEndPromptOpen(true);
  }, []);

  /* -------------------- media controls -------------------- */

  const toggleMic = useCallback(() => {
    const next = !micOn;
    camera.setMicEnabled(next);

    if (!next) {
      recognizer.stop();
      return;
    }
    if (stateRef.current === 'active' && !aiSpeaking && !thinking) recognizer.start();
  }, [aiSpeaking, camera, micOn, recognizer, thinking]);

  const toggleCam = useCallback(() => {
    // Where the camera view *is* the recorder, switching it off ends the take —
    // so the control explains itself instead of quietly losing the footage.
    if (recording && !capabilities.camera.canToggleWhileRecording) {
      showNotice(t('meeting.camLockedWhileRecording'), 'info');
      return;
    }
    camera.setEnabled(!camOn);
  }, [camOn, camera, recording, showNotice, t]);

  /* -------------------- derived -------------------- */

  const presence: Presence =
    aiSpeaking ? 'speaking'
    : thinking ? 'thinking'
    : listening ? 'listening'
    : 'idle';

  const canTalkNow =
    meetingState === 'active' && micOn && !listening && !thinking && !aiSpeaking
    && recognizer.supported;

  /**
   * What the record button cannot say on its own. A recording that turns out to
   * be silent is only acceptable if the candidate knew before they started it,
   * so this sits under the control bar rather than in a dialog afterwards.
   */
  const recordFootnote =
    !capabilities.recorder.available ? t('meeting.recordUnsupported')
    : !capabilities.recorder.capturesMicAudio ? t('meeting.recordVideoOnly')
    : null;

  const avatarSize = clamp(width * VIDEO.avatarRatio, VIDEO.avatarMin, VIDEO.avatarMax);
  const pipW = clamp(width * VIDEO.pipRatio, VIDEO.pipMin, VIDEO.pipMax);
  const pipH = pipW * VIDEO.pipAspect;

  const controlGap = isPhone ? theme.spacing.xs : theme.spacing.md;
  const barPadH = isPhone ? theme.spacing.sm : theme.spacing.lg;
  const controlBarHeight =
    theme.layout.control.lg
    + theme.spacing.xxs
    + theme.typography.scale.micro.lineHeight
    + theme.spacing.sm * 2;

  const topChromeHeight = insets.top + theme.layout.control.md + theme.spacing.xl;
  const bottomChromeHeight = insets.bottom + theme.spacing.lg + controlBarHeight + theme.spacing.md;

  const captionLines = useMemo(() => turns.slice(-2), [turns]);

  const stateChip = useMemo(() => {
    if (meetingState === 'preparing') return { label: t('meeting.statePreparing'), color: STAGE.warn };
    if (meetingState === 'closing') return { label: t('meeting.stateClosing'), color: STAGE.warn };
    if (meetingState === 'ended') return { label: t('meeting.stateEnded'), color: STAGE.inkFaint };
    return { label: t('meeting.stateLive'), color: STAGE.live };
  }, [meetingState, t]);

  /* -------------------- the countdown -------------------- *
   *
   * Interpolated between heartbeats from the last reading the SERVER sent,
   * never counted independently: the display can only walk down from the
   * server's number until the next tick corrects it. `elapsed` re-renders this
   * every second while the call is live.
   * ------------------------------------------------------------------ */
  const lastReading = billingAtRef.current;
  const remainingSeconds = !lastReading
    ? null
    : meetingState === 'active' || meetingState === 'closing'
      ? Math.max(0, lastReading.remaining - Math.floor((Date.now() - lastReading.at) / 1000))
      : lastReading.remaining;

  // The chip shows what is left, not what has passed: during a metered call the
  // remaining balance is the number the candidate needs. Elapsed time is on the
  // receipt afterwards, from the server's own count.
  const clockLabel = remainingSeconds !== null
    ? t('meeting.remaining', { clock: formatClock(remainingSeconds) })
    : formatDuration(elapsed);
  const lowOnTime = !!billing && (billing.warn || billing.exhausted);

  /* ================================================================ *
   * Render — no camera or microphone
   * ================================================================ */

  /**
   * Pre-call only, and that condition is the fix rather than a tidy-up.
   *
   * On web `fault` can only ever be set inside acquisition, so this wall was
   * unreachable once the call was running. On native `onMountError` raises
   * `unsupported` at *any* moment — CameraX failing to rebind after a
   * background round trip, another app taking the camera, a remount after the
   * candidate toggles the camera off and on. Rendering this branch then would
   * replace the live call while tearing down nothing: a hot mic still
   * listening, the interviewer still talking, `/meeting/turn` still billing.
   * And because `camera.release()` deliberately leaves `fault` set, an
   * unguarded branch here would also shadow `ResultView` forever — a finished,
   * already-billed evaluation made unreachable by a camera hiccup twenty
   * minutes earlier.
   *
   * A fault raised mid-call is surfaced as a notice instead (see the effect
   * above) and the self-view falls back to its placeholder on its own.
   */
  if (mediaFault && meetingState === 'preparing') {
    const denied = mediaFault === 'denied';
    return (
      <Screen scroll edges={['top', 'bottom']} contentStyle={{ justifyContent: 'center' }}>
        <View style={[styles.center, { gap: theme.spacing.md, paddingVertical: theme.spacing['5xl'] }]}>
          <View
            style={[
              styles.center,
              {
                width: theme.layout.avatar.xl,
                height: theme.layout.avatar.xl,
                borderRadius: theme.radii.pill,
                backgroundColor: theme.colors.dangerMuted,
              },
            ]}
          >
            <Ionicons name="videocam-off" size={theme.layout.icon['2xl']} color={theme.colors.danger} />
          </View>

          <Text role="h2" weight="bold" align="center">
            {denied ? t('meeting.mediaDeniedTitle') : t(MEDIA_COPY.unsupportedTitle)}
          </Text>
          <Text role="body" tone="muted" align="center" style={{ maxWidth: theme.layout.maxContentWidth / 2 }}>
            {denied ? t(MEDIA_COPY.deniedBody) : t(MEDIA_COPY.unsupportedBody)}
          </Text>

          <View style={{ alignSelf: 'stretch', gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
            {denied ? (
              <Button
                title={t('meeting.mediaRetry')}
                onPress={() => { void camera.retry(); }}
                iconLeft={<Ionicons name="refresh" size={theme.layout.icon.md} color={theme.colors.onPrimary} />}
              />
            ) : null}
            <Button title={t('common.back')} variant="ghost" onPress={leaveScreen} />
          </View>
        </View>
      </Screen>
    );
  }

  /* ================================================================ *
   * Render — result
   * ================================================================ */

  if (meetingState === 'ended') {
    return (
      <ResultView
        phase={evalPhase}
        evaluation={evaluation}
        error={evalError}
        errorKind={evalErrorKind}
        onUpgrade={goBuyMinutes}
        categoryName={categoryName}
        // The wall-clock the candidate sat through. What they were CHARGED is a
        // different number and comes from the receipt below — conflating them
        // is exactly the confusion the receipt exists to prevent.
        durationLabel={formatDuration(elapsed)}
        receipt={receipt}
        onRetry={() => { void requestEvaluation(); }}
        onHome={leaveScreen}
      />
    );
  }

  /* ================================================================ *
   * Render — the call
   * ================================================================ */

  return (
    <View style={[styles.fill, { backgroundColor: STAGE.bg }]}>
      {/* Stage backdrop */}
      <LinearGradient
        colors={[STAGE.bg, STAGE.bgDeep]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Stage — the interviewer owns the whole screen. */}
      <View
        style={[
          styles.fill,
          styles.center,
          {
            paddingTop: topChromeHeight,
            paddingBottom: bottomChromeHeight + theme.spacing['5xl'],
            paddingHorizontal: theme.spacing.lg,
          },
        ]}
      >
        <InterviewerStage
          name={hrName}
          role={hrRole}
          gender={hrGender}
          categoryName={categoryName}
          avatarUrl={hrAvatar}
          accent={persona.color}
          presence={presence}
          awaitingStart={meetingState === 'preparing'}
          level={level}
          size={avatarSize}
        />
      </View>

      {/* Top scrim so white chrome stays legible over any backdrop. */}
      <LinearGradient
        pointerEvents="none"
        colors={[STAGE.scrim, STAGE.scrimClear]}
        style={{ position: 'absolute', top: 0, start: 0, end: 0, height: topChromeHeight + theme.spacing['3xl'] }}
      />

      {/* ---------------- top bar ---------------- */}
      <View
        style={[
          styles.row,
          {
            position: 'absolute',
            top: insets.top + theme.spacing.sm,
            start: theme.spacing.lg,
            end: theme.spacing.lg,
            gap: theme.spacing.md,
          },
        ]}
      >
        <Pressable
          onPress={requestEnd}
          accessibilityRole="button"
          accessibilityLabel={t('meeting.minimize')}
          accessibilityHint={t('meeting.ctrlEndHint')}
          hitSlop={theme.spacing.sm}
          style={({ pressed }) => [
            styles.center,
            {
              width: theme.layout.control.sm,
              height: theme.layout.control.sm,
              borderRadius: theme.radii.pill,
              backgroundColor: STAGE.chrome,
              borderWidth: theme.layout.hairline,
              borderColor: STAGE.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons name={dir.chevronBack} size={theme.layout.icon.md} color={STAGE.ink} />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text role="bodySm" weight="bold" tone="inherit" style={{ color: STAGE.ink }} numberOfLines={1}>
            {hrName}
          </Text>
          <Text role="micro" tone="inherit" style={{ color: STAGE.inkMuted }} numberOfLines={1}>
            {hrRole}
          </Text>
        </View>

        <View style={{ alignItems: 'flex-end', gap: theme.spacing.xs }}>
          <StatusChip
            label={`${stateChip.label} · ${clockLabel}`}
            dotColor={lowOnTime ? STAGE.warn : stateChip.color}
            ink={lowOnTime ? STAGE.warnInk : STAGE.ink}
            bg={lowOnTime ? STAGE.warnSoft : STAGE.chrome}
            pulse={meetingState === 'active'}
          />
          {recording ? (
            <StatusChip
              label={`${t('meeting.recBadge')} ${formatDuration(recElapsed)}`}
              dotColor={STAGE.danger}
              ink={STAGE.dangerInk}
              bg={STAGE.dangerSoft}
              pulse
            />
          ) : null}
        </View>
      </View>

      {/* ---------------- self-view (PiP) ---------------- */}
      <View
        style={{
          position: 'absolute',
          top: topChromeHeight + (recording ? theme.spacing['3xl'] : theme.spacing.sm),
          end: theme.spacing.lg,
          width: pipW,
          height: pipH,
          borderRadius: theme.radii.lg,
          overflow: 'hidden',
          backgroundColor: STAGE.tile,
          borderWidth: theme.spacing.xxs,
          borderColor: STAGE.border,
        }}
      >
        {/* The camera-off artwork is a prop rather than a sibling so the
            implementation decides what happens behind it: the browser hides a
            still-mounted element (remounting it drops the stream and comes back
            as a black frame), the device unmounts the capture — which is why
            the camera control locks during a recording there. */}
        <camera.Preview
          style={styles.fill}
          mirrored
          accessibilityLabel={`${t('meeting.you')}${camOn ? '' : ` — ${t('meeting.cameraOffLabel')}`}`}
          placeholder={(
            <View style={[StyleSheet.absoluteFillObject, styles.center, { gap: theme.spacing.xs, backgroundColor: STAGE.tile }]}>
              <View
                style={[
                  styles.center,
                  {
                    width: theme.layout.avatar.md,
                    height: theme.layout.avatar.md,
                    borderRadius: theme.radii.pill,
                    backgroundColor: STAGE.chromeSoft,
                    borderWidth: theme.layout.hairline,
                    borderColor: STAGE.border,
                  },
                ]}
              >
                <Text role="h4" weight="bold" tone="inherit" style={{ color: STAGE.ink }}>
                  {youInitial}
                </Text>
              </View>
              {/* Only when the camera is genuinely off: the same artwork also
                  covers the gap before the first frame arrives, and "camera
                  off" would be a lie while the candidate is still granting it. */}
              {camOn ? null : (
                <View style={[styles.row, { gap: theme.spacing.xxs }]}>
                  <Ionicons name="videocam-off" size={theme.layout.icon.xs} color={STAGE.inkFaint} />
                  <Text role="micro" tone="inherit" style={{ color: STAGE.inkFaint }} numberOfLines={1}>
                    {t('meeting.cameraOffLabel')}
                  </Text>
                </View>
              )}
            </View>
          )}
        />

        <View
          style={[
            styles.row,
            {
              position: 'absolute',
              bottom: theme.spacing.xs,
              start: theme.spacing.xs,
              gap: theme.spacing.xxs,
              paddingVertical: theme.spacing.xxs,
              paddingHorizontal: theme.spacing.sm,
              borderRadius: theme.radii.xs,
              backgroundColor: STAGE.chrome,
            },
          ]}
        >
          {!micOn ? <Ionicons name="mic-off" size={theme.layout.icon.xs} color={STAGE.dangerInk} /> : null}
          <Text role="micro" weight="bold" tone="inherit" style={{ color: STAGE.ink }}>
            {t('meeting.you')}
          </Text>
        </View>
      </View>

      {/* ---------------- lower third: notice + captions + start CTA ------- */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: bottomChromeHeight,
          start: 0,
          end: 0,
          alignItems: 'center',
          paddingHorizontal: theme.spacing.lg,
          gap: theme.spacing.sm,
        }}
      >
        <AnimatePresence>
          {notice ? (
            <MotiView
              key={notice.text}
              from={{ opacity: 0, translateY: theme.spacing.sm }}
              animate={{ opacity: 1, translateY: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'timing', duration: theme.motion.duration.fast }}
              style={{ width: '100%', maxWidth: theme.layout.maxContentWidth }}
            >
              <View
                style={[
                  styles.row,
                  {
                    gap: theme.spacing.sm,
                    padding: theme.spacing.md,
                    borderRadius: theme.radii.md,
                    borderWidth: theme.layout.hairline,
                    backgroundColor: notice.tone === 'danger' ? STAGE.dangerSoft
                      : notice.tone === 'success' ? STAGE.liveSoft : STAGE.chrome,
                    borderColor: notice.tone === 'danger' ? STAGE.dangerBorder : STAGE.border,
                  },
                ]}
              >
                <Ionicons
                  name={notice.tone === 'danger' ? 'alert-circle' : notice.tone === 'success' ? 'checkmark-circle' : 'information-circle'}
                  size={theme.layout.icon.md}
                  color={notice.tone === 'danger' ? STAGE.dangerInk : notice.tone === 'success' ? STAGE.liveInk : STAGE.inkMuted}
                />
                <Text role="bodySm" flex tone="inherit" style={{ color: STAGE.ink }}>
                  {notice.text}
                </Text>
              </View>
            </MotiView>
          ) : null}
        </AnimatePresence>

        {/* ---- the meter, when it has something to say ---- */}
        {startBlocked && meetingState === 'preparing' ? (
          <StageBanner
            icon="alert-circle"
            tone="danger"
            title={t('meeting.startBlockedTitle')}
            body={t('meeting.startBlockedBody', {
              required: durationLabel(startBlocked.requiredSeconds, t),
              balance: balanceLabel(startBlocked.balanceSeconds, t),
            })}
            actionLabel={t('meeting.startBlockedCta')}
            onAction={goBuyMinutes}
          />
        ) : null}

        {billing && (meetingState === 'active' || meetingState === 'closing')
          && (billing.exhausted || billing.warn) ? (
            <StageBanner
              icon={billing.exhausted ? 'hourglass' : 'time-outline'}
              tone="warn"
              title={t(billing.exhausted ? 'meeting.outTitle' : 'meeting.warnTitle')}
              body={billing.exhausted
                ? t(hrGender === 'male' ? 'meeting.outBodyM' : 'meeting.outBodyF')
                : t('meeting.warnBody', {
                  label: balanceLabel(remainingSeconds ?? billing.remainingSeconds, t),
                })}
              actionLabel={t('meeting.buyMore')}
              onAction={goBuyMinutes}
            />
          ) : null}

        {meetingState === 'preparing' ? (
          <View style={{ width: '100%', maxWidth: theme.layout.maxContentWidth, gap: theme.spacing.sm, alignItems: 'center' }}>
            <Text role="bodySm" align="center" tone="inherit" style={{ color: STAGE.inkMuted }}>
              {t('meeting.startHint')}
            </Text>
            <Pressable
              onPress={() => { void startMeeting(); }}
              disabled={!streamReady}
              accessibilityRole="button"
              accessibilityLabel={t('meeting.startCta', { name: hrName })}
              accessibilityState={{ disabled: !streamReady }}
              style={({ pressed }) => [
                styles.row,
                styles.center,
                {
                  gap: theme.spacing.sm,
                  height: theme.layout.control.lg,
                  paddingHorizontal: theme.spacing['2xl'],
                  borderRadius: theme.radii.pill,
                  backgroundColor: streamReady ? STAGE.live : STAGE.chromeDim,
                  opacity: streamReady ? (pressed ? 0.85 : 1) : 0.6,
                },
              ]}
            >
              <Ionicons name="videocam" size={theme.layout.icon.lg} color={STAGE.ink} />
              <Text role="bodyLg" weight="bold" tone="inherit" style={{ color: STAGE.ink }} numberOfLines={1}>
                {streamReady ? t('meeting.startCta', { name: hrName }) : t('meeting.starting')}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {captionsOn && meetingState !== 'preparing' ? (
          <View style={{ width: '100%', maxWidth: theme.layout.maxContentWidth, gap: theme.spacing.xs }}>
            {captionLines.map((turn, i) => {
              const isLast = i === captionLines.length - 1;
              return (
                <MotiView
                  key={turn.at}
                  from={{ opacity: 0, translateY: theme.spacing.sm }}
                  animate={{ opacity: isLast ? 1 : 0.42, translateY: 0 }}
                  transition={{ type: 'timing', duration: theme.motion.duration.normal }}
                >
                  <View
                    style={{
                      padding: theme.spacing.md,
                      borderRadius: theme.radii.md,
                      backgroundColor: STAGE.chrome,
                      borderWidth: theme.layout.hairline,
                      borderColor: STAGE.borderDim,
                      gap: theme.spacing.xxs,
                    }}
                  >
                    <Text role="micro" weight="bold" tone="inherit" style={{ color: STAGE.inkFaint }}>
                      {turn.role === 'assistant' ? hrName : t('meeting.you')}
                    </Text>
                    <Text
                      role={isLast ? 'body' : 'bodySm'}
                      tone="inherit"
                      style={{ color: STAGE.ink }}
                      numberOfLines={isLast ? 4 : 2}
                    >
                      {turn.content}
                    </Text>
                  </View>
                </MotiView>
              );
            })}

            {interim ? (
              <View
                style={[
                  styles.row,
                  {
                    gap: theme.spacing.sm,
                    paddingVertical: theme.spacing.sm,
                    paddingHorizontal: theme.spacing.md,
                    borderRadius: theme.radii.md,
                    backgroundColor: STAGE.liveSoft,
                    borderWidth: theme.layout.hairline,
                    borderColor: STAGE.border,
                  },
                ]}
              >
                <Ionicons name="mic" size={theme.layout.icon.sm} color={STAGE.liveInk} />
                <Text role="bodySm" flex tone="inherit" style={{ color: STAGE.ink }} numberOfLines={2}>
                  {interim}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Recovery affordance: if the recognizer never re-opened on its own,
            this is how the candidate takes their turn back. Outside the
            captions block on purpose — turning captions off must not remove a
            control. */}
        {canTalkNow ? (
          <Pressable
            onPress={() => recognizer.start()}
            accessibilityRole="button"
            accessibilityLabel={t('meeting.resumeListening')}
            style={({ pressed }) => [
              styles.row,
              styles.center,
              {
                alignSelf: 'center',
                gap: theme.spacing.sm,
                height: theme.layout.control.sm,
                paddingHorizontal: theme.spacing.lg,
                borderRadius: theme.radii.pill,
                backgroundColor: STAGE.chromeSoft,
                borderWidth: theme.layout.hairline,
                borderColor: STAGE.border,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Ionicons name="mic" size={theme.layout.icon.sm} color={STAGE.ink} />
            <Text role="bodySm" weight="bold" tone="inherit" style={{ color: STAGE.ink }}>
              {t('meeting.resumeListening')}
            </Text>
          </Pressable>
        ) : null}

        {/* No recognizer — either the browser never had one, or the device's
            engine died mid-call and the hook latched `supported` false. Either
            way the candidate cannot answer out loud any more, so this stays on
            screen instead of a 5.5s toast, and it carries the only useful
            action left: end the call and collect the evaluation for the turns
            that did happen. Mutually exclusive with the pill above, which
            requires `recognizer.supported`. */}
        {!recognizer.supported && (meetingState === 'active' || meetingState === 'closing') ? (
          <Pressable
            onPress={requestEnd}
            accessibilityRole="button"
            accessibilityLabel={t(MEDIA_COPY.sttUnsupported)}
            accessibilityHint={t('meeting.ctrlEndHint')}
            style={({ pressed }) => [
              styles.row,
              {
                width: '100%',
                maxWidth: theme.layout.maxContentWidth,
                gap: theme.spacing.sm,
                padding: theme.spacing.md,
                borderRadius: theme.radii.md,
                borderWidth: theme.layout.hairline,
                backgroundColor: STAGE.dangerSoft,
                borderColor: STAGE.dangerBorder,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Ionicons name="mic-off" size={theme.layout.icon.md} color={STAGE.dangerInk} />
            <View style={{ flex: 1, gap: theme.spacing.xxs }}>
              <Text role="bodySm" tone="inherit" style={{ color: STAGE.ink }}>
                {t(MEDIA_COPY.sttUnsupported)}
              </Text>
              <Text role="micro" weight="bold" tone="inherit" style={{ color: STAGE.dangerInk }}>
                {t('meeting.endConfirm')}
              </Text>
            </View>
          </Pressable>
        ) : null}
      </View>

      {/* ---------------- control bar ---------------- */}
      <LinearGradient
        pointerEvents="none"
        colors={[STAGE.scrimClear, STAGE.scrim]}
        style={{ position: 'absolute', bottom: 0, start: 0, end: 0, height: bottomChromeHeight + theme.spacing['3xl'] }}
      />

      <View
        style={{
          position: 'absolute',
          bottom: insets.bottom + theme.spacing.lg,
          start: 0,
          end: 0,
          alignItems: 'center',
          gap: theme.spacing.xs,
          paddingHorizontal: theme.spacing.sm,
        }}
      >
        <View
          style={[
            styles.row,
            {
              gap: controlGap,
              paddingHorizontal: barPadH,
              paddingVertical: theme.spacing.sm,
              borderRadius: theme.radii.xl,
              backgroundColor: STAGE.chrome,
              borderWidth: theme.layout.hairline,
              borderColor: STAGE.border,
              alignItems: 'flex-start',
            },
          ]}
        >
          <ControlButton
            icon={micOn ? 'mic' : 'mic-off'}
            tone={micOn ? 'default' : 'muted'}
            label={t('meeting.ctrlMic')}
            a11yLabel={micOn ? t('meeting.ctrlMicMute') : t('meeting.ctrlMicUnmute')}
            onPress={toggleMic}
          />
          <ControlButton
            icon={camOn ? 'videocam' : 'videocam-off'}
            tone={camOn ? 'default' : 'muted'}
            label={t('meeting.ctrlCamera')}
            a11yLabel={camOn ? t('meeting.ctrlCameraOff') : t('meeting.ctrlCameraOn')}
            onPress={toggleCam}
          />
          <ControlButton
            icon={recording ? 'stop' : 'radio-button-on'}
            tone={recording ? 'recording' : 'default'}
            label={capabilities.recorder.available
              ? (recording ? t('meeting.ctrlRecordStop') : t('meeting.ctrlRecord'))
              : t('meeting.ctrlRecordUnavailable')}
            a11yLabel={recording ? t('meeting.ctrlRecordSave') : t('meeting.ctrlRecordStart')}
            a11yHint={recordFootnote ?? undefined}
            disabled={!capabilities.recorder.available || !streamReady}
            onPress={toggleRecording}
          />
          <ControlButton
            icon="bulb"
            label={t('meeting.ctrlTips')}
            a11yLabel={t('meeting.ctrlTipsOpen')}
            onPress={() => setTipsOpen(true)}
          />
          <ControlButton
            icon="call"
            rotateIcon="135deg"
            tone="end"
            wide
            label={t('meeting.ctrlEnd')}
            a11yLabel={t('meeting.ctrlEnd')}
            a11yHint={t('meeting.ctrlEndHint')}
            onPress={requestEnd}
          />
        </View>

        {recordFootnote ? (
          <Text role="micro" align="center" tone="inherit" style={{ color: STAGE.inkFaint }}>
            {recordFootnote}
          </Text>
        ) : null}
      </View>

      {/* ---------------- tips + captions sheet ---------------- */}
      <Sheet visible={tipsOpen} onClose={() => setTipsOpen(false)} maxWidth={theme.layout.maxContentWidth}>
        <View style={[styles.row, { gap: theme.spacing.md }]}>
          <View
            style={[
              styles.center,
              {
                width: theme.layout.avatar.sm,
                height: theme.layout.avatar.sm,
                borderRadius: theme.radii.pill,
                backgroundColor: theme.colors.accentMuted,
              },
            ]}
          >
            <Ionicons name="sparkles" size={theme.layout.icon.md} color={theme.colors.accentText} />
          </View>
          <View style={{ flex: 1 }}>
            <Text role="h4" weight="bold">{t('meeting.tipsTitle')}</Text>
            <Text role="caption" tone="muted">{t('meeting.tipsSubtitle')}</Text>
          </View>
          <Pressable
            onPress={() => setTipsOpen(false)}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            hitSlop={theme.spacing.sm}
            style={({ pressed }) => [
              styles.center,
              {
                width: theme.layout.control.sm,
                height: theme.layout.control.sm,
                borderRadius: theme.radii.pill,
                backgroundColor: theme.colors.surfaceSunken,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons name="close" size={theme.layout.icon.md} color={theme.colors.textSecondary} />
          </Pressable>
        </View>

        <Pressable
          onPress={() => setCaptionsOn((v) => !v)}
          accessibilityRole="switch"
          accessibilityLabel={t('meeting.captions')}
          accessibilityState={{ checked: captionsOn }}
          style={({ pressed }) => [
            styles.row,
            {
              gap: theme.spacing.md,
              padding: theme.spacing.md,
              borderRadius: theme.radii.md,
              borderWidth: theme.layout.hairline,
              borderColor: captionsOn ? theme.colors.primaryBorder : theme.colors.border,
              backgroundColor: captionsOn ? theme.colors.primaryMuted : theme.colors.surfaceSunken,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Ionicons
            name={captionsOn ? 'chatbox-ellipses' : 'chatbox-outline'}
            size={theme.layout.icon.md}
            color={captionsOn ? theme.colors.primary : theme.colors.textMuted}
          />
          <View style={{ flex: 1 }}>
            <Text role="bodySm" weight="bold">{t('meeting.captions')}</Text>
            <Text role="micro" tone="muted">{t('meeting.captionsHint')}</Text>
          </View>
          <Badge
            label={captionsOn ? t('meeting.captionsOn') : t('meeting.captionsOff')}
            tone={captionsOn ? 'primary' : 'neutral'}
          />
        </Pressable>

        <ScrollView
          style={{ maxHeight: theme.layout.maxContentWidth / 2 }}
          contentContainerStyle={{ gap: theme.spacing.sm }}
          showsVerticalScrollIndicator={false}
        >
          {tips.length === 0 ? (
            <Card variant="filled" padding="md" style={{ gap: theme.spacing.xs }}>
              <Text role="bodySm" weight="bold">{t('meeting.tipsEmptyTitle')}</Text>
              <Text role="caption" tone="muted">{t('meeting.tipsEmptyBody')}</Text>
            </Card>
          ) : (
            tips.map((tip, idx) => (
              <MotiView
                key={tip.id}
                from={{ opacity: 0, translateY: theme.spacing.sm }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'timing', duration: theme.motion.duration.normal, delay: idx * theme.motion.stagger }}
              >
                <View
                  style={[
                    styles.row,
                    {
                      gap: theme.spacing.sm,
                      alignItems: 'flex-start',
                      padding: theme.spacing.md,
                      borderRadius: theme.radii.md,
                      backgroundColor: theme.colors.accentMuted,
                      borderWidth: theme.layout.hairline,
                      borderColor: theme.colors.accentBorder,
                    },
                  ]}
                >
                  <Ionicons name="bulb" size={theme.layout.icon.sm} color={theme.colors.accentText} />
                  <Text role="bodySm" flex>{tip.text}</Text>
                </View>
              </MotiView>
            ))
          )}
        </ScrollView>
      </Sheet>

      {/* ---------------- end-call confirmation ---------------- */}
      <Sheet visible={endPromptOpen} onClose={() => setEndPromptOpen(false)} maxWidth={theme.layout.maxContentWidth}>
        <View style={{ gap: theme.spacing.sm }}>
          <View style={[styles.row, { gap: theme.spacing.md }]}>
            <View
              style={[
                styles.center,
                {
                  width: theme.layout.avatar.md,
                  height: theme.layout.avatar.md,
                  borderRadius: theme.radii.pill,
                  backgroundColor: theme.colors.dangerMuted,
                },
              ]}
            >
              <Ionicons name="call" size={theme.layout.icon.lg} color={theme.colors.danger} style={{ transform: [{ rotate: '135deg' }] }} />
            </View>
            <View style={{ flex: 1 }}>
              <Text role="h4" weight="bold">{t('meeting.endTitle')}</Text>
              <Text role="bodySm" tone="muted">
                {recording ? t('meeting.endBodyRecording') : t('meeting.endBody')}
              </Text>
            </View>
          </View>

          <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
            {recording ? (
              <>
                <Button
                  title={t('meeting.endSaveAndFinish')}
                  variant="danger"
                  onPress={() => concludeCall({ saveRecording: true })}
                  iconLeft={<Ionicons name="download-outline" size={theme.layout.icon.md} color={theme.colors.onBrandText} />}
                />
                <Button
                  title={t('meeting.endDiscardAndFinish')}
                  variant="outline"
                  onPress={() => concludeCall({ saveRecording: false })}
                />
              </>
            ) : (
              <Button
                title={t('meeting.endConfirm')}
                variant="danger"
                onPress={() => concludeCall({ saveRecording: true })}
              />
            )}
            <Button title={t('meeting.stay')} variant="ghost" onPress={() => setEndPromptOpen(false)} />
          </View>
        </View>
      </Sheet>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * 8. Result view
 * ------------------------------------------------------------------ */

function ResultView({
  phase, evaluation, error, errorKind = 'unknown', categoryName,
  durationLabel: wallClockLabel, receipt, onRetry, onHome, onUpgrade,
}: {
  phase: EvalPhase;
  evaluation: Evaluation | null;
  error: string | null;
  errorKind?: ApiErrorKind;
  onUpgrade?: () => void;
  categoryName?: string;
  /** Wall-clock spent on the call, from the client's own display timer. */
  durationLabel: string;
  /** What was actually charged, from the server. Null for a legacy meeting. */
  receipt: Receipt | null;
  onRetry: () => void;
  onHome: () => void;
}) {
  const theme = useAppTheme();
  const { t } = useTranslation();

  if (phase === 'loading' || phase === 'idle') {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={[styles.fill, styles.center, { gap: theme.spacing.md }]}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text role="h4" weight="bold" align="center">{t('meeting.evaluating')}</Text>
          <Text role="bodySm" tone="muted" align="center" style={{ maxWidth: theme.layout.maxContentWidth / 2 }}>
            {t('meeting.evaluatingHint')}
          </Text>
        </View>
      </Screen>
    );
  }

  if (phase === 'none' || phase === 'error') {
    const isError = phase === 'error';
    // Running out of free questions is not a failure — it is a paywall, and it
    // needs a route forward rather than a Retry that repeats the same 402.
    const isQuota = isError && (errorKind === 'quota' || errorKind === 'premium');
    return (
      <Screen scroll edges={['top', 'bottom']} contentStyle={{ justifyContent: 'center' }}>
        <View style={[styles.center, { gap: theme.spacing.md, paddingVertical: theme.spacing['5xl'] }]}>
          <View
            style={[
              styles.center,
              {
                width: theme.layout.avatar.xl,
                height: theme.layout.avatar.xl,
                borderRadius: theme.radii.pill,
                backgroundColor: isQuota
                  ? theme.colors.accentMuted
                  : isError ? theme.colors.dangerMuted : theme.colors.surfaceSunken,
              },
            ]}
          >
            <Ionicons
              name={isQuota ? 'sparkles-outline' : isError ? 'cloud-offline-outline' : 'time-outline'}
              size={theme.layout.icon['2xl']}
              color={isQuota ? theme.colors.accentText : isError ? theme.colors.danger : theme.colors.textMuted}
            />
          </View>
          <Text role="h3" weight="bold" align="center">
            {isQuota
              ? t('meeting.quotaTitle')
              : isError ? t('meeting.evalFailedTitle') : t('meeting.noEvalTitle')}
          </Text>
          <Text role="bodySm" tone="muted" align="center" style={{ maxWidth: theme.layout.maxContentWidth / 2 }}>
            {isQuota
              ? t('meeting.quotaBody')
              : isError ? (error ?? t('meeting.evalFailedBody')) : t('meeting.noEvalBody')}
          </Text>
          <View style={{ alignSelf: 'stretch', gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
            {isQuota ? (
              <Button
                title={t('meeting.quotaCta')}
                variant="accent"
                onPress={onUpgrade}
                iconLeft={<Ionicons name="star" size={theme.layout.icon.md} color={theme.colors.onAccent} />}
              />
            ) : isError ? (
              <Button title={t('meeting.mediaRetry')} onPress={onRetry} />
            ) : null}
            <Button title={t('meeting.backHome')} variant={isError ? 'ghost' : 'primary'} onPress={onHome} />
          </View>
        </View>
      </Screen>
    );
  }

  const score = Number(evaluation?.overall_score ?? 0);
  const strengths = evaluation?.strengths ?? [];
  const weaknesses = evaluation?.weaknesses ?? [];

  return (
    <Screen scroll edges={['top', 'bottom']} contentStyle={{ gap: theme.spacing.lg, paddingTop: theme.spacing.lg }}>
      <View style={{ gap: theme.spacing.xs }}>
        <Badge label={t('meeting.resultKicker')} tone="success" icon="checkmark-circle" />
        <Text role="h1" weight="bold">{t('meeting.resultTitle')}</Text>
        <Text role="bodySm" tone="muted">
          {[categoryName, wallClockLabel].filter(Boolean).join(' · ')}
        </Text>
      </View>

      {/* ---------------------------- the receipt ----------------------------
          The charged duration, the seconds we deliberately did NOT charge, and
          what is left. The middle line is the entire trust argument for billing
          by time: it tells the candidate, on their own bill, that the meter
          stopped when the interview did. */}
      {receipt ? (
        <Card variant="outlined" padding="lg" style={{ gap: theme.spacing.xs }}>
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            <Ionicons name="receipt-outline" size={theme.layout.icon.md} color={theme.colors.textMuted} />
            <Text role="h4" weight="bold">{t('meeting.receiptTitle')}</Text>
          </View>
          <Text role="bodySm">
            {t('meeting.receiptBilled', { label: durationLabel(receipt.billedSeconds, t) })}
          </Text>
          {receipt.skippedSeconds > 0 ? (
            <Text role="bodySm" tone="success">
              {t('meeting.receiptSkipped', { label: durationLabel(receipt.skippedSeconds, t) })}
            </Text>
          ) : null}
          <Text role="bodySm" tone="secondary">
            {t('meeting.receiptRemaining', { label: balanceLabel(receipt.remainingSeconds, t) })}
          </Text>
          <Text role="caption" tone="muted">{t('meeting.receiptFreeEval')}</Text>
        </Card>
      ) : null}

      <Card padding="lg" style={{ alignItems: 'center', gap: theme.spacing.md }}>
        <ScoreRing score={score} size={theme.layout.avatar.xl + theme.spacing['3xl']} label={t('meeting.overallScore')} />
        {evaluation?.summary ? (
          <Text role="body" align="center">{evaluation.summary}</Text>
        ) : null}
      </Card>

      {strengths.length ? (
        <Card padding="lg" style={{ gap: theme.spacing.sm }}>
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            <Ionicons name="trending-up" size={theme.layout.icon.md} color={theme.colors.success} />
            <Text role="h4" weight="bold">{t('meeting.strengths')}</Text>
          </View>
          {strengths.map((s, i) => (
            <View key={i} style={[styles.row, { gap: theme.spacing.sm, alignItems: 'flex-start' }]}>
              <Ionicons name="checkmark-circle" size={theme.layout.icon.sm} color={theme.colors.success} />
              <Text role="bodySm" flex>{s}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      {weaknesses.length ? (
        <Card padding="lg" style={{ gap: theme.spacing.sm }}>
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            <Ionicons name="construct-outline" size={theme.layout.icon.md} color={theme.colors.warning} />
            <Text role="h4" weight="bold">{t('meeting.weaknesses')}</Text>
          </View>
          {weaknesses.map((s, i) => (
            <View key={i} style={[styles.row, { gap: theme.spacing.sm, alignItems: 'flex-start' }]}>
              <Ionicons name="ellipse" size={theme.layout.icon.xs} color={theme.colors.warning} />
              <Text role="bodySm" flex>{s}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      {evaluation?.advice ? (
        <Card padding="lg" style={{ gap: theme.spacing.sm }}>
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            <Ionicons name="bulb" size={theme.layout.icon.md} color={theme.colors.primary} />
            <Text role="h4" weight="bold">{t('meeting.advice')}</Text>
          </View>
          <Text role="bodySm">{evaluation.advice}</Text>
        </Card>
      ) : null}

      <Button title={t('meeting.backHome')} onPress={onHome} size="lg" />
    </Screen>
  );
}

/* ------------------------------------------------------------------ *
 * 9. Layout-only styles. Anything with a colour, size or spacing value
 *    is applied inline from the theme so it stays token-driven.
 * ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end' },
  sheetStop: { width: '100%', alignSelf: 'center' },
});
