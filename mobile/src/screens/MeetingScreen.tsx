// Zoom-like mock-interview meeting with an AI HR persona named "Sarah".
// Web-first: browser getUserMedia for camera/mic + Web SpeechRecognition
// for Arabic STT + server TTS (Microsoft Edge ar-EG-SalmaNeural) for a
// guaranteed professional female Arabic voice.
//
// Smart silence detection: the recognizer stays open continuously and only
// commits the user's utterance after ~2.5s of silence — so thinking pauses
// don't cut them off.
//
// Live coaching: each of Sarah's turns returns a "tips" array (suggestions
// for the candidate's NEXT answer). They fade into a side panel without
// interrupting the conversation flow.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotiView, AnimatePresence } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { api, API_BASE } from '../api/client';
import { useAppTheme } from '../theme/useTheme';
import { secureStorage } from '../storage/secureStorage';

type TurnRole = 'assistant' | 'user';
interface Turn { role: TurnRole; content: string; at: number }
interface Tip { id: number; text: string; at: number }

// Silence window: how long after the last transcription event we treat the
// user as "done speaking". 2.5s feels natural and handles thinking pauses.
const SILENCE_MS = 2500;

const SR: any = Platform.OS === 'web' && typeof window !== 'undefined'
  ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  : null;

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function MeetingScreen({ route, navigation }: any) {
  const { categoryId, categoryName, context } = route.params;
  const hrGender: 'male' | 'female' = context?.gender === 'male' ? 'male' : 'female';
  const hrName = hrGender === 'male' ? 'أحمد' : 'سارة';
  const hrSeed = hrGender === 'male' ? 'ahmed-hr' : 'sara-hr';
  const hrColor = hrGender === 'male' ? '#2D6CE0' : '#E85D75';
  const hrAvatar = `https://api.dicebear.com/7.x/personas/svg?seed=${hrSeed}&backgroundColor=${hrColor.replace('#', '')}&radius=50`;

  const theme = useAppTheme();
  const textBold = { fontFamily: theme.typography.fontFamilyBold };
  const textRegular = { fontFamily: theme.typography.fontFamily };

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mouthAnimRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accumulatedFinalRef = useRef<string>('');
  const startedAtRef = useRef<number>(Date.now());
  const tipCounterRef = useRef(0);
  const [mouthLevel, setMouthLevel] = useState(0); // 0..1, drives lip animation

  const [turns, setTurns] = useState<Turn[]>([]);
  const [tips, setTips] = useState<Tip[]>([]);
  const [interim, setInterim] = useState('');
  const [thinking, setThinking] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [meetingState, setMeetingState] = useState<'preparing' | 'active' | 'closing' | 'ended'>('preparing');
  const [evaluation, setEvaluation] = useState<any>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  // -------------------------- media init --------------------------
  useEffect(() => {
    if (Platform.OS !== 'web') {
      setMediaError('هذه الميزة متاحة على نسخة الويب حاليًا. سنضيف دعم الموبايل قريبًا.');
      return;
    }
    if (!navigator?.mediaDevices?.getUserMedia) {
      setMediaError('متصفحك لا يدعم الوصول للكاميرا والمايك.');
      return;
    }
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 480, height: 360, facingMode: 'user' },
          audio: true,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        setMediaError('لم نستطع الوصول للكاميرا أو المايك. يرجى السماح بالصلاحيات وإعادة المحاولة.');
      }
    })();

    const tick = setInterval(() => setElapsed(Date.now() - startedAtRef.current), 1000);
    return () => {
      clearInterval(tick);
      stopRecognition();
      if (audioRef.current) { try { audioRef.current.pause(); } catch {} }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // -------------------------- smart STT --------------------------
  const startRecognition = useCallback(() => {
    if (!SR || !micOn) return;
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} }
    accumulatedFinalRef.current = '';

    const rec = new SR();
    rec.lang = 'ar-EG';
    rec.continuous = true;      // stay open; we'll decide when to commit via silence timer
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    const armSilence = () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        if (accumulatedFinalRef.current.trim()) {
          try { rec.stop(); } catch {}
        }
      }, SILENCE_MS);
    };

    rec.onresult = (e: any) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) accumulatedFinalRef.current += r[0].transcript + ' ';
        else interimText += r[0].transcript;
      }
      setInterim(interimText);
      armSilence();
    };
    rec.onspeechstart = () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
    rec.onend = () => {
      setListening(false);
      setInterim('');
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      const final = accumulatedFinalRef.current.trim();
      accumulatedFinalRef.current = '';
      if (final) sendUserMessage(final);
    };
    rec.onerror = (e: any) => {
      setListening(false);
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        // eslint-disable-next-line no-console
        console.warn('SR error', e.error);
      }
    };

    rec.start();
    recognitionRef.current = rec;
    setListening(true);
  }, [micOn]);

  const stopRecognition = () => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; }
    setListening(false);
  };

  // -------------------------- server TTS + audio-reactive mouth --------------------------
  // Pipes the TTS audio through a Web Audio AnalyserNode so we can read the
  // volume envelope in realtime and scale the HR's mouth with it. Poor-man's
  // lip-sync — doesn't produce actual viseme shapes, but visually ties the
  // mouth movement to the voice so the avatar feels alive.
  const stopMouthAnim = () => {
    if (mouthAnimRef.current !== null) {
      cancelAnimationFrame(mouthAnimRef.current);
      mouthAnimRef.current = null;
    }
    setMouthLevel(0);
  };

  const startMouthAnim = () => {
    if (!analyserRef.current) return;
    const analyser = analyserRef.current;
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      // Compute RMS amplitude (0..1) and map to mouth opening.
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / buf.length);
      // Amplify so typical speech volume reaches ~0.8-1.0 opening.
      const level = Math.min(1, rms * 6);
      setMouthLevel(level);
      mouthAnimRef.current = requestAnimationFrame(tick);
    };
    mouthAnimRef.current = requestAnimationFrame(tick);
  };

  const speak = useCallback(async (text: string, onDone?: () => void) => {
    if (Platform.OS !== 'web') { onDone?.(); return; }
    try {
      setAiSpeaking(true);
      const token = await secureStorage.getItem('access_token');
      const res = await fetch(`${API_BASE}/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          text,
          gender: hrGender,
          language: 'ar',
        }),
      });
      if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      if (audioRef.current) { try { audioRef.current.pause(); } catch {} }
      stopMouthAnim();

      const audio = new Audio(url);
      audio.crossOrigin = 'anonymous';
      audioRef.current = audio;

      // Wire Web Audio analyser once, reuse on subsequent utterances.
      try {
        if (!audioCtxRef.current) {
          const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
          audioCtxRef.current = new Ctx();
        }
        const ctx = audioCtxRef.current!;
        if (ctx.state === 'suspended') { try { await ctx.resume(); } catch {} }
        const src = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.6;
        src.connect(analyser);
        analyser.connect(ctx.destination);
        analyserRef.current = analyser;
      } catch (e) {
        // Analyser setup can fail in some browsers; the audio still plays.
      }

      audio.onplay = () => startMouthAnim();
      const cleanup = () => {
        setAiSpeaking(false);
        stopMouthAnim();
        URL.revokeObjectURL(url);
        onDone?.();
      };
      audio.onended = cleanup;
      audio.onerror = cleanup;
      await audio.play();
    } catch (err) {
      setAiSpeaking(false);
      stopMouthAnim();
      // eslint-disable-next-line no-console
      console.warn('TTS failed — will proceed silently', err);
      onDone?.();
    }
  }, [hrGender]);

  // -------------------------- backend turn --------------------------
  const sendTurn = useCallback(async (userMessage: string) => {
    setThinking(true);
    try {
      const history = turns.map((t) => ({ role: t.role, content: t.content }));
      const { data } = await api.post('/meeting/turn', {
        categoryId, history, userMessage, language: 'ar', context,
      });
      const aiTurn: Turn = { role: 'assistant', content: data.reply, at: Date.now() };
      setTurns((prev) => [...prev, aiTurn]);

      // Surface live coaching tips (if any).
      if (Array.isArray(data.tips) && data.tips.length) {
        const now = Date.now();
        const newTips: Tip[] = data.tips.map((text: string) => ({
          id: ++tipCounterRef.current, text, at: now,
        }));
        setTips((prev) => [...newTips, ...prev].slice(0, 8));
      }

      const closing = data.status === 'closing';
      if (closing) setMeetingState('closing');
      speak(data.reply, () => {
        if (closing) {
          finishMeeting([
            ...turns,
            ...(userMessage ? [{ role: 'user' as const, content: userMessage, at: Date.now() }] : []),
            aiTurn,
          ]);
        } else if (micOn) {
          setTimeout(startRecognition, 500);
        }
      });
    } catch (err: any) {
      Alert.alert('خطأ', err?.response?.data?.error || err.message);
    } finally {
      setThinking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, turns, micOn, startRecognition, speak]);

  const sendUserMessage = useCallback(async (text: string) => {
    setTurns((prev) => [...prev, { role: 'user', content: text, at: Date.now() }]);
    await sendTurn(text);
  }, [sendTurn]);

  const startMeeting = useCallback(async () => {
    startedAtRef.current = Date.now();
    setMeetingState('active');
    try {
      setThinking(true);
      const { data } = await api.post('/meeting/turn', {
        categoryId, history: [], userMessage: '', language: 'ar',
      });
      const opener: Turn = { role: 'assistant', content: data.reply, at: Date.now() };
      setTurns([opener]);
      speak(data.reply, () => {
        if (micOn) setTimeout(startRecognition, 500);
      });
    } catch (err: any) {
      Alert.alert('خطأ', err?.response?.data?.error || err.message);
    } finally {
      setThinking(false);
    }
  }, [categoryId, micOn, startRecognition, speak]);

  const finishMeeting = useCallback(async (finalTurns?: Turn[]) => {
    stopRecognition();
    if (audioRef.current) { try { audioRef.current.pause(); } catch {} }
    setMeetingState('ended');
    const history = (finalTurns ?? turns).map((t) => ({ role: t.role, content: t.content }));
    if (history.length < 2) return;
    try {
      setThinking(true);
      const { data } = await api.post('/meeting/finish', {
        categoryId, history, language: 'ar', context,
      });
      setEvaluation(data.evaluation);
    } catch (err: any) {
      Alert.alert('خطأ', err?.response?.data?.error || err.message);
    } finally {
      setThinking(false);
    }
  }, [categoryId, turns]);

  // -------------------------- media controls --------------------------
  const toggleMic = () => {
    const next = !micOn;
    setMicOn(next);
    const tracks = streamRef.current?.getAudioTracks() || [];
    tracks.forEach((t) => (t.enabled = next));
    if (!next) stopRecognition();
    else if (meetingState === 'active' && !aiSpeaking && !thinking) startRecognition();
  };

  const toggleCam = () => {
    const next = !camOn;
    setCamOn(next);
    const tracks = streamRef.current?.getVideoTracks() || [];
    tracks.forEach((t) => (t.enabled = next));
  };

  // -------------------------- render --------------------------
  if (mediaError) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg }]}>
        <View style={styles.errWrap}>
          <Ionicons name="videocam-off" size={48} color={theme.colors.danger} />
          <Text style={[styles.errTitle, textBold, { color: theme.colors.text }]}>المحاكاة غير متاحة</Text>
          <Text style={[styles.errBody, textRegular, { color: theme.colors.textMuted }]}>{mediaError}</Text>
          <Pressable onPress={() => navigation.goBack()} style={[styles.btn, { backgroundColor: theme.colors.primary }]}>
            <Text style={[textBold, { color: '#fff' }]}>رجوع</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (evaluation) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.bg }]}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          <Text style={[styles.resultTitle, textBold, { color: theme.colors.text }]}>تقييم المقابلة</Text>
          <View style={[styles.scoreBig, { backgroundColor: theme.colors.primary }]}>
            <Text style={[styles.scoreBigLabel, textRegular]}>الدرجة الإجمالية</Text>
            <Text style={[styles.scoreBigNum, textBold]}>{evaluation.overall_score}/10</Text>
            <Text style={[styles.scoreBigSummary, textRegular]}>{evaluation.summary}</Text>
          </View>
          <View style={[styles.resCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Text style={[styles.resCardTitle, textBold, { color: theme.colors.success }]}>نقاط القوة</Text>
            {(evaluation.strengths || []).map((s: string, i: number) => (
              <Text key={i} style={[textRegular, { color: theme.colors.text, lineHeight: 22 }]}>• {s}</Text>
            ))}
          </View>
          <View style={[styles.resCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Text style={[styles.resCardTitle, textBold, { color: theme.colors.warning }]}>نقاط التحسين</Text>
            {(evaluation.weaknesses || []).map((s: string, i: number) => (
              <Text key={i} style={[textRegular, { color: theme.colors.text, lineHeight: 22 }]}>• {s}</Text>
            ))}
          </View>
          <View style={[styles.resCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Text style={[styles.resCardTitle, textBold, { color: theme.colors.primary }]}>النصيحة</Text>
            <Text style={[textRegular, { color: theme.colors.text, lineHeight: 22 }]}>{evaluation.advice}</Text>
          </View>
          <Pressable onPress={() => navigation.navigate('Main')} style={[styles.btn, { backgroundColor: theme.colors.primary }]}>
            <Text style={[textBold, { color: '#fff' }]}>العودة للرئيسية</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: '#0A0E1A' }]}>
      <SafeAreaView edges={['top']}>
        <View style={styles.topBar}>
          <View style={styles.topBarLeft}>
            <View style={styles.liveDot} />
            <Text style={[styles.topBarText, textBold]}>
              {meetingState === 'preparing' ? 'جاري التحضير' : meetingState === 'ended' ? 'انتهت' : categoryName}
            </Text>
            <Text style={[styles.topBarText, textRegular, { opacity: 0.6 }]}>
              {' · '}{formatDuration(elapsed)}
            </Text>
          </View>
          <Pressable onPress={() => finishMeeting()} style={styles.endBtn}>
            <Ionicons name="call" size={16} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
            <Text style={[textBold, { color: '#fff', fontSize: 13 }]}>إنهاء</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <View style={styles.body}>
        {/* Left/main: AI avatar stage */}
        <View style={styles.stage}>
          <View style={styles.avatarOuter}>
            {aiSpeaking && (
              <MotiView
                from={{ scale: 0.9, opacity: 0.5 }}
                animate={{ scale: 1 + mouthLevel * 0.25, opacity: 0.25 + mouthLevel * 0.5 }}
                transition={{ type: 'timing', duration: 80 }}
                style={[styles.avatarPulse1, { backgroundColor: hrColor + '28' }]}
              />
            )}
            {aiSpeaking && (
              <MotiView
                from={{ scale: 0.95, opacity: 0.4 }}
                animate={{ scale: 1 + mouthLevel * 0.15, opacity: 0.3 + mouthLevel * 0.5 }}
                transition={{ type: 'timing', duration: 80 }}
                style={[styles.avatarPulse2, { backgroundColor: hrColor + '40' }]}
              />
            )}
            <View style={[styles.avatarCore, { backgroundColor: hrColor, borderColor: hrColor + '88' }]}>
              {Platform.OS === 'web' ? (
                // @ts-ignore — direct img for the SVG avatar
                <img
                  src={hrAvatar}
                  alt={hrName}
                  width={160}
                  height={160}
                  style={{ width: 160, height: 160, borderRadius: 80, display: 'block' }}
                />
              ) : (
                <Text style={[styles.avatarInitial, textBold]}>{hrName[0]}</Text>
              )}
              {/* Audio-reactive mouth overlay — grows/shrinks with voice amplitude */}
              {aiSpeaking && (
                <View
                  style={[
                    styles.mouthOverlay,
                    {
                      height: 6 + mouthLevel * 22,
                      width: 28 + mouthLevel * 18,
                      opacity: 0.55 + mouthLevel * 0.45,
                    },
                  ]}
                />
              )}
            </View>
          </View>
          <Text style={[styles.avatarName, textBold]}>{hrName}</Text>
          <Text style={[styles.avatarRole, textRegular]}>
            {hrGender === 'male' ? 'مسؤول الموارد البشرية' : 'مسؤولة الموارد البشرية'}
          </Text>

          {thinking && (
            <View style={styles.statusBadge}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={[textRegular, { color: '#fff', marginStart: 8 }]}>تفكّر...</Text>
            </View>
          )}
          {listening && !thinking && (
            <View style={[styles.statusBadge, { backgroundColor: 'rgba(16,185,129,0.25)', borderColor: 'rgba(16,185,129,0.5)' }]}>
              <View style={styles.micDot} />
              <Text style={[textRegular, { color: '#fff', marginStart: 8 }]}>أستمع إليك...</Text>
            </View>
          )}

          {/* Caption of last turn */}
          <View style={styles.captionArea}>
            {turns.length > 0 && (
              <MotiView
                key={turns[turns.length - 1].at}
                from={{ opacity: 0, translateY: 6 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'timing', duration: 260 }}
                style={styles.captionCard}
              >
                <Text style={[styles.captionLabel, textBold]}>
                  {turns[turns.length - 1].role === 'assistant' ? 'سارة' : 'أنت'}
                </Text>
                <Text style={[styles.captionText, textRegular]}>
                  {turns[turns.length - 1].content}
                </Text>
              </MotiView>
            )}
            {interim ? (
              <Text style={[styles.interim, textRegular]}>{interim}</Text>
            ) : null}
          </View>
        </View>

        {/* Right: live coaching tips panel */}
        <View style={styles.tipsPanel}>
          <View style={styles.tipsPanelHead}>
            <Ionicons name="sparkles" size={16} color="#F5B12F" />
            <Text style={[textBold, { color: '#fff', fontSize: 13, marginStart: 6 }]}>مدرّبك المباشر</Text>
          </View>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: 8 }}
            showsVerticalScrollIndicator={false}
          >
            <AnimatePresence>
              {tips.length === 0 ? (
                <View style={styles.tipsEmpty}>
                  <Text style={[textRegular, { color: 'rgba(255,255,255,0.55)', fontSize: 12, textAlign: 'center' }]}>
                    نصائح لحظية ستظهر هنا بعد كل إجابة لمساعدتك على تحسين أدائك.
                  </Text>
                </View>
              ) : (
                tips.map((tip, idx) => (
                  <MotiView
                    key={tip.id}
                    from={{ opacity: 0, translateX: -20 }}
                    animate={{ opacity: 1, translateX: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ type: 'timing', duration: 320, delay: idx * 40 }}
                    style={styles.tipCard}
                  >
                    <Ionicons name="bulb" size={14} color="#F5B12F" style={{ marginTop: 2 }} />
                    <Text style={[textRegular, { color: '#fff', flex: 1, lineHeight: 20, fontSize: 13 }]}>
                      {tip.text}
                    </Text>
                  </MotiView>
                ))
              )}
            </AnimatePresence>
          </ScrollView>
        </View>
      </View>

      {/* PiP user camera */}
      {Platform.OS === 'web' && (
        <View style={styles.pipWrap}>
          <View style={styles.pip}>
            {/* @ts-ignore — web-only HTMLVideoElement */}
            <video
              ref={videoRef as any}
              autoPlay
              muted
              playsInline
              style={{
                width: '100%', height: '100%', objectFit: 'cover',
                transform: 'scaleX(-1)',
                display: camOn ? 'block' : 'none',
              }}
            />
            {!camOn && (
              <View style={styles.pipOff}><Ionicons name="videocam-off" size={26} color="#fff" /></View>
            )}
            <View style={styles.pipLabel}>
              <Text style={[textBold, { color: '#fff', fontSize: 11 }]}>أنت</Text>
            </View>
          </View>
        </View>
      )}

      {/* Bottom controls */}
      <SafeAreaView edges={['bottom']} style={styles.bottomWrap}>
        {meetingState === 'preparing' ? (
          <Pressable onPress={startMeeting} style={[styles.startBtn, { backgroundColor: theme.colors.success }]}>
            <Ionicons name="videocam" size={20} color="#fff" />
            <Text style={[textBold, { color: '#fff', fontSize: 16 }]}>ابدأ المقابلة مع سارة</Text>
          </Pressable>
        ) : (
          <View style={styles.controls}>
            <Pressable
              onPress={toggleMic}
              style={[styles.ctrlBtn, { backgroundColor: micOn ? 'rgba(255,255,255,0.12)' : '#EF4444' }]}
            >
              <Ionicons name={micOn ? 'mic' : 'mic-off'} size={22} color="#fff" />
            </Pressable>
            <Pressable
              onPress={toggleCam}
              style={[styles.ctrlBtn, { backgroundColor: camOn ? 'rgba(255,255,255,0.12)' : '#EF4444' }]}
            >
              <Ionicons name={camOn ? 'videocam' : 'videocam-off'} size={22} color="#fff" />
            </Pressable>
            <Pressable
              onPress={() => { if (!thinking && !aiSpeaking && !listening) startRecognition(); }}
              disabled={!micOn || thinking || aiSpeaking || listening}
              style={[
                styles.ctrlBtn,
                {
                  backgroundColor: listening ? '#10B981' : theme.colors.primary,
                  opacity: (!micOn || thinking || aiSpeaking) ? 0.5 : 1,
                },
              ]}
            >
              <Ionicons name={listening ? 'radio' : 'mic-circle-outline'} size={24} color="#fff" />
            </Pressable>
            <Pressable
              onPress={() => finishMeeting()}
              style={[styles.ctrlBtn, { backgroundColor: '#EF4444' }]}
            >
              <Ionicons name="call" size={22} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  root: { flex: 1, position: 'relative' },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: 'rgba(0,0,0,0.35)',
  },
  topBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444' },
  topBarText: { color: '#fff', fontSize: 14 },
  endBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: '#EF4444', borderRadius: 999,
  },

  body: { flex: 1, flexDirection: 'row' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 },

  avatarOuter: {
    width: 180, height: 180, borderRadius: 90,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  avatarPulse1: {
    position: 'absolute', width: '140%', height: '140%', borderRadius: 9999,
    backgroundColor: 'rgba(45,108,224,0.15)',
  },
  avatarPulse2: {
    position: 'absolute', width: '115%', height: '115%', borderRadius: 9999,
    backgroundColor: 'rgba(45,108,224,0.28)',
  },
  avatarCore: {
    width: 160, height: 160, borderRadius: 80,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, overflow: 'hidden',
    position: 'relative',
  },
  avatarInitial: { color: '#fff', fontSize: 72, lineHeight: 82 },
  mouthOverlay: {
    position: 'absolute',
    bottom: 32,
    backgroundColor: 'rgba(20, 25, 39, 0.75)',
    borderRadius: 999,
  },
  avatarName: { color: '#fff', fontSize: 22 },
  avatarRole: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },

  statusBadge: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 999, marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  micDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981' },

  captionArea: { marginTop: 14, alignItems: 'center', width: '100%', maxWidth: 640, gap: 8 },
  captionCard: {
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', width: '100%',
  },
  captionLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 11, marginBottom: 4 },
  captionText: { color: '#fff', fontSize: 15, lineHeight: 24 },
  interim: { color: 'rgba(255,255,255,0.65)', fontStyle: 'italic', fontSize: 13, textAlign: 'center' },

  // Tips side panel (hidden on narrow screens via width)
  tipsPanel: {
    width: 280,
    paddingVertical: 16, paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderStartWidth: 1, borderStartColor: 'rgba(255,255,255,0.08)',
    gap: 10,
  },
  tipsPanelHead: {
    flexDirection: 'row', alignItems: 'center',
    paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  tipsEmpty: { padding: 12 },
  tipCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(245,177,47,0.1)',
    borderWidth: 1, borderColor: 'rgba(245,177,47,0.25)',
    padding: 10, borderRadius: 10,
  },

  pipWrap: { position: 'absolute', bottom: 110, left: 20 },
  pip: {
    width: 140, height: 100, borderRadius: 12, overflow: 'hidden',
    backgroundColor: '#1F2533',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.22)',
    position: 'relative',
  },
  pipOff: {
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#1F2533',
  },
  pipLabel: {
    position: 'absolute', bottom: 4, left: 6,
    paddingVertical: 2, paddingHorizontal: 6,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 6,
  },

  bottomWrap: { paddingBottom: 20, paddingTop: 10 },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: 14, paddingHorizontal: 20 },
  ctrlBtn: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  startBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    alignSelf: 'center',
    paddingVertical: 14, paddingHorizontal: 28, borderRadius: 999,
  },

  errWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  errTitle: { fontSize: 20 },
  errBody: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  btn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12, marginTop: 8, alignItems: 'center' },

  resultTitle: { fontSize: 24, textAlign: 'center', marginVertical: 8 },
  scoreBig: { borderRadius: 20, padding: 22, alignItems: 'center', gap: 6 },
  scoreBigLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  scoreBigNum: { color: '#fff', fontSize: 54 },
  scoreBigSummary: { color: 'rgba(255,255,255,0.9)', fontSize: 14, textAlign: 'center', lineHeight: 22, marginTop: 6 },
  resCard: { borderRadius: 14, padding: 16, borderWidth: StyleSheet.hairlineWidth, gap: 6 },
  resCardTitle: { fontSize: 15, marginBottom: 4 },
});
