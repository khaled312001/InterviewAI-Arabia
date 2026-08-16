/**
 * Live mock interview — the "call" screen.
 *
 * This is a video-call surface, not a form: a full-bleed stage with the AI
 * interviewer at its centre, floating chrome (top bar, self-view, captions,
 * control bar) composited on top, and every panel that would steal the stage
 * demoted to a bottom sheet.
 *
 * How a turn works
 *   1. Web SpeechRecognition stays open continuously; the utterance is only
 *      committed after `SILENCE_MS` of quiet, so thinking pauses don't cut the
 *      candidate off mid-sentence.
 *   2. The committed text goes to `/meeting/turn`, which replies with the
 *      interviewer's next line plus coaching tips for the *next* answer.
 *   3. The reply is spoken by the browser's own neural voice
 *      (`speechSynthesis` — see `src/speech/webSpeech.ts`), which starts
 *      immediately and needs no round-trip of ours. Server TTS remains as the
 *      fallback for engines with no usable voice for the interview language;
 *      that path is piped through a Web Audio analyser so the avatar's
 *      presence ring breathes with the real waveform.
 *
 * Language
 *   Chosen before the call on MeetingSetupScreen and carried in
 *   `route.params.language`. It drives the questions, the voice, the
 *   recognizer locale and the final evaluation — everything, not just copy.
 *
 * Platform
 *   The whole flow depends on `getUserMedia`, `MediaRecorder` and
 *   `webkitSpeechRecognition`, none of which exist in React Native on Android
 *   or iOS. Rather than render a screen whose every control is dead, native
 *   gets a designed "web only" state with a link to the web build.
 *
 * Session recording
 *   `MediaRecorder` over the camera+mic stream (with the interviewer's voice
 *   mixed in when the audio graph allows it), saved as a .webm download so the
 *   candidate can review their own performance. Chunks live in a ref — putting
 *   them in state would re-render the entire call UI on every `dataavailable`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, StyleSheet, Pressable, Platform, ScrollView, ActivityIndicator,
  Modal, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView, AnimatePresence } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';

import { api, API_BASE } from '../api/client';
import { secureStorage } from '../storage/secureStorage';
import { useAuth } from '../store/auth';
import { useAppTheme, useResponsive, useDirection } from '../theme/useTheme';
import { Screen, Text, Button, Card, Badge, ScoreRing } from '../components';
import {
  SPEECH_LOCALE, cancelBrowserSpeech, loadVoices, speakWithBrowserVoice,
  speechSynthesisSupported,
} from '../speech/webSpeech';
import type { SpeechLang } from '../speech/webSpeech';
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

/** How long after the last transcription event we treat the user as done. */
const SILENCE_MS = 2500;
/** Pause before re-opening the mic after the interviewer stops speaking. */
const RESUME_LISTEN_MS = 500;
/** How long a transient notice stays on the stage. */
const NOTICE_MS = 5500;
/** Voice-envelope sampling: emit at most ~16fps, and only on a real change.
 *  Emitting every animation frame re-rendered the whole call UI 60×/s. */
const LEVEL_EMIT_MS = 60;
const LEVEL_EMIT_DELTA = 0.04;
/**
 * `speechSynthesis` plays through the OS, not through a MediaStream, so there
 * is no waveform to analyse while a neural voice is talking. The presence ring
 * rides a synthesised envelope instead — sampled at the same rate as the real
 * analyser so the two paths look identical on stage. Smoothing keeps it from
 * flickering; the sine term gives it the loose periodicity of speech rather
 * than the jitter of pure noise.
 */
const ENVELOPE_SMOOTHING = 0.55;
const ENVELOPE_FLOOR = 0.34;
const ENVELOPE_SWING = 0.44;
const ENVELOPE_NOISE = 0.18;
/** Recorder timeslice — flushes a chunk every second so an abrupt teardown
 *  loses at most one second of footage. */
const REC_TIMESLICE_MS = 1000;
/** Object URLs are revoked after the browser has had time to start the save. */
const BLOB_URL_TTL_MS = 60_000;
/**
 * How long we wait for `MediaRecorder.onstop` before saving what we already
 * have. Ending a call stops the camera/mic tracks in the same synchronous
 * block as `rec.stop()` — the camera light must not outlive the call — and a
 * recorder whose source tracks die mid-flush can fail to emit `onstop` at all.
 * Without this the candidate's footage would be silently dropped.
 */
const REC_STOP_GRACE_MS = 1200;

/** Preference order for the recording container/codec. */
const REC_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

