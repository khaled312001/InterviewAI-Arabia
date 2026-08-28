/**
 * The interviewer's voice — Android/iOS.
 *
 * The shape of this file deliberately mirrors the web build: system voice
 * first, server TTS only as the fallback, a session counter that invalidates
 * the callbacks of a cancelled turn, a start-timeout that hands the line over
 * before anything has been heard, and an end-poll backstop for an engine that
 * forgets to fire `onDone`. Every one of those branches is a bug that was
 * already found and fixed once on web, so the orchestration is duplicated
 * rather than generalised. Only the genuinely pure parts — chunking, voice
 * scoring and the rate/pitch tuning — are shared with the web build, which is
 * where the leverage was anyway.
 *
 * What is native-only here
 *   • `Audio.setAudioModeAsync` around every turn. Getting it wrong is silent:
 *     leaving `allowsRecordingIOS` on during playback routes the interviewer to
 *     the earpiece receiver, so the voice sounds faint and far away and reads
 *     as a bug in the voice rather than in the routing.
 *   • The server fallback has no `<audio>` element, so the response is written
 *     to the cache directory and played through `expo-av`. There is no
 *     `AnalyserNode` on this platform, which is why `analysable` is always null
 *     and the level meter runs its synthesised envelope for both paths.
 *   • There is no acoustic echo cancellation between the speaker and the
 *     recognizer, so the turn discipline in `MeetingScreen` — the mic only
 *     re-opens after the interviewer stops — is load-bearing, not a nicety.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
/*
 * `expo-file-system/legacy`, deliberately.
 *
 * SDK 54 ships expo-file-system v19, whose default export is a completely new
 * object-oriented API (`new File(...)`, `new Directory(...)`). The constants
 * and helpers used below — documentDirectory, cacheDirectory, EncodingType,
 * getInfoAsync's `size` option — do not exist on it.
 *
 * The `/legacy` entry point is Expo's own supported bridge for exactly this,
 * and it keeps the v18 surface intact. Porting to the new API is a separate,
 * larger change with its own risk; pinning to the legacy import here makes the
 * SDK upgrade a dependency change rather than a rewrite of the recording and
 * audio-cache paths, which are the two things in this app that must not break.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';

import type {
  InterviewerVoice,
  SpeakOutcome,
  SpeakRequest,
  SpeechLang,
  UseInterviewerVoice,
  VoiceCandidate,
  VoiceGender,
} from './contract';
import { SPEECH_LOCALE } from './contract';
import { PITCH, RATE } from './locale';
import { splitForSpeech } from './splitForSpeech';
import { pickVoice } from './voiceScoring';

/* ------------------------------------------------------------------ *
 * Tuning
 * ------------------------------------------------------------------ */

/**
 * How long the first utterance may take to actually start before we treat the
 * engine as broken and reach for the server voice. Generous: a device whose TTS
 * engine is cold has to spin up a service before the first syllable.
 */
const START_TIMEOUT_MS = 3000;

/** Backstop poll for an engine that never fires `onDone`. */
const END_POLL_MS = 400;

/** Two quiet polls before we call the utterance finished. */
const END_POLL_QUIET = 2;

/** How long the server response may take to reach the speaker before we bail. */
const PLAYBACK_TIMEOUT_MS = 6000;

/**
 * Android's TTS engine reports an empty voice list for a moment after the
 * process starts. An empty list is "not ready", not "nothing installed", so it
 * is worth one retry before falling back.
 */
const VOICE_RETRY_MS = 600;

const SILENT: SpeakOutcome = { heard: false, by: 'none', analysable: null };
const HEARD_LOCAL: SpeakOutcome = { heard: true, by: 'local-voice', analysable: null };
const HEARD_SERVER: SpeakOutcome = { heard: true, by: 'server-tts', analysable: null };

/* ------------------------------------------------------------------ *
 * Audio session
 * ------------------------------------------------------------------ */

type AudioRole = 'speaking' | 'listening' | 'idle';

