// Zoom-like mock-interview meeting with an AI HR persona named "Sarah".
// Web-first: uses browser getUserMedia + Web Speech API (STT + TTS). Falls
// back gracefully on unsupported browsers. Native support will be layered
// on top later with expo-camera + expo-speech.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api/client';
import { useAppTheme } from '../theme/useTheme';

type TurnRole = 'assistant' | 'user';
interface Turn { role: TurnRole; content: string; at: number }

// Narrow window.* access so TypeScript is happy on web-only APIs.
const SR: any = Platform.OS === 'web' && typeof window !== 'undefined'
  ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  : null;
const SYN: SpeechSynthesis | null = Platform.OS === 'web' && typeof window !== 'undefined'
  ? window.speechSynthesis
  : null;

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function pickArabicVoice(): SpeechSynthesisVoice | null {
  if (!SYN) return null;
  const voices = SYN.getVoices();
  // Prefer female Arabic voices when available.
  const preferred = voices.find(v => /ar/i.test(v.lang) && /female|sara|zira|noura|amira|hana|latifa/i.test(v.name));
  return preferred || voices.find(v => /ar/i.test(v.lang)) || null;
}

export function MeetingScreen({ route, navigation }: any) {
  const { categoryId, categoryName } = route.params;
  const theme = useAppTheme();
  const textBold = { fontFamily: theme.typography.fontFamilyBold };
  const textRegular = { fontFamily: theme.typography.fontFamily };

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const startedAtRef = useRef<number>(Date.now());
  const pendingAudioRef = useRef<SpeechSynthesisUtterance | null>(null);

  const [turns, setTurns] = useState<Turn[]>([]);
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

  // ------------------------ camera / mic setup ------------------------
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
      } catch (err: any) {
        setMediaError('لم نستطع الوصول للكاميرا أو المايك. يرجى السماح بالصلاحيات.');
      }
    })();

    // Tick duration every second.
    const tick = setInterval(() => setElapsed(Date.now() - startedAtRef.current), 1000);
    return () => {
      clearInterval(tick);
      stopRecognition();
      if (SYN) SYN.cancel();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------ Recognition helpers ------------------------
  const startRecognition = useCallback(() => {
    if (!SR || !micOn) return;
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} }
    const rec = new SR();
    rec.lang = 'ar-EG';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let finalText = '';
    rec.onresult = (e: any) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      setInterim(interimText);
    };
    rec.onend = () => {
      setListening(false);
      setInterim('');
      if (finalText.trim()) sendUserMessage(finalText.trim());
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
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; }
    setListening(false);
  };

  // ------------------------ TTS ------------------------
  const speak = (text: string, onDone?: () => void) => {
    if (!SYN) { onDone?.(); return; }
    SYN.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'ar-EG';
    utter.rate = 0.95;
    utter.pitch = 1.05;
    const voice = pickArabicVoice();
    if (voice) utter.voice = voice;
    utter.onstart = () => setAiSpeaking(true);
    utter.onend = () => { setAiSpeaking(false); onDone?.(); };
    utter.onerror = () => { setAiSpeaking(false); onDone?.(); };
    pendingAudioRef.current = utter;
    SYN.speak(utter);
  };

  // ------------------------ backend turn ------------------------
  const sendTurn = useCallback(async (userMessage: string) => {
    setThinking(true);
    try {
      const history = turns.map((t) => ({ role: t.role, content: t.content }));
      const { data } = await api.post('/meeting/turn', {
        categoryId, history, userMessage, language: 'ar',
      });
      const aiTurn: Turn = { role: 'assistant', content: data.reply, at: Date.now() };
      setTurns((prev) => [...prev, aiTurn]);
      const closing = data.status === 'closing';
      if (closing) setMeetingState('closing');
      speak(data.reply, () => {
        if (closing) finishMeeting([...turns, ...(userMessage ? [{ role: 'user' as const, content: userMessage, at: Date.now() }] : []), aiTurn]);
        else if (micOn) setTimeout(startRecognition, 400);
      });
    } catch (err: any) {
      Alert.alert('خطأ', err?.response?.data?.error || err.message);
    } finally {
      setThinking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, turns, micOn, startRecognition]);

  const sendUserMessage = useCallback(async (text: string) => {
    setTurns((prev) => [...prev, { role: 'user', content: text, at: Date.now() }]);
    await sendTurn(text);
  }, [sendTurn]);

  // ------------------------ start meeting ------------------------
  const startMeeting = useCallback(async () => {
    startedAtRef.current = Date.now();
    setMeetingState('active');
    // Ask Sarah for the opener with no user message.
    try {
      setThinking(true);
      const { data } = await api.post('/meeting/turn', {
        categoryId, history: [], userMessage: '', language: 'ar',
      });
      const opener: Turn = { role: 'assistant', content: data.reply, at: Date.now() };
      setTurns([opener]);
      speak(data.reply, () => {
        if (micOn) setTimeout(startRecognition, 400);
      });
    } catch (err: any) {
      Alert.alert('خطأ', err?.response?.data?.error || err.message);
    } finally {
      setThinking(false);
    }
  }, [categoryId, micOn, startRecognition]);

  // ------------------------ end meeting ------------------------
  const finishMeeting = useCallback(async (finalTurns?: Turn[]) => {
    stopRecognition();
    if (SYN) SYN.cancel();
    setMeetingState('ended');
    const history = (finalTurns ?? turns).map((t) => ({ role: t.role, content: t.content }));
    if (history.length < 2) { return; }
    try {
      setThinking(true);
      const { data } = await api.post('/meeting/finish', {
        categoryId, history, language: 'ar',
      });
      setEvaluation(data.evaluation);
    } catch (err: any) {
      Alert.alert('خطأ', err?.response?.data?.error || err.message);
    } finally {
      setThinking(false);
    }
  }, [categoryId, turns]);

  // ------------------------ mic toggle ------------------------
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

  // ------------------------ render ------------------------
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
          <Text style={[styles.resultTitle, textBold, { color: theme.colors.text }]}>
            تقييم المقابلة
          </Text>
          <View style={[styles.scoreBig, { backgroundColor: theme.colors.primary }]}>
            <Text style={[styles.scoreBigLabel, textRegular]}>الدرجة الإجمالية</Text>
            <Text style={[styles.scoreBigNum, textBold]}>{evaluation.overall_score}/10</Text>
            <Text style={[styles.scoreBigSummary, textRegular]}>{evaluation.summary}</Text>
          </View>
          <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Text style={[styles.cardTitle, textBold, { color: theme.colors.success }]}>نقاط القوة</Text>
            {(evaluation.strengths || []).map((s: string, i: number) => (
              <Text key={i} style={[textRegular, { color: theme.colors.text, lineHeight: 22 }]}>• {s}</Text>
            ))}
          </View>
          <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Text style={[styles.cardTitle, textBold, { color: theme.colors.warning }]}>نقاط التحسين</Text>
            {(evaluation.weaknesses || []).map((s: string, i: number) => (
              <Text key={i} style={[textRegular, { color: theme.colors.text, lineHeight: 22 }]}>• {s}</Text>
            ))}
          </View>
          <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Text style={[styles.cardTitle, textBold, { color: theme.colors.primary }]}>النصيحة</Text>
            <Text style={[textRegular, { color: theme.colors.text, lineHeight: 22 }]}>{evaluation.advice}</Text>
          </View>
          <Pressable
            onPress={() => navigation.navigate('Main')}
            style={[styles.btn, { backgroundColor: theme.colors.primary }]}
          >
            <Text style={[textBold, { color: '#fff' }]}>العودة للرئيسية</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: '#0A0E1A' }]}>
      {/* Top bar */}
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
          <Pressable
            onPress={() => finishMeeting()}
            style={styles.endBtn}
          >
            <Ionicons name="call" size={16} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
            <Text style={[textBold, { color: '#fff', fontSize: 13 }]}>إنهاء</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Main stage: AI avatar */}
      <View style={styles.stage}>
        <MotiView
          from={{ scale: 1 }}
          animate={{ scale: aiSpeaking ? 1.04 : 1 }}
          transition={{ type: 'timing', duration: 500, loop: aiSpeaking, repeatReverse: true }}
          style={styles.avatarOuter}
        >
          {aiSpeaking && <View style={styles.avatarPulse1} />}
          {aiSpeaking && <View style={styles.avatarPulse2} />}
          <View style={styles.avatarCore}>
            <Text style={[styles.avatarInitial, textBold]}>س</Text>
          </View>
        </MotiView>
        <Text style={[styles.avatarName, textBold]}>سارة</Text>
        <Text style={[styles.avatarRole, textRegular]}>مسؤولة الموارد البشرية</Text>

        {thinking && (
          <View style={styles.thinkingBadge}>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={[textRegular, { color: '#fff', marginStart: 8 }]}>تفكّر...</Text>
          </View>
        )}
        {listening && !thinking && (
          <View style={[styles.thinkingBadge, { backgroundColor: 'rgba(16,185,129,0.25)', borderColor: 'rgba(16,185,129,0.5)' }]}>
            <View style={styles.micDot} />
            <Text style={[textRegular, { color: '#fff', marginStart: 8 }]}>أستمع إليك...</Text>
          </View>
        )}
      </View>

      {/* Live transcript (last AI reply + user interim) */}
      <View style={styles.captionArea}>
        {turns.length > 0 && (
          <MotiView
            key={turns[turns.length - 1].at}
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 280 }}
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

      {/* PiP user camera */}
      {Platform.OS === 'web' && (
        <View style={styles.pipWrap}>
          <View style={styles.pip}>
            {/* @ts-ignore — direct HTMLVideoElement on web only */}
            <video
              ref={videoRef as any}
              autoPlay
              muted
              playsInline
              style={{
                width: '100%', height: '100%', objectFit: 'cover',
                transform: 'scaleX(-1)', // mirror like native video calls
                display: camOn ? 'block' : 'none',
              }}
            />
            {!camOn && (
              <View style={styles.pipOff}>
                <Ionicons name="videocam-off" size={26} color="#fff" />
              </View>
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
              onPress={() => { if (!thinking && !aiSpeaking) startRecognition(); }}
              disabled={!micOn || thinking || aiSpeaking || listening}
              style={[
                styles.ctrlBtn,
                {
                  backgroundColor: listening ? '#10B981' : theme.colors.primary,
                  opacity: (!micOn || thinking || aiSpeaking) ? 0.5 : 1,
                },
              ]}
            >
              <Ionicons name={listening ? 'radio' : 'mic-circle-outline'} size={22} color="#fff" />
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

  // top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  topBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444' },
  topBarText: { color: '#fff', fontSize: 14 },
  endBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: '#EF4444', borderRadius: 999,
  },

  // stage
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  avatarOuter: {
    width: 180, height: 180, borderRadius: 90,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
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
    backgroundColor: '#2D6CE0',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.18)',
  },
  avatarInitial: { color: '#fff', fontSize: 72, lineHeight: 82 },
  avatarName: { color: '#fff', fontSize: 22 },
  avatarRole: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },

  thinkingBadge: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 999, marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  micDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981' },

  // caption
  captionArea: {
    paddingHorizontal: 20, gap: 8, minHeight: 60,
    paddingBottom: 6,
  },
  captionCard: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    maxWidth: 640,
    alignSelf: 'center',
    width: '100%',
  },
  captionLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 11, marginBottom: 4 },
  captionText: { color: '#fff', fontSize: 15, lineHeight: 24 },
  interim: {
    color: 'rgba(255,255,255,0.65)', fontStyle: 'italic', fontSize: 13,
    textAlign: 'center',
  },

  // PiP
  pipWrap: {
    position: 'absolute', bottom: 110, left: 20,
  },
  pip: {
    width: 140, height: 100, borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1F2533',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.22)',
    position: 'relative',
  },
  pipOff: {
    position: 'absolute', inset: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1F2533',
  },
  pipLabel: {
    position: 'absolute', bottom: 4, left: 6,
    paddingVertical: 2, paddingHorizontal: 6,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 6,
  },

  // bottom
  bottomWrap: { paddingBottom: 20, paddingTop: 10 },
  controls: {
    flexDirection: 'row', justifyContent: 'center', gap: 14,
    paddingHorizontal: 20,
  },
  ctrlBtn: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  startBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    alignSelf: 'center',
    paddingVertical: 14, paddingHorizontal: 28,
    borderRadius: 999,
  },

  // Error state
  errWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  errTitle: { fontSize: 20 },
  errBody: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  btn: {
    paddingVertical: 12, paddingHorizontal: 20,
    borderRadius: 12, marginTop: 8, alignItems: 'center',
  },

  // Evaluation
  resultTitle: { fontSize: 24, textAlign: 'center', marginVertical: 8 },
  scoreBig: {
    borderRadius: 20, padding: 22, alignItems: 'center', gap: 6,
  },
  scoreBigLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  scoreBigNum: { color: '#fff', fontSize: 54 },
  scoreBigSummary: { color: 'rgba(255,255,255,0.9)', fontSize: 14, textAlign: 'center', lineHeight: 22, marginTop: 6 },
  card: {
    borderRadius: 14, padding: 16, borderWidth: StyleSheet.hairlineWidth, gap: 6,
  },
  cardTitle: { fontSize: 15, marginBottom: 4 },
});