const WEB_APP_URL =
  ((Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.webAppUrl as string | undefined)
  ?? 'https://interview.khaledahmed.net';

const SR: any = Platform.OS === 'web' && typeof window !== 'undefined'
  ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  : null;

/* ------------------------------------------------------------------ *
 * 3. Types + helpers
 * ------------------------------------------------------------------ */

type TurnRole = 'assistant' | 'user';
interface Turn { role: TurnRole; content: string; at: number }
interface Tip { id: number; text: string; at: number }

type MeetingState = 'preparing' | 'active' | 'closing' | 'ended';
type Presence = 'idle' | 'listening' | 'thinking' | 'speaking';
type EvalPhase = 'idle' | 'loading' | 'ready' | 'none' | 'error';
type MediaFault = 'denied' | 'unsupported';
type NoticeTone = 'info' | 'danger' | 'success';

interface Evaluation {
  overall_score?: number;
  summary?: string;
  strengths?: string[];
  weaknesses?: string[];
  advice?: string;
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

/** `thiqty-interview-2026-08-16-1435.webm` */
function recordingFileName() {
  const d = new Date();
  return `thiqty-interview-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}.webm`;
}

/**
 * What this browser can record.
 * `mimeType: ''` means "MediaRecorder exists but cannot be asked about
 * types" — the browser picks its own container in that case.
 */
function detectRecorderSupport(): { supported: boolean; mimeType: string } {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return { supported: false, mimeType: '' };
  const MR = (window as any).MediaRecorder as typeof MediaRecorder | undefined;
  if (!MR) return { supported: false, mimeType: '' };
  if (typeof MR.isTypeSupported !== 'function') return { supported: true, mimeType: '' };
  for (const mime of REC_MIME_CANDIDATES) {
    try {
      if (MR.isTypeSupported(mime)) return { supported: true, mimeType: mime };
    } catch {
      /* isTypeSupported can throw on malformed strings in older engines */
    }
  }
  return { supported: false, mimeType: '' };
}

function apiErrorMessage(err: any, fallback: string): string {
  return err?.response?.data?.error || err?.message || fallback;
}

/**
 * The API's stable error identifier, e.g. QUOTA_EXCEEDED / AI_UNAVAILABLE /
 * PREMIUM_REQUIRED. Falls back to the HTTP status when an older build of the
 * server is still deployed and has no `code` in the body.
 */
type ApiErrorKind = 'quota' | 'premium' | 'ai' | 'unknown';

function apiErrorKind(err: any): ApiErrorKind {
  const code = err?.response?.data?.code;
  if (code === 'QUOTA_EXCEEDED') return 'quota';
  if (code === 'PREMIUM_REQUIRED') return 'premium';
  if (code === 'AI_UNAVAILABLE') return 'ai';
  const status = err?.response?.status;
  if (status === 402) return 'quota';
  if (status === 503 || status === 502) return 'ai';
  return 'unknown';
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
          {Platform.OS === 'web' ? (
            // @ts-ignore — the DiceBear avatar is an SVG served over HTTP; a
            // plain <img> renders it without pulling in an SVG loader.
            <img
              src={avatarUrl}
              alt={name}
              width={size}
              height={size}
              style={{ width: size, height: size, display: 'block' }}
            />
          ) : (
            <Text role="display" weight="bold" tone="inherit" style={{ color: STAGE.ink }}>
              {name.slice(0, 1)}
            </Text>
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

  const params = route?.params ?? {};
  const categoryId = params.categoryId;
  const categoryName: string | undefined = params.categoryName;
  const context = params.context;
  /**
   * The interview language, chosen on the setup screen. Everything the
   * candidate hears, says and is graded on follows it: `/meeting/turn`,
   * `/meeting/finish`, the synthesised voice and `SpeechRecognition.lang`.
   * Older navigation entries (a deep link, a restored state) carry no value,
   * so it falls back to the app's UI language rather than to a hardcoded 'ar'.
   */
  const language: SpeechLang = params.language === 'en' ? 'en'
    : params.language === 'ar' ? 'ar'
    : (i18n.language === 'en' ? 'en' : 'ar');

  const isWeb = Platform.OS === 'web';
  const hrGender: 'male' | 'female' = context?.gender === 'male' ? 'male' : 'female';
  const persona = PERSONA[hrGender];
  const hrName = t(hrGender === 'male' ? 'meeting.hrMaleName' : 'meeting.hrFemaleName');
  const hrRole = t(hrGender === 'male' ? 'meeting.hrMaleRole' : 'meeting.hrFemaleRole');
  const hrAvatar = personaAvatarUrl(hrGender);

  const youInitial = (userName?.trim()?.[0] ?? '?').toUpperCase();
  const recorderSupport = useMemo(detectRecorderSupport, []);

  /* -------------------- refs -------------------- */

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  /** The element source feeding `analyserRef`. Held so the pair can be
   *  disconnected: a `MediaElementAudioSourceNode` left wired to
   *  `ctx.destination` keeps itself and its <audio> element alive, so one
   *  orphaned chain per interview turn would accumulate over a long call. */
  const ttsSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const levelAnimRef = useRef<number | null>(null);
  const lastLevelRef = useRef({ at: 0, value: 0 });
  /** Timer behind the synthesised envelope used while `speechSynthesis` talks. */
  const envelopeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const mixDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const tabSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  /** Screen-capture stream, when the browser grants one. Separate from the
   *  camera stream so teardown can release both independently. */
  const displayStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recSaveRef = useRef(true);
  const recStartedAtRef = useRef<number | null>(null);
  /** True between `rec.stop()` and its `onstop`, so a second teardown pass
   *  cannot flush the same chunks into a second download. */
  const recStoppingRef = useRef(false);
  /** Safety net for a recorder whose `onstop` never arrives — see
   *  `stopRecording`. Cleared by `finalizeRecording`. */
  const recStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accumulatedFinalRef = useRef('');

  const turnsRef = useRef<Turn[]>([]);
  const startedAtRef = useRef(Date.now());
  const tipCounterRef = useRef(0);
  const micOnRef = useRef(true);
  const stateRef = useRef<MeetingState>('preparing');
  const endedRef = useRef(false);
  const endingRef = useRef(false);
  const startingRef = useRef(false);
  const evaluatingRef = useRef(false);
  const sendUserMessageRef = useRef<(text: string) => void>(() => {});
  const teardownRef = useRef<(opts?: { saveRecording?: boolean }) => void>(() => {});

  /* -------------------- state -------------------- */

  const [turns, setTurns] = useState<Turn[]>([]);
  const [tips, setTips] = useState<Tip[]>([]);
  const [interim, setInterim] = useState('');
  const [level, setLevel] = useState(0);

  const [thinking, setThinking] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [streamReady, setStreamReady] = useState(false);

  const [recording, setRecording] = useState(false);
  const [recElapsed, setRecElapsed] = useState(0);

  const [elapsed, setElapsed] = useState(0);
  const [meetingState, setMeetingState] = useState<MeetingState>('preparing');
  const [mediaFault, setMediaFault] = useState<MediaFault | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: NoticeTone } | null>(null);

  const [captionsOn, setCaptionsOn] = useState(true);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [endPromptOpen, setEndPromptOpen] = useState(false);

  const [evalPhase, setEvalPhase] = useState<EvalPhase>('idle');
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalErrorKind, setEvalErrorKind] = useState<ApiErrorKind>('unknown');

  useEffect(() => { micOnRef.current = micOn; }, [micOn]);
  useEffect(() => { stateRef.current = meetingState; }, [meetingState]);

  /* -------------------- notices -------------------- */

  const showNotice = useCallback((text: string, tone: NoticeTone = 'info') => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice({ text, tone });
    noticeTimerRef.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  /* -------------------- turn bookkeeping -------------------- */

  const pushTurn = useCallback((turn: Turn) => {
    turnsRef.current = [...turnsRef.current, turn];
    setTurns(turnsRef.current);
  }, []);

  const historySnapshot = useCallback(
    () => turnsRef.current.map((x) => ({ role: x.role, content: x.content })),
    [],
  );

  /* -------------------- speech recognition -------------------- */

  const stopRecognition = useCallback(() => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (resumeTimerRef.current) { clearTimeout(resumeTimerRef.current); resumeTimerRef.current = null; }

    const rec = recognitionRef.current;
    recognitionRef.current = null;
    accumulatedFinalRef.current = '';

    if (rec) {
      // Detach first: a deliberate stop (mute, end call) must not commit a
      // half-finished utterance through `onend`.
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      rec.onspeechstart = null;
      try { rec.abort?.(); } catch { /* not implemented everywhere */ }
      try { rec.stop?.(); } catch { /* already stopped */ }
    }

    setListening(false);
    setInterim('');
  }, []);

  const startRecognition = useCallback(() => {
    if (!SR || endedRef.current || !micOnRef.current) return;
    if (recognitionRef.current) return; // already open

    const rec = new SR();
    // The recognizer must be on the same locale as the interview, or an
    // English answer gets transcribed as Arabic phonetics and scored as noise.
    rec.lang = SPEECH_LOCALE[language];
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    accumulatedFinalRef.current = '';

    const armSilence = () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        if (accumulatedFinalRef.current.trim()) {
          // Let `onend` commit — that is the single place an utterance is sent.
          try { rec.stop(); } catch { /* noop */ }
        }
      }, SILENCE_MS);
    };

    rec.onresult = (e: any) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) accumulatedFinalRef.current += `${r[0].transcript} `;
        else interimText += r[0].transcript;
      }
      setInterim(interimText);
      armSilence();
    };

    rec.onspeechstart = () => {
      if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    };

    rec.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      setInterim('');
      if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
      const final = accumulatedFinalRef.current.trim();
      accumulatedFinalRef.current = '';
      if (final && !endedRef.current) sendUserMessageRef.current(final);
    };

    rec.onerror = (e: any) => {
      setListening(false);
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
        showNotice(t('meeting.mediaDeniedBody'), 'danger');
      }
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setListening(false);
    }
  }, [language, showNotice, t]);

  const scheduleListen = useCallback(() => {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => {
      resumeTimerRef.current = null;
      if (endedRef.current) return;
      if (stateRef.current !== 'active') return;
      startRecognition();
    }, RESUME_LISTEN_MS);
  }, [startRecognition]);

  /* -------------------- audio graph + TTS -------------------- */

  const ensureAudioContext = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    if (!audioCtxRef.current) {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return null;
      try { audioCtxRef.current = new Ctx(); } catch { return null; }
    }
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }, []);

  /** Stops both envelope sources — the real analyser loop and the synthesised
   *  one — so whichever voice path was running, the ring settles. */
  const stopLevelMeter = useCallback(() => {
    if (levelAnimRef.current !== null) {
      cancelAnimationFrame(levelAnimRef.current);
      levelAnimRef.current = null;
    }
    if (envelopeTimerRef.current !== null) {
      clearInterval(envelopeTimerRef.current);
      envelopeTimerRef.current = null;
    }
    lastLevelRef.current = { at: 0, value: 0 };
    setLevel(0);
  }, []);

  /**
   * Presence ring for the `speechSynthesis` path. The browser voice plays
   * straight to the OS mixer, so there is no MediaStream to run an analyser
   * over — the ring rides a smoothed pseudo-envelope for as long as the
   * utterance is active. It is decoration, not measurement, and it is labelled
   * as such so nobody later mistakes it for a real level.
   */
  const startEnvelopeMeter = useCallback(() => {
    if (envelopeTimerRef.current !== null) clearInterval(envelopeTimerRef.current);
    let phase = 0;
    let value = ENVELOPE_FLOOR;
    envelopeTimerRef.current = setInterval(() => {
      phase += 1;
      const target =
        ENVELOPE_FLOOR
        + Math.abs(Math.sin(phase * 0.7)) * ENVELOPE_SWING
        + Math.random() * ENVELOPE_NOISE;
      value = value * ENVELOPE_SMOOTHING + target * (1 - ENVELOPE_SMOOTHING);
      setLevel(Math.min(1, value));
    }, LEVEL_EMIT_MS);
  }, []);

  const startLevelMeter = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    // Only one loop may own `levelAnimRef`; a second would leak the first's
    // frame id and leave it running against a dead analyser forever.
    if (levelAnimRef.current !== null) {
      cancelAnimationFrame(levelAnimRef.current);
      levelAnimRef.current = null;
    }
    const buf = new Uint8Array(analyser.fftSize);

    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sumSq += v * v;
      }
      const next = Math.min(1, Math.sqrt(sumSq / buf.length) * 6);

      // Throttled: re-rendering the whole call UI 60×/s to move a ring is the
      // difference between a smooth call and a stuttering one.
      const now = Date.now();
      const last = lastLevelRef.current;
      if (now - last.at >= LEVEL_EMIT_MS && Math.abs(next - last.value) >= LEVEL_EMIT_DELTA) {
        lastLevelRef.current = { at: now, value: next };
        setLevel(next);
      }
      levelAnimRef.current = requestAnimationFrame(tick);
    };

    levelAnimRef.current = requestAnimationFrame(tick);
  }, []);

  const stopSpeech = useCallback(() => {
    // Browser voice first: `cancel()` also invalidates the pending utterance's
    // callbacks, so a torn-down call cannot advance the interview from a line
    // that is being cut off mid-word.
    cancelBrowserSpeech();

    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.onplay = null;
      audio.onended = null;
      audio.onerror = null;
      try { audio.pause(); } catch { /* noop */ }
      try { audio.removeAttribute('src'); } catch { /* noop */ }
      try { audio.load(); } catch { /* noop */ }
    }

    // Unwire this turn's audio graph. Once an <audio> element is routed
    // through `createMediaElementSource`, pausing it is not enough on its own
    // to guarantee silence — the graph is the only path to the speakers, and
    // it must be torn down or every turn leaves a live chain behind.
    const src = ttsSourceRef.current;
    ttsSourceRef.current = null;
    if (src) { try { src.disconnect(); } catch { /* noop */ } }
    const analyser = analyserRef.current;
    analyserRef.current = null;
    if (analyser) { try { analyser.disconnect(); } catch { /* noop */ } }

    const url = audioUrlRef.current;
    audioUrlRef.current = null;
    if (url) { try { URL.revokeObjectURL(url); } catch { /* noop */ } }
    stopLevelMeter();
    setAiSpeaking(false);
  }, [stopLevelMeter]);

  /**
   * Voice the interviewer's line.
   *
   * Two paths, in order of preference:
   *   1. `speechSynthesis` — a local neural voice, speaking within
   *      milliseconds. This is the path that fixed "الصوت كأن روبوت".
   *   2. `POST /api/tts` — the Google-Translate-scraping fallback, for
   *      browsers with no usable voice for this language. Kept because a
   *      missing voice must never stall the interview.
   *
   * A failure in either path still calls `onDone`: the conversation carries on
   * silently rather than deadlocking on a voice that never arrives.
   */
  const speak = useCallback(async (line: string, onDone?: () => void) => {
    if (!isWeb || endedRef.current) { setThinking(false); onDone?.(); return; }

    // "Thinking" stays on until audio actually starts: flipping to "speaking"
    // while the voice is still downloading shows a talking avatar in silence.
    stopSpeech();

    if (speechSynthesisSupported()) {
      // Resolves true only once sound is actually leaving the speaker, so a
      // false here means nothing was heard and the fallback cannot double the
      // line.
      const spoken = await speakWithBrowserVoice({
        text: line,
        lang: language,
        gender: hrGender,
        onStart: () => {
          if (endedRef.current) return;
          setThinking(false);
          setAiSpeaking(true);
          startEnvelopeMeter();
        },
        onEnd: () => {
          setAiSpeaking(false);
          stopLevelMeter();
          if (!endedRef.current) onDone?.();
        },
      });
      if (endedRef.current) { setThinking(false); setAiSpeaking(false); return; }
      if (spoken) { setThinking(false); return; }
    }

    try {
      const token = await secureStorage.getItem('access_token');
      const res = await fetch(`${API_BASE}/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text: line, gender: hrGender, language }),
      });
      if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);

      const blob = await res.blob();
      if (endedRef.current) { setThinking(false); setAiSpeaking(false); return; }

      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;

      const audio = new Audio(url);
      audio.crossOrigin = 'anonymous';
      audioRef.current = audio;

      // Route through an analyser so the presence ring can breathe with the
      // voice, and into the recording mix when a recording is running.
      try {
        const ctx = ensureAudioContext();
        if (ctx) {
          const src = ctx.createMediaElementSource(audio);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.6;
          src.connect(analyser);
          analyser.connect(ctx.destination);
          if (mixDestRef.current) analyser.connect(mixDestRef.current);
          ttsSourceRef.current = src;
          analyserRef.current = analyser;
        }
      } catch {
        // Analyser wiring is optional — playback still works without it.
      }

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        setAiSpeaking(false);
        stopLevelMeter();
        if (audioUrlRef.current === url) {
          audioUrlRef.current = null;
          try { URL.revokeObjectURL(url); } catch { /* noop */ }
        }
        if (!endedRef.current) onDone?.();
      };

      audio.onplay = () => {
        setThinking(false);
        setAiSpeaking(true);
        startLevelMeter();
      };
      audio.onended = finish;
      audio.onerror = finish;
      await audio.play();
      setThinking(false);
    } catch {
      setThinking(false);
      setAiSpeaking(false);
      stopLevelMeter();
      // A missing voice must never block the interview — carry on silently.
      if (!endedRef.current) onDone?.();
    }
  }, [
    isWeb, hrGender, language, ensureAudioContext,
    startEnvelopeMeter, startLevelMeter, stopLevelMeter, stopSpeech,
  ]);

  /* -------------------- session recording -------------------- */

  const finalizeRecording = useCallback((save: boolean) => {
    // Safe to call twice: the second pass sees no session and returns quietly
    // instead of saving a duplicate file or crying "nothing was captured".
    const wasRecording = recStartedAtRef.current !== null || chunksRef.current.length > 0;
    recStoppingRef.current = false;
    if (recStopTimerRef.current) { clearTimeout(recStopTimerRef.current); recStopTimerRef.current = null; }

    const chunks = chunksRef.current;
    chunksRef.current = [];
    recStartedAtRef.current = null;
    setRecording(false);
    setRecElapsed(0);

    // Detach the mic from the mixing graph so the node is not left running,
    // and end the synthetic track the mix produced — it is a MediaStreamTrack
    // like any other and would otherwise stay live until the AudioContext
    // closes at the end of the call.
    try { micSourceRef.current?.disconnect(); } catch { /* noop */ }
    micSourceRef.current = null;
    try { tabSourceRef.current?.disconnect(); } catch { /* noop */ }
    tabSourceRef.current = null;
    // Release the screen-capture tracks as well. Leaving them live keeps the
    // browser's "you are sharing your screen" bar up after the call ended.
    try {
      displayStreamRef.current?.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
    } catch { /* noop */ }
    displayStreamRef.current = null;
    const dest = mixDestRef.current;
    mixDestRef.current = null;
    if (dest) {
      try { dest.disconnect(); } catch { /* noop */ }
      dest.stream.getTracks().forEach((track) => { try { track.stop(); } catch { /* noop */ } });
    }

    if (!save || !wasRecording) return;
    if (!chunks.length) { showNotice(t('meeting.recordingEmpty'), 'danger'); return; }
    if (typeof document === 'undefined') return;

    try {
      const blob = new Blob(chunks, { type: recorderSupport.mimeType || 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = recordingFileName();
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoking immediately cancels the save in some engines; the URL is
      // released once the browser has certainly taken the bytes.
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* noop */ } }, BLOB_URL_TTL_MS);
      showNotice(t('meeting.recordingSaved'), 'success');
    } catch {
      showNotice(t('meeting.recordFailed'), 'danger');
    }
  }, [recorderSupport.mimeType, showNotice, t]);

  const stopRecording = useCallback((save: boolean) => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (!rec) {
      // Nothing running — flush only if a stop is not already in flight.
      if (!recStoppingRef.current && chunksRef.current.length) finalizeRecording(save);
      return;
    }
    recSaveRef.current = save;
    try {
      if (rec.state !== 'inactive') {
        recStoppingRef.current = true;
        try { rec.requestData(); } catch { /* not supported everywhere */ }
        rec.stop(); // `onstop` finalizes

        // …unless it doesn't. Teardown stops the camera/mic tracks in the same
        // synchronous block — the camera light must not outlive the call — and
        // a recorder that loses its input mid-flush can go quiet without ever
        // firing `onstop`, silently losing the take. So on the teardown path
        // only, save what we already have if `onstop` misses its window.
        //
        // Deliberately NOT armed for a mid-call stop (the record button): there
        // the tracks stay live, `onstop` is certain to arrive, and finalizing
        // early would truncate the last second of footage for no reason.
        // `finalizeRecording` empties the chunk buffer, so whichever path runs
        // first wins and a late `onstop` cannot produce a second download.
        if (endedRef.current) {
          if (recStopTimerRef.current) clearTimeout(recStopTimerRef.current);
          recStopTimerRef.current = setTimeout(() => {
            recStopTimerRef.current = null;
            if (recStoppingRef.current) finalizeRecording(recSaveRef.current);
          }, REC_STOP_GRACE_MS);
        }
      } else {
        finalizeRecording(save);
      }
    } catch {
      recStoppingRef.current = false;
      finalizeRecording(save);
    }
  }, [finalizeRecording]);

  /**
   * Camera + mic, with the interviewer's voice mixed in when the Web Audio
   * graph is available. Any failure falls back to the raw camera+mic stream
   * so a recording is never silently lost to a mixing problem.
   */
  /**
   * Assemble what actually gets recorded.
   *
   * `base` is the camera+mic stream. When `display` is supplied (screen
   * capture) its video replaces the webcam, so the review file shows the whole
   * call — interviewer, captions and the candidate's PiP — rather than just a
   * head-and-shoulders crop. Audio is always mixed through a Web Audio graph so
   * the candidate's microphone and any captured tab audio land on one track;
   * MediaRecorder will only encode a single audio track, so handing it two
   * would silently drop one.
   *
   * Note on the interviewer's voice: the server-TTS fallback plays through an
   * <audio> element that `speak` wires straight into `mixDestRef`, so it is
   * always in the take. The browser neural voice does not go through Web Audio
   * at all — `speechSynthesis` has no MediaStream — so it reaches the recording
   * only via the captured tab/system audio the user grants in the share dialog.
   */
  const buildRecordingStream = useCallback(
    (base: MediaStream, display?: MediaStream | null): MediaStream => {
      const video = display?.getVideoTracks().length
        ? display.getVideoTracks()
        : base.getVideoTracks();

      try {
        const ctx = ensureAudioContext();
        const sources: MediaStream[] = [];
        if (base.getAudioTracks().length) sources.push(base);
        if (display?.getAudioTracks().length) sources.push(display);

        if (!ctx || sources.length === 0) {
          return new MediaStream([...video, ...base.getAudioTracks()]);
        }

        const dest = ctx.createMediaStreamDestination();
        // Connected to the mix only, never to ctx.destination — routing these
        // back to the speakers would echo the candidate at themselves and
        // feed the interviewer's own voice into a loop.
        const micSource = ctx.createMediaStreamSource(sources[0]);
        micSource.connect(dest);
        if (sources[1]) {
          const tabSource = ctx.createMediaStreamSource(sources[1]);
          tabSource.connect(dest);
          tabSourceRef.current = tabSource;
        }

        const mixedAudio = dest.stream.getAudioTracks();
        if (!mixedAudio.length) return new MediaStream([...video, ...base.getAudioTracks()]);

        mixDestRef.current = dest;
        micSourceRef.current = micSource;
        return new MediaStream([...video, ...mixedAudio]);
      } catch {
        return new MediaStream([...video, ...base.getAudioTracks()]);
      }
    },
    [ensureAudioContext],
  );

  const startRecording = useCallback(async () => {
    if (recorderRef.current) return;
    if (!recorderSupport.supported) { showNotice(t('meeting.recordUnsupported'), 'danger'); return; }
    const base = streamRef.current;
    if (!base) { showNotice(t('meeting.recordFailed'), 'danger'); return; }

    try {
      const MR = (window as any).MediaRecorder as typeof MediaRecorder;

      // Capture the whole call, not just the webcam: getDisplayMedia records
      // the tab/screen, so the interviewer, the live captions and the
      // candidate's own picture-in-picture are all in the review file. The
      // camera-only stream is the fallback when the browser has no screen
      // capture or the user dismisses the picker.
      let stream: MediaStream;
      let display: MediaStream | null = null;
      const md: any = navigator?.mediaDevices;
      if (md?.getDisplayMedia) {
        try {
          display = await md.getDisplayMedia({
            video: { frameRate: 30 },
            // Tab audio where the browser offers it — that carries the
            // interviewer's synthesised voice.
            audio: true,
          });
        } catch {
          display = null; // dismissed or blocked — fall back below
        }
      }

      if (display) {
        // Mix the microphone into the display capture so the candidate's own
        // answers are audible; display audio alone would only carry the
        // interviewer.
        stream = buildRecordingStream(base, display);
        displayStreamRef.current = display;
        // Ending the share from the browser's own "Stop sharing" bar must stop
        // our recorder too, or it keeps writing a frozen frame.
        const track = display.getVideoTracks()[0];
        if (track) track.onended = () => { stopRecording(true); };
      } else {
        stream = buildRecordingStream(base);
        showNotice(t('meeting.recordCameraOnly'), 'info');
      }
      const rec = recorderSupport.mimeType
        ? new MR(stream, { mimeType: recorderSupport.mimeType })
        : new MR(stream);

      chunksRef.current = [];
      recSaveRef.current = true;

      rec.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => { finalizeRecording(recSaveRef.current); };
      rec.onerror = () => {
        // Route through the one stop path rather than hand-rolling a second
        // one: that is what arms the `onstop` grace timer, so a recorder that
        // errors *and* never fires `onstop` still releases its buffer and its
        // mixing nodes instead of pinning `recStoppingRef` on forever.
        showNotice(t('meeting.recordFailed'), 'danger');
        stopRecording(false); // a broken take is discarded, not handed over
      };

      rec.start(REC_TIMESLICE_MS);
      recorderRef.current = rec;
      recStartedAtRef.current = Date.now();
      setRecElapsed(0);
      setRecording(true);
      showNotice(t('meeting.recordingStarted'), 'success');
    } catch {
      recorderRef.current = null;
      showNotice(t('meeting.recordFailed'), 'danger');
    }
  }, [buildRecordingStream, finalizeRecording, recorderSupport, showNotice, stopRecording, t]);

  const toggleRecording = useCallback(() => {
    if (recording) stopRecording(true);
    else void startRecording();
  }, [recording, startRecording, stopRecording]);

  /* -------------------- teardown -------------------- */

  /**
   * The one place media is released. Everything that can hold the camera
   * light on, keep a recognizer listening, or keep audio playing is stopped
   * here, in an order that lets the recorder flush before its tracks die.
   */
  const teardown = useCallback((opts?: { saveRecording?: boolean }) => {
    endedRef.current = true;

    stopRecognition();
    if (noticeTimerRef.current) { clearTimeout(noticeTimerRef.current); noticeTimerRef.current = null; }

    stopSpeech();
    stopLevelMeter();

    // Before the tracks: a recorder whose source tracks have ended cannot
    // flush its final chunk.
    stopRecording(opts?.saveRecording ?? true);

    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => { try { track.stop(); } catch { /* noop */ } });

    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      } catch { /* noop */ }
    }

    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    analyserRef.current = null;
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
  }, [stopLevelMeter, stopRecognition, stopRecording, stopSpeech]);

  useEffect(() => { teardownRef.current = teardown; });

  /* -------------------- media init -------------------- */

  const acquireMedia = useCallback(async () => {
    if (!isWeb) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMediaFault('unsupported');
      return;
    }
    setMediaFault(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: true,
      });
      if (endedRef.current) {
        stream.getTracks().forEach((tr) => { try { tr.stop(); } catch { /* noop */ } });
        return;
      }
      // Retry after a denial can race a stream that arrived late; releasing the
      // previous one first is what keeps the camera light honest.
      const previous = streamRef.current;
      if (previous && previous !== stream) {
        previous.getTracks().forEach((tr) => { try { tr.stop(); } catch { /* noop */ } });
      }
      streamRef.current = stream;
      stream.getAudioTracks().forEach((tr) => { tr.enabled = micOnRef.current; });
      setStreamReady(true);
    } catch {
      setMediaFault('denied');
    }
  }, [isWeb]);

  useEffect(() => {
    if (!isWeb) return undefined;
    endedRef.current = false;
    void acquireMedia();
    return () => { teardownRef.current({ saveRecording: true }); };
  }, [isWeb, acquireMedia]);

  /**
   * Warm the voice list while the candidate is still reading the start screen.
   * `getVoices()` is empty on a cold page and only fills after `voiceschanged`;
   * paying that wait here rather than on the interviewer's opening line is the
   * difference between an instant greeting and a second of dead air.
   */
  useEffect(() => {
    if (!isWeb) return;
    void loadVoices();
  }, [isWeb]);

  // Attach / re-attach the preview whenever the stream or camera state changes.
  useEffect(() => {
    if (!isWeb || !streamReady) return;
    const el = videoRef.current;
    const stream = streamRef.current;
    if (!el || !stream) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    el.play().catch(() => {});
  }, [isWeb, streamReady, camOn, meetingState]);

  // Elapsed timer only runs while the interview is actually running.
  useEffect(() => {
    if (meetingState !== 'active' && meetingState !== 'closing') return undefined;
    const id = setInterval(() => setElapsed(Date.now() - startedAtRef.current), 1000);
    return () => clearInterval(id);
  }, [meetingState]);

  useEffect(() => {
    if (!recording) return undefined;
    const id = setInterval(
      () => setRecElapsed(Date.now() - (recStartedAtRef.current ?? Date.now())),
      1000,
    );
    return () => clearInterval(id);
  }, [recording]);

  /* -------------------- conversation -------------------- */

  const runTurn = useCallback(async (
    history: { role: TurnRole; content: string }[],
    userMessage: string,
  ): Promise<boolean> => {
    setThinking(true);
    try {
      const { data } = await api.post('/meeting/turn', {
        categoryId, history, userMessage, language, context,
      });
      if (endedRef.current) { setThinking(false); return true; }

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
        else if (micOnRef.current) scheduleListen();
      });
      return true;
    } catch (err: any) {
      setThinking(false);
      if (!endedRef.current) showNotice(apiErrorMessage(err, t('meeting.turnFailed')), 'danger');
      return false;
    }
  }, [categoryId, context, language, pushTurn, scheduleListen, showNotice, speak, t]);

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
    if (!streamRef.current) { showNotice(t('meeting.mediaDeniedBody'), 'danger'); return; }
    startingRef.current = true;
    startedAtRef.current = Date.now();
    setElapsed(0);
    setMeetingState('active');
    if (!SR) showNotice(t('meeting.sttUnsupported'), 'danger');

    const ok = await runTurn([], '');
    startingRef.current = false;
    if (!ok && !endedRef.current) setMeetingState('preparing');
  }, [runTurn, showNotice, t]);

  /* -------------------- ending -------------------- */

  const requestEvaluation = useCallback(async () => {
    if (evaluatingRef.current) return;
    const history = historySnapshot();
    if (history.length < 2) { setEvalPhase('none'); return; }

    evaluatingRef.current = true;
    setEvalPhase('loading');
    setEvalError(null);
    setEvalErrorKind('unknown');
    try {
      const { data } = await api.post('/meeting/finish', {
        categoryId, history, language, context,
      });
      setEvaluation(data?.evaluation ?? null);
      setEvalPhase(data?.evaluation ? 'ready' : 'none');
    } catch (err: any) {
      setEvalErrorKind(apiErrorKind(err));
      setEvalError(apiErrorMessage(err, t('meeting.evalFailedBody')));
      setEvalPhase('error');
    } finally {
      evaluatingRef.current = false;
    }
  }, [categoryId, context, historySnapshot, language, t]);

  const leaveScreen = useCallback(() => {
    if (navigation?.canGoBack?.()) navigation.goBack();
    else navigation?.navigate?.('Main');
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
    teardownRef.current({ saveRecording: opts.saveRecording });

    if (!hadTurns) { leaveScreen(); return; }

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
    const next = !micOnRef.current;
    micOnRef.current = next;
    setMicOn(next);
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = next; });

    if (!next) {
      stopRecognition();
      return;
    }
    if (stateRef.current === 'active' && !aiSpeaking && !thinking) startRecognition();
  }, [aiSpeaking, startRecognition, stopRecognition, thinking]);

  const toggleCam = useCallback(() => {
    setCamOn((prev) => {
      const next = !prev;
      streamRef.current?.getVideoTracks().forEach((track) => { track.enabled = next; });
      return next;
    });
  }, []);

  /* -------------------- derived -------------------- */

  const presence: Presence =
    aiSpeaking ? 'speaking'
    : thinking ? 'thinking'
    : listening ? 'listening'
    : 'idle';

  const canTalkNow =
    meetingState === 'active' && micOn && !listening && !thinking && !aiSpeaking && !!SR;

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

  /* ================================================================ *
   * Render — native
   * ================================================================ */

  if (!isWeb) {
    return (
      <Screen scroll edges={['top', 'bottom']} contentStyle={{ justifyContent: 'center', gap: theme.spacing.lg }}>
        <View style={[styles.center, { gap: theme.spacing.md, paddingVertical: theme.spacing['5xl'] }]}>
          <View
            style={[
              styles.center,
              {
                width: theme.layout.avatar.xl,
                height: theme.layout.avatar.xl,
                borderRadius: theme.radii.pill,
                backgroundColor: theme.colors.primaryMuted,
              },
            ]}
          >
            <Ionicons name="desktop-outline" size={theme.layout.icon['2xl']} color={theme.colors.primary} />
          </View>

          <Badge label={t('home.meetingLive')} tone="primary" icon="videocam" />
          <Text role="h2" weight="bold" align="center">{t('meeting.webOnlyTitle')}</Text>
          <Text role="body" tone="muted" align="center" style={{ maxWidth: theme.layout.maxContentWidth / 2 }}>
            {t('meeting.webOnlyBody')}
          </Text>

          <View style={{ alignSelf: 'stretch', gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
            <Button
              title={t('meeting.webOnlyCta')}
              onPress={() => { Linking.openURL(WEB_APP_URL).catch(() => {}); }}
              iconLeft={<Ionicons name="open-outline" size={theme.layout.icon.md} color={theme.colors.onPrimary} />}
              accessibilityHint={WEB_APP_URL}
              size="lg"
            />
            <Button title={t('meeting.webOnlyBack')} variant="ghost" onPress={leaveScreen} />
          </View>
        </View>
      </Screen>
    );
  }

  /* ================================================================ *
   * Render — camera / browser fault
   * ================================================================ */

  if (mediaFault) {
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
            {denied ? t('meeting.mediaDeniedTitle') : t('meeting.mediaUnsupportedTitle')}
          </Text>
          <Text role="body" tone="muted" align="center" style={{ maxWidth: theme.layout.maxContentWidth / 2 }}>
            {denied ? t('meeting.mediaDeniedBody') : t('meeting.mediaUnsupportedBody')}
          </Text>

          <View style={{ alignSelf: 'stretch', gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
            {denied ? (
              <Button
                title={t('meeting.mediaRetry')}
                onPress={() => { void acquireMedia(); }}
                iconLeft={<Ionicons name="refresh" size={theme.layout.icon.md} color={theme.colors.onPrimary} />}
              />
            ) : null}
            <Button title={t('meeting.webOnlyBack')} variant="ghost" onPress={leaveScreen} />
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
        onUpgrade={() => navigation.navigate('Subscription')}
        categoryName={categoryName}
        durationLabel={formatDuration(elapsed)}
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
            label={`${stateChip.label} · ${formatDuration(elapsed)}`}
            dotColor={stateChip.color}
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
        accessible
        accessibilityLabel={`${t('meeting.you')}${camOn ? '' : ` — ${t('meeting.cameraOffLabel')}`}`}
      >
        {/* Kept mounted at all times: remounting the element on every camera
            toggle drops the srcObject and shows a black frame on re-enable. */}
        {/* @ts-ignore — web-only HTMLVideoElement */}
        <video
          ref={videoRef as any}
          autoPlay
          muted
          playsInline
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: 'scaleX(-1)',
            display: camOn ? 'block' : 'none',
          }}
        />

        {!camOn ? (
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
            <View style={[styles.row, { gap: theme.spacing.xxs }]}>
              <Ionicons name="videocam-off" size={theme.layout.icon.xs} color={STAGE.inkFaint} />
              <Text role="micro" tone="inherit" style={{ color: STAGE.inkFaint }} numberOfLines={1}>
                {t('meeting.cameraOffLabel')}
              </Text>
            </View>
          </View>
        ) : null}

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
            onPress={startRecognition}
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
            label={recorderSupport.supported
              ? (recording ? t('meeting.ctrlRecordStop') : t('meeting.ctrlRecord'))
              : t('meeting.ctrlRecordUnavailable')}
            a11yLabel={recording ? t('meeting.ctrlRecordSave') : t('meeting.ctrlRecordStart')}
            a11yHint={recorderSupport.supported ? undefined : t('meeting.recordUnsupported')}
            disabled={!recorderSupport.supported || !streamReady}
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

        {!recorderSupport.supported ? (
          <Text role="micro" align="center" tone="inherit" style={{ color: STAGE.inkFaint }}>
            {t('meeting.recordUnsupported')}
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
  phase, evaluation, error, errorKind = 'unknown', categoryName, durationLabel, onRetry, onHome, onUpgrade,
}: {
  phase: EvalPhase;
  evaluation: Evaluation | null;
  error: string | null;
  errorKind?: ApiErrorKind;
  onUpgrade?: () => void;
  categoryName?: string;
  durationLabel: string;
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
          {[categoryName, durationLabel].filter(Boolean).join(' · ')}
        </Text>
      </View>

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