const AUDIO_MODES: Record<AudioRole, Parameters<typeof Audio.setAudioModeAsync>[0]> = {
  // The interviewer is talking. `allowsRecordingIOS: false` is the whole point:
  // with it on, playback leaves through the earpiece instead of the speaker.
  speaking: {
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
  },
  // The candidate's turn: the recognizer needs a record-capable session.
  listening: {
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
  },
  // The call is over. Hand the device back rather than sit on a record-capable
  // session that keeps other apps ducked.
  idle: {
    allowsRecordingIOS: false,
    playsInSilentModeIOS: false,
    staysActiveInBackground: false,
    interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  },
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * `ArrayBuffer` → base64, because `expo-file-system` writes strings and Hermes
 * ships neither `btoa` nor `Buffer`. Flushed in blocks so a two-minute reply
 * does not build one deep string rope.
 */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const blocks: string[] = [];
  let block = '';

  for (let i = 0; i < bytes.length; i += 3) {
    const left = bytes.length - i;
    const b0 = bytes[i];
    const b1 = left > 1 ? bytes[i + 1] : 0;
    const b2 = left > 2 ? bytes[i + 2] : 0;

    block += BASE64_ALPHABET[b0 >> 2];
    block += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    block += left > 1 ? BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    block += left > 2 ? BASE64_ALPHABET[b2 & 0x3f] : '=';

    if (block.length >= 4096) { blocks.push(block); block = ''; }
  }
  if (block) blocks.push(block);

  return blocks.join('');
}

/**
 * `expo-speech` carries no `localService` flag, so the cloud-voice signal the
 * web scorer leans on has no analogue. `quality` is the closest thing there is:
 * `Enhanced` is what an engine calls its downloaded neural voices.
 */
function toCandidate(voice: Speech.Voice): VoiceCandidate {
  return {
    id: voice.identifier,
    name: voice.name ?? '',
    lang: (voice.language ?? '').toLowerCase().replace(/_/g, '-'),
    quality: voice.quality === Speech.VoiceQuality.Enhanced ? 'enhanced' : 'default',
  };
}

/* ------------------------------------------------------------------ *
 * Hook
 * ------------------------------------------------------------------ */

