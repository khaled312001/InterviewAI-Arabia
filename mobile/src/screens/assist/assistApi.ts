/**
 * Live Interview Assistant — the calls, and what their failures mean.
 *
 * Everything except the answer goes through `api` (axios, with its session
 * renewal). The answer is a server-sent-event stream, which axios cannot read
 * as it arrives on a phone, so it uses `expo/fetch` — a streaming fetch on
 * iOS and Android, and the browser's own fetch on web.
 */

import axios from 'axios';
import { fetch as streamingFetch } from 'expo/fetch';

import { api, API_BASE, renewSession } from '../../api/client';
import { secureStorage } from '../../storage/secureStorage';

export type AssistLanguage = 'auto' | 'en' | 'ar';
export type AssistStyle = 'concise' | 'balanced' | 'detailed';
export type AnswerMode = 'answer' | 'regenerate' | 'shorter';
/** What the recogniser listens for. 'multi' is English plus the European languages. */
export type SpeechLanguage = 'en' | 'ar' | 'multi';

/** The `billing` block the clock returns on every tick and answer. */
export interface AssistBilling {
  remainingSeconds: number;
  remainingMinutes: number;
  billedSeconds: number;
  tickSeconds: number;
  warn: boolean;
  exhausted: boolean;
}

export interface AssistSetup {
  jobId?: string;
  jobTitle?: string;
  company?: string;
  jobDescription?: string;
  notes?: string;
  language: AssistLanguage;
  uiLanguage: 'ar' | 'en';
  style: AssistStyle;
}

export interface AssistSession {
  sessionId: string;
  resumed: boolean;
  billing: AssistBilling;
  hasCv: boolean;
  job: { id: string | null; title: string; company: string } | null;
  language: AssistLanguage;
  speechLanguage: SpeechLanguage;
  style: AssistStyle;
  streamingStt: boolean;
}

export interface ListenCredential {
  url: string;
  token: string;
  expiresIn: number;
  language: SpeechLanguage;
}

/**
 * Every failure the screen distinguishes. `expired` is recoverable — the
 * session was swept or superseded and a fresh one can be opened with the same
 * setup — the rest are shown to the user.
 */
export type AssistErrorKind =
  | 'quota' | 'expired' | 'stt' | 'ai' | 'rate' | 'network' | 'notFound' | 'other';

export class AssistError extends Error {
  constructor(public kind: AssistErrorKind, message: string = kind) {
    super(message);
    this.name = 'AssistError';
  }
}

function kindOf(status: number | undefined, code: string | undefined): AssistErrorKind {
  if (status === undefined) return 'network';
  if (status === 402 || code === 'QUOTA_EXCEEDED') return 'quota';
  if (code === 'MEETING_EXPIRED' || status === 409) return 'expired';
  if (code === 'STT_UNAVAILABLE') return 'stt';
  if (code === 'AI_UNAVAILABLE' || status === 503) return 'ai';
  if (status === 429) return 'rate';
  if (status === 404) return code === 'JOB_NOT_FOUND' ? 'notFound' : 'expired';
  return 'other';
}

/** Map anything thrown by these calls to one of the kinds above. */
export function assistErrorKind(e: unknown): AssistErrorKind {
  if (e instanceof AssistError) return e.kind;
  if (axios.isAxiosError(e)) {
    if (!e.response) return 'network';
    return kindOf(e.response.status, (e.response.data as { code?: string } | undefined)?.code);
  }
  return 'other';
}

export const assistApi = {
  start: (body: AssistSetup & { resumeSessionId?: string }) =>
    api.post<AssistSession>('/assist/start', body).then((r) => r.data),
  listen: (id: string) =>
    api.post<ListenCredential>(`/assist/${id}/listen`).then((r) => r.data),
  tick: (id: string) =>
    api.post<{ billing: AssistBilling }>(`/assist/${id}/tick`).then((r) => r.data.billing),
  end: (id: string) =>
    api.post(`/assist/${id}/end`).then((r) => r.data),
};

/* ------------------------------------------------------------------ *
 * The streamed answer
 * ------------------------------------------------------------------ */

export interface AnswerRequest {
  question: string;
  transcript: string;
  previous: string[];
  mode: AnswerMode;
}

export interface AnswerHandlers {
  onDelta: (text: string) => void;
  signal: AbortSignal;
}

/**
 * Stream one answer. Resolves with the billing block from the closing event,
 * or null when the stream ended without one; throws an AssistError.
 */
export async function streamAnswer(
  sessionId: string,
  body: AnswerRequest,
  { onDelta, signal }: AnswerHandlers,
): Promise<AssistBilling | null> {
  const send = (token: string | null) => streamingFetch(`${API_BASE}/assist/${sessionId}/answer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  let res;
  try {
    res = await send(await secureStorage.getItem('access_token'));
    if (res.status === 401) {
      const fresh = await renewSession();
      if (!fresh) throw new AssistError('other', 'Session ended');
      res = await send(fresh);
    }
  } catch (e) {
    if (e instanceof AssistError) throw e;
    if (signal.aborted) throw e;
    throw new AssistError('network');
  }

  if (!res.ok) {
    let code: string | undefined;
    let message: string | undefined;
    try {
      const data = await res.json();
      code = data?.code;
      message = data?.error;
    } catch { /* not JSON */ }
    throw new AssistError(kindOf(res.status, code), message);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new AssistError('other');
  const decoder = new TextDecoder();
  let buffer = '';
  let billing: AssistBilling | null = null;

  /** One SSE frame: `event:` and `data:` lines, blank-line terminated. */
  const handle = (frame: string) => {
    let event = 'message';
    let data = '';
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) return;
    let payload: any;
    try { payload = JSON.parse(data); } catch { return; }
    if (event === 'delta' && typeof payload?.text === 'string') onDelta(payload.text);
    else if (event === 'done') billing = payload?.billing ?? null;
    else if (event === 'error') throw new AssistError('ai', payload?.message);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');
      let cut = buffer.indexOf('\n\n');
      while (cut !== -1) {
        handle(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 2);
        cut = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim()) handle(buffer);
  } catch (e) {
    if (e instanceof AssistError) throw e;
    if (signal.aborted) throw e;
    throw new AssistError('network');
  }
  return billing;
}
