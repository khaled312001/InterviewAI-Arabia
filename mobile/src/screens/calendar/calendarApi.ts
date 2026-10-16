/**
 * Client for /api/calendar — Google Calendar, Meet and Tasks, plus the .ics
 * fallback that works for everyone.
 */

import { Platform } from 'react-native';
import axios from 'axios';
import * as WebBrowser from 'expo-web-browser';

import { api, authFetch } from '../../api/client';

export type EventKind = 'interview' | 'practice' | 'prep';
export type JoinProvider = 'meet' | 'zoom' | 'teams' | 'webex' | 'whereby' | 'jitsi' | 'other';

export interface CalendarStatus {
  configured: boolean;
  provider: 'google';
  connected: boolean;
  email: string | null;
  scopes: { calendar: boolean; tasks: boolean };
  connectedAt: string | null;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  location: string | null;
  description: string;
  joinUrl: string | null;
  joinProvider: JoinProvider | null;
  looksLikeInterview: boolean;
  kind: EventKind | null;
  company: string | null;
  role: string | null;
  htmlLink: string | null;
  organizer: string | null;
}

export interface CalendarTask {
  id: string;
  title: string;
  notes: string;
  due: string | null;
  webViewLink: string | null;
}

export interface NewEvent {
  kind: EventKind;
  start: string;
  durationMinutes: number;
  timeZone?: string;
  title?: string;
  company?: string;
  role?: string;
  notes?: string;
  addMeet?: boolean;
  jobId?: string;
  applicationId?: string;
  language: 'en' | 'ar';
}

export interface LinkedApplication {
  id: string;
  status: string;
  nextActionAt: string | null;
}

/** The deep link the backend sends native flows back to (app.json → scheme). */
export const NATIVE_RETURN = 'interprova://calendar';

export const calendarApi = {
  status: () => api.get<CalendarStatus>('/calendar/status').then((r) => r.data),
  events: (days = 14) =>
    api.get<{ events: CalendarEvent[]; days: number }>('/calendar/events', { params: { days } }).then((r) => r.data),
  createEvent: (body: NewEvent) =>
    api.post<{ event: CalendarEvent; application: LinkedApplication | null }>('/calendar/events', body).then((r) => r.data),
  tasks: () => api.get<{ tasks: CalendarTask[] }>('/calendar/tasks').then((r) => r.data.tasks),
  createTask: (body: { title: string; notes?: string; due?: string; jobId?: string }) =>
    api.post<{ task: CalendarTask }>('/calendar/tasks', body).then((r) => r.data.task),
  disconnect: () => api.delete('/calendar/google').then((r) => r.data),
};

/** The device's IANA zone, so Google shows the event in the zone it was planned in. */
export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------ connect */

export type ConnectOutcome = 'connected' | 'error' | 'denied' | 'cancelled' | 'redirecting';

function outcomeFromUrl(url: string): ConnectOutcome {
  const query = url.split('?')[1] || '';
  const params = new URLSearchParams(query.split('#')[0]);
  if (params.get('calendar') === 'connected') return 'connected';
  return params.get('reason') === 'denied' ? 'denied' : 'error';
}

/**
 * Start the Google consent flow.
 *
 * Web: a full-page redirect. A popup would have to survive Google's
 * Cross-Origin-Opener-Policy (see auth/completeAuthSession.ts for what that
 * costs); a redirect cannot lose its way back. The callback returns to /app
 * with `?calendar=…`, which calendarReturn.ts picks up on the next load.
 *
 * Native: an auth session that closes itself when the backend redirects to
 * interprova://calendar.
 */
export async function connectGoogle(): Promise<ConnectOutcome> {
  if (Platform.OS === 'web') {
    const origin = typeof window !== 'undefined' ? window.location?.origin : undefined;
    const { data } = await api.get<{ url: string }>('/calendar/google/connect', { params: { target: 'web', origin } });
    window.location.assign(data.url);
    return 'redirecting';
  }
  const { data } = await api.get<{ url: string }>('/calendar/google/connect', { params: { target: 'native' } });
  const result = await WebBrowser.openAuthSessionAsync(data.url, NATIVE_RETURN);
  if (result.type === 'success' && result.url) return outcomeFromUrl(result.url);
  return 'cancelled';
}

/* ---------------------------------------------------------------- ics */

/** Ask the server for the .ics text. Works without any Google connection. */
export async function fetchIcs(body: NewEvent): Promise<{ text: string; filename: string }> {
  const res = await authFetch('/calendar/ics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/calendar' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(`ics ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const disposition = res.headers.get('content-disposition') || '';
  const match = /filename="([^"]+)"/.exec(disposition);
  return { text: await res.text(), filename: match?.[1] || 'interprova-interview.ics' };
}

/* ------------------------------------------------------------- errors */

export type CalendarErrorKind = 'notConfigured' | 'notConnected' | 'scope' | 'rate' | 'network' | 'other';

export function calendarErrorKind(e: unknown): CalendarErrorKind {
  const status = axios.isAxiosError(e)
    ? e.response?.status
    : (e as { status?: number } | null)?.status;
  const code = axios.isAxiosError(e) ? (e.response?.data as { code?: string } | undefined)?.code : undefined;
  if (axios.isAxiosError(e) && !e.response) return 'network';
  if (code === 'CALENDAR_NOT_CONFIGURED' || status === 503) return 'notConfigured';
  if (code === 'CALENDAR_NOT_CONNECTED' || status === 409) return 'notConnected';
  if (code === 'CALENDAR_SCOPE_MISSING' || code === 'TASKS_SCOPE_MISSING' || status === 403) return 'scope';
  if (status === 429) return 'rate';
  if (e instanceof TypeError) return 'network';
  return 'other';
}

/* ------------------------------------------------------------ display */

const localeOf = (language: string) => (language?.startsWith('ar') ? 'ar-EG' : 'en-GB');

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Local midnight of the day an event starts on — all-day events are dates, not instants. */
export function eventDay(ev: Pick<CalendarEvent, 'start' | 'allDay'>): Date | null {
  if (!ev.start) return null;
  if (ev.allDay) {
    const [y, m, d] = ev.start.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }
  const d = new Date(ev.start);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function formatTime(value: Date | string, language: string): string {
  const d = value instanceof Date ? value : new Date(value);
  try {
    return d.toLocaleTimeString(localeOf(language), { hour: '2-digit', minute: '2-digit' });
  } catch {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

export function formatDayLong(d: Date, language: string): string {
  try {
    return d.toLocaleDateString(localeOf(language), { weekday: 'long', day: 'numeric', month: 'long' });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function formatDayShort(d: Date, language: string): { weekday: string; day: string; month: string } {
  try {
    const loc = localeOf(language);
    return {
      weekday: d.toLocaleDateString(loc, { weekday: 'short' }),
      day: d.toLocaleDateString(loc, { day: 'numeric' }),
      month: d.toLocaleDateString(loc, { month: 'short' }),
    };
  } catch {
    return { weekday: '', day: String(d.getDate()), month: String(d.getMonth() + 1) };
  }
}

/** "Today" / "Tomorrow" / "Tuesday 20 October". */
export function dayLabel(d: Date, language: string, t: (k: string) => string): string {
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (sameDay(d, today)) return t('calendar.today');
  if (sameDay(d, tomorrow)) return t('calendar.tomorrow');
  return formatDayLong(d, language);
}

export function durationLabel(minutes: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return t('calendar.durationMin', { n: m });
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? t('calendar.durationHoursMin', { h, m: rest }) : t('calendar.durationHours', { h });
}

/** `YYYY-MM-DD` in local time. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
