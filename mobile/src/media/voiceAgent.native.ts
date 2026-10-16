/**
 * Live voice interview — native build.
 *
 * NOT IMPLEMENTED, AND SAYING SO IS THE FEATURE. `supported` is false, the
 * call screen sees that and runs the typed interview it has always run:
 * on-device recognition, POST /meeting/turn, device voice. Nothing regresses
 * on a phone because of this file.
 *
 * WHY IT IS NOT IMPLEMENTED YET. The agent needs two things React Native does
 * not have: a microphone that yields raw 16 kHz PCM frames while the call is
 * running, and a player that accepts a stream of PCM chunks with no end. Expo's
 * audio modules give neither — `expo-speech-recognition` hands back text, and
 * `expo-av` plays files. Both need a native module, which is why the web build
 * ships first: it proves the backend, the prompt and the voice on a platform
 * where the browser already owns the hard parts, including the echo
 * cancellation that stops the interviewer from interrupting herself.
 *
 * WHAT IMPLEMENTING IT LOOKS LIKE. An Expo module beside `modules/screen-recorder`,
 * exposing an AudioRecord configured for VOICE_COMMUNICATION on Android (which
 * is what enables the platform AEC and noise suppressor) and AVAudioSession's
 * `voiceChat` mode on iOS, plus an AudioTrack/AVAudioEngine sink for playback.
 * The websocket itself is the easy half: React Native's WebSocket accepts the
 * subprotocol array the browser uses, and also the Authorization header the
 * browser cannot send.
 */

import { useMemo } from 'react';

import type { UseVoiceAgent, VoiceAgentController } from './contract';

export const useVoiceAgent: UseVoiceAgent = (): VoiceAgentController => useMemo(() => ({
  supported: false,
  state: 'idle' as const,
  speaker: 'none' as const,
  muted: false,
  async start() { /* unreachable: the screen checks `supported` first */ },
  setMuted() {},
  stop() {},
  release() {},
}), []);