export const useInterviewerVoice: UseInterviewerVoice = ({ fetchServerTts }) => {
  const fetchRef = useRef(fetchServerTts);
  fetchRef.current = fetchServerTts;

  const [speaking, setSpeaking] = useState(false);

  /**
   * Bumped by every `cancel()` and every new line. A queued utterance from the
   * previous turn checks it before running any callback, which is what stops
   * the `onStopped`/`onError` storm that `Speech.stop()` produces from looking
   * like "the interviewer finished" and advancing the interview.
   */
  const sessionRef = useRef(0);
  const voicesRef = useRef<VoiceCandidate[] | null>(null);
  const voiceLoadRef = useRef<Promise<VoiceCandidate[]> | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const fileRef = useRef<string | null>(null);
  const endPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRoleRef = useRef<AudioRole | null>(null);
  const releasedRef = useRef(false);

  const setAudioRole = useCallback(async (role: AudioRole) => {
    if (audioRoleRef.current === role) return;
    audioRoleRef.current = role;
    try {
      await Audio.setAudioModeAsync(AUDIO_MODES[role]);
    } catch {
      // Routing is a quality problem, never a reason to lose the turn. Forget
      // the role so the next attempt tries again.
      audioRoleRef.current = null;
    }
  }, []);

  const stopEndPoll = useCallback(() => {
    if (endPollRef.current !== null) { clearInterval(endPollRef.current); endPollRef.current = null; }
  }, []);

  /** Drop the playback file and the sound object behind it. Idempotent. */
  const dropPlayback = useCallback(() => {
    const sound = soundRef.current;
    soundRef.current = null;
    if (sound) {
      try { sound.setOnPlaybackStatusUpdate(null); } catch { /* already unloaded */ }
      void sound.unloadAsync().catch(() => {});
    }
    const file = fileRef.current;
    fileRef.current = null;
    if (file) void FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {});
  }, []);

  /**
   * Silence the interviewer now and invalidate the current line's callbacks.
   * Called before every new line and from teardown.
   */
  const silence = useCallback(() => {
    sessionRef.current += 1;
    stopEndPoll();
    void Speech.stop().catch(() => {});
    dropPlayback();
  }, [dropPlayback, stopEndPoll]);

  const loadVoices = useCallback(async (): Promise<VoiceCandidate[]> => {
    if (voicesRef.current) return voicesRef.current;
    if (voiceLoadRef.current) return voiceLoadRef.current;

    voiceLoadRef.current = (async () => {
      try {
        let raw = await Speech.getAvailableVoicesAsync();
        if (!raw.length) {
          await new Promise<void>((resolve) => { setTimeout(resolve, VOICE_RETRY_MS); });
          raw = await Speech.getAvailableVoicesAsync();
        }
        const list = raw.map(toCandidate);
        // Never cache an empty list: it means "the engine has not answered
        // yet", and caching it would make the whole call server-voiced.
        if (list.length) voicesRef.current = list;
        return list;
      } catch {
        return [];
      } finally {
        voiceLoadRef.current = null;
      }
    })();

    return voiceLoadRef.current;
  }, []);

  const warmUp = useCallback(async () => {
    await loadVoices();
  }, [loadVoices]);

  const hasVoiceFor = useCallback(async (lang: SpeechLang, gender: VoiceGender) => {
    const voices = await loadVoices();
    return voices.length === 0 || pickVoice(voices, lang, gender) !== null;
  }, [loadVoices]);

  /* -------------------- local (device) voice -------------------- */

  const speakLocally = useCallback(
    async (mine: number, chunks: string[], req: SpeakRequest): Promise<SpeakOutcome> => {
      const voices = await loadVoices();
      if (mine !== sessionRef.current) return SILENT;

      const picked = pickVoice(voices, req.lang, req.gender);
      // A list we *have* seen with nothing above the quality floor means the
      // only local option is the eSpeak class, which sounds worse than the
      // server voice. An empty list is not knowledge, so it still gets a try
      // with the language alone and lets the engine choose its default.
      if (!picked && voices.length > 0) return SILENT;

      return new Promise<SpeakOutcome>((resolve) => {
        let settled = false;
        let started = false;
        let closed = false;

        const settle = (outcome: SpeakOutcome) => {
          if (settled) return;
          settled = true;
          resolve(outcome);
        };

        /**
         * The single exit. `notify` is false on the cancel path so a torn-down
         * call never advances the interview from a dead utterance, and `onEnd`
         * only ever fires when something was actually heard — otherwise the
         * caller's own "nothing was heard, carry on" branch would advance the
         * turn a second time.
         */
        const close = (notify: boolean) => {
          if (closed) return;
          closed = true;
          clearTimeout(startTimer);
          if (mine === sessionRef.current) stopEndPoll();
          settle(started ? HEARD_LOCAL : SILENT);
          if (notify && started && mine === sessionRef.current) {
            setSpeaking(false);
            void setAudioRole('listening');
            req.onEnd?.();
          }
        };

        /**
         * Abandon the device voice while nothing has been audible yet.
         *
         * `Speech.stop()` is the load-bearing part: only the failing utterance
         * reports an error, its siblings stay queued in the engine, and they
         * would go on speaking underneath the server fallback — the candidate
         * would hear the same line twice, overlapping and out of sync.
         */
        const giveUp = () => {
          if (closed) return;
          closed = true;
          clearTimeout(startTimer);
          stopEndPoll();
          if (mine === sessionRef.current) void Speech.stop().catch(() => {});
          settle(SILENT);
        };

        const startTimer = setTimeout(() => {
          if (started || closed) return;
          giveUp();
        }, START_TIMEOUT_MS);

        const startEndPoll = () => {
          stopEndPoll();
          let quiet = 0;
          endPollRef.current = setInterval(() => {
            if (mine !== sessionRef.current) { stopEndPoll(); return; }
            Speech.isSpeakingAsync()
              .then((busy) => {
                if (mine !== sessionRef.current || closed) return;
                if (busy) { quiet = 0; return; }
                quiet += 1;
                if (quiet >= END_POLL_QUIET) close(true);
              })
              .catch(() => {});
          }, END_POLL_MS);
        };

        const last = chunks.length - 1;

        chunks.forEach((chunk, i) => {
          Speech.speak(chunk, {
            language: SPEECH_LOCALE[req.lang],
            voice: picked?.id,
            rate: RATE[req.lang],
            pitch: PITCH,

            onStart: i === 0
              ? () => {
                if (started || closed || mine !== sessionRef.current) return;
                started = true;
                clearTimeout(startTimer);
                setSpeaking(true);
                req.onStart?.('local-voice', null);
                settle(HEARD_LOCAL);
                startEndPoll();
              }
              : undefined,

            onDone: i === last
              ? () => {
                // An `onDone` with no `onStart` still means the engine ran the
                // utterance — Android drops `onStart` when speech is queued in
                // the same tick as a `stop()`. Leaving `started` false here
                // would tell the caller nothing was heard, and it would fetch
                // the server voice and repeat, out loud, a line the candidate
                // has already listened to.
                if (!closed && mine === sessionRef.current) started = true;
                close(true);
              }
              : undefined,

            // `Speech.stop()` fires this on everything still queued. The
            // session check inside `close` is what keeps a cancel from looking
            // like the interviewer finishing.
            onStopped: () => { close(false); },

            onError: () => {
              if (closed) return;
              if (!started) { giveUp(); return; }
              // Mid-reply. Not worth restarting the whole line for; the
              // end-poll backstop still closes the turn.
              if (i === last) close(true);
            },
          });
        });
      });
    },
    [loadVoices, setAudioRole, stopEndPoll],
  );

  /* -------------------- server fallback -------------------- */

  const speakFromServer = useCallback(
    async (mine: number, req: SpeakRequest): Promise<SpeakOutcome> => {
      const cache = FileSystem.cacheDirectory;
      if (!cache) return SILENT;

      let uri: string;
      try {
        const audio = await fetchRef.current({
          text: req.text,
          gender: req.gender,
          language: req.lang,
        });
        if (mine !== sessionRef.current) return SILENT;

        uri = `${cache}interprova-tts-${mine}.mp3`;
        await FileSystem.writeAsStringAsync(uri, toBase64(audio), {
          encoding: FileSystem.EncodingType.Base64,
        });
      } catch {
        // A missing voice must never block the interview.
        return SILENT;
      }

      if (mine !== sessionRef.current) {
        void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        return SILENT;
      }
      fileRef.current = uri;

      return new Promise<SpeakOutcome>((resolve) => {
        let settled = false;
        let started = false;
        let closed = false;

        const settle = (outcome: SpeakOutcome) => {
          if (settled) return;
          settled = true;
          resolve(outcome);
        };

        const close = (notify: boolean) => {
          if (closed) return;
          closed = true;
          clearTimeout(startTimer);
          if (mine === sessionRef.current) dropPlayback();
          settle(started ? HEARD_SERVER : SILENT);
          if (notify && started && mine === sessionRef.current) {
            setSpeaking(false);
            void setAudioRole('listening');
            req.onEnd?.();
          }
        };

        const startTimer = setTimeout(() => {
          if (started || closed) return;
          close(false);
        }, PLAYBACK_TIMEOUT_MS);

        Audio.Sound.createAsync({ uri }, { shouldPlay: true, volume: 1.0 }, (status) => {
          if (mine !== sessionRef.current || closed) return;
          if (!status.isLoaded) {
            // `error` is populated exactly once, when a fault forces an unload.
            if (status.error) close(true);
            return;
          }
          if (status.isPlaying && !started) {
            started = true;
            clearTimeout(startTimer);
            setSpeaking(true);
            // No AnalyserNode on this platform: the level meter runs its
            // synthesised envelope, so there is nothing analysable to hand over.
            req.onStart?.('server-tts', null);
            settle(HEARD_SERVER);
          }
          if (status.didJustFinish) close(true);
        })
          .then(({ sound }) => {
            if (mine !== sessionRef.current || closed) {
              try { sound.setOnPlaybackStatusUpdate(null); } catch { /* already gone */ }
              void sound.unloadAsync().catch(() => {});
              void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
              return;
            }
            soundRef.current = sound;
          })
          .catch(() => { close(false); });
      });
    },
    [dropPlayback, setAudioRole],
  );

  /* -------------------- public surface -------------------- */

  const speak = useCallback(async (req: SpeakRequest): Promise<SpeakOutcome> => {
    if (releasedRef.current) return SILENT;

    // Anything still queued belongs to a previous turn.
    silence();
    const mine = sessionRef.current;

    const chunks = splitForSpeech(req.text);
    if (!chunks.length) return SILENT;

    await setAudioRole('speaking');
    if (mine !== sessionRef.current) return SILENT;

    const local = await speakLocally(mine, chunks, req);
    if (local.heard) return local;
    // Cancelled while the device voice was being tried: falling through would
    // start the server voice on a turn that no longer exists.
    if (mine !== sessionRef.current || releasedRef.current) return SILENT;

    return speakFromServer(mine, req);
  }, [setAudioRole, silence, speakFromServer, speakLocally]);

  const cancel = useCallback(() => {
    silence();
    setSpeaking(false);
    void setAudioRole('listening');
  }, [setAudioRole, silence]);

  const release = useCallback(() => {
    releasedRef.current = true;
    silence();
    setSpeaking(false);
    void setAudioRole('idle');
  }, [setAudioRole, silence]);

  // Backstop: an unmount must not leave an utterance queued, a sound loaded or
  // a cache file behind, whatever the screen did or forgot to do.
  useEffect(() => release, [release]);

  return useMemo<InterviewerVoice>(
    () => ({ speaking, speak, cancel, warmUp, hasVoiceFor, release }),
    [speaking, speak, cancel, warmUp, hasVoiceFor, release],
  );
};
