/**
 * The live transcript, as the assistant screen sees it — one surface, two
 * builds (`liveTranscriber.web.ts`, `liveTranscriber.native.ts`). Both annotate
 * their hook with `UseLiveTranscriber`, which is what keeps them in step: the
 * bundler never compares the two, so the type has to.
 *
 *   web     The microphone (or a meeting tab's audio) streams to the server-side
 *           recogniser over a websocket, with a credential from /assist/:id/listen.
 *           The browser's own recogniser is the fallback when that is not set up.
 *   native  The on-device recogniser the practice interview already uses
 *           (expo-speech-recognition), held open for the whole session.
 */

import type { ListenCredential, SpeechLanguage } from './assistApi';

/** Where the audio comes from. 'tab' is a shared browser tab — desktop web only. */
export type TranscriberSource = 'mic' | 'tab';

export type TranscriberError =
  /** Microphone permission refused. */
  | 'denied'
  /** No recogniser on this device or browser. */
  | 'unsupported'
  /** The connection to the recogniser kept dropping. */
  | 'network'
  /** A tab was shared without its audio. */
  | 'noTabAudio'
  /** The user stopped sharing the tab, or closed the picker. */
  | 'sourceEnded'
  /** The session behind the credential is over — open a new one. */
  | 'expired'
  /** Out of minutes. */
  | 'quota';

export type TranscriberState = 'idle' | 'starting' | 'listening' | 'reconnecting';

export interface LiveTranscriberOptions {
  language: SpeechLanguage;
  /** The server has a streaming recogniser (web only uses it). */
  streaming: boolean;
  /** A fresh streaming credential. Throws an AssistError. */
  getCredential: () => Promise<ListenCredential>;
  /** One finished stretch of speech. */
  onFinal: (text: string) => void;
  /** The speaker paused — the recogniser's end of an utterance. */
  onTurnEnd: () => void;
  onError: (code: TranscriberError) => void;
}

export interface LiveTranscriber {
  readonly supported: boolean;
  /** A meeting tab's audio can be captured (desktop browsers). */
  readonly canCaptureTab: boolean;
  readonly state: TranscriberState;
  /** Words still being recognised; cleared when they become final. */
  readonly interim: string;
  start(source?: TranscriberSource): Promise<void>;
  /** Stop listening and release the microphone. Never emits a final. */
  stop(): void;
}

export type UseLiveTranscriber = (opts: LiveTranscriberOptions) => LiveTranscriber;
