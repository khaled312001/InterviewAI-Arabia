/**
 * The career platform's client side: types that mirror the backend's
 * `/api/jobs` and `/api/career` responses, the calls themselves, and the two
 * things every career screen needs — turning a server error into a localised
 * line, and opening a CV download.
 */

import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import axios from 'axios';
import { api, API_BASE } from '../../api/client';

export type Workplace = 'onsite' | 'hybrid' | 'remote';
export type Seniority = 'intern' | 'junior' | 'mid' | 'senior' | 'lead' | 'executive';
export type AppStatus = 'saved' | 'applied' | 'screening' | 'interview' | 'offer' | 'accepted' | 'rejected' | 'withdrawn';
export const APP_STATUSES: AppStatus[] = ['saved', 'applied', 'screening', 'interview', 'offer', 'accepted', 'rejected', 'withdrawn'];
export const CV_LANGUAGES = ['en', 'ar', 'de', 'fr', 'es'] as const;
export type CvLanguage = (typeof CV_LANGUAGES)[number];
/** The offline fallback; the server's /career/templates is the real list (it grows). */
export const TEMPLATES: readonly string[] = ['classic', 'modern', 'compact', 'executive', 'elegant', 'minimal', 'tech', 'bold', 'creative', 'emerald'];
export type Template = string;

export interface Skill { key: string; label: string }

export interface JobCard {
  id: string;
  title: string;
  company: string;
  companyLogo: string | null;
  url: string;
  applyUrl: string;
  location: string | null;
  country: string | null;
  city: string | null;
  workplace: Workplace | null;
  employmentType: string | null;
  seniority: Seniority | null;
  salary: { min: number | null; max: number | null; currency: string | null; period: string | null } | null;
  skills: Skill[];
  postedAt: string | null;
  sourceName: string;
  snippet?: string;
  match?: { score: number; missing: string[] };
  tracked?: AppStatus | null;
  /** Returned by a live feed for this very search, seconds ago. */
  live?: boolean;
}

export interface SearchResult {
  total: number;
  jobs: JobCard[];
  matched: boolean;
  /** No job had every word, so any-word matching was used. */
  relaxed?: boolean;
  query?: { typed: string; searched: string; translated: boolean; country: string | null; remote: boolean };
  live?: false | { at: string; count: number; sources: string[] };
  checkedAt?: string;
}

export interface TemplateInfo {
  id: Template; nameEn: string; nameAr: string; descEn: string; descAr: string;
  accent?: string; category?: string; categoryEn?: string; categoryAr?: string;
  /** The design has a photo circle — the builder asks for a photo. */
  photo?: boolean; ats?: 'best' | 'good'; columns?: number;
}
export interface ExampleRole { id: string; labelEn: string; labelAr: string }

/** AI tools whose first use is still free for this account. */
export type FreeTool = 'cv_import' | 'cv_bullets' | 'cv_tailor' | 'cover_letter';

export interface JobDetail extends JobCard {
  description: string;
  isActive: boolean;
  language: string | null;
}

export interface MatchResult {
  score: number;
  breakdown: { skills: number; title: number; level: number; location: number };
  matched: Skill[];
  missing: Skill[];
}

export interface AtsCheck {
  id: string;
  ok: boolean;
  severity: 'high' | 'medium' | 'low';
  message: { en: string; ar: string };
  tip: { en: string; ar: string } | null;
}

export interface AtsReport {
  score: number;
  grade: 'strong' | 'fair' | 'weak';
  structureScore: number;
  keywords: {
    coverage: number;
    matched: Skill[];
    missing: Skill[];
    termsFound: string[];
    termsMissing: string[];
    titleMatch: number;
  } | null;
  skillsFound: Skill[];
  wordCount: number;
  checks: AtsCheck[];
}

export interface CvData {
  basics: { name: string; headline: string; email: string; phone: string; location: string; links: { label: string; url: string }[]; summary: string; photo?: string };
  experience: { title: string; company: string; location: string; start: string; end: string; current: boolean; bullets: string[] }[];
  education: { degree: string; field: string; school: string; location: string; start: string; end: string; details: string }[];
  skills: string[];
  languages: { name: string; level: string }[];
  certifications: { name: string; issuer: string; date: string }[];
  projects: { name: string; url: string; description: string; bullets: string[] }[];
}

export interface CareerProfile {
  cv: CvData;
  skills: string[];
  targetTitle: string;
  targetCountry: string;
  openToRemote: boolean;
  years: number | null;
  updatedAt: string | null;
}

export interface CvVersion {
  id: string;
  jobId: string | null;
  title: string;
  template: Template;
  language: CvLanguage;
  atsScore: number | null;
  hasLetter: boolean;
  createdAt: string;
  updatedAt: string;
  cv?: CvData;
  coverLetter?: string;
}

export interface Application {
  id: string;
  jobId: string | null;
  title: string;
  company: string;
  url: string | null;
  location: string | null;
  status: AppStatus;
  notes: string;
  cvVersionId: string | null;
  matchScore: number | null;
  appliedAt: string | null;
  /** When the next step is — set by scheduling an interview from the calendar. */
  nextActionAt?: string | null;
  updatedAt: string;
  jobActive: boolean | null;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: { q?: string; country?: string; workplace?: string };
  frequency: 'off' | 'daily' | 'weekly';
  lastSentAt: string | null;
}

export interface Overview {
  hasProfile: boolean;
  targetTitle: string;
  targetCountry: string;
  cvScore: number | null;
  applications: Partial<Record<AppStatus, number>>;
  versions: number;
  savedSearches: number;
  freeUses?: Partial<Record<FreeTool, boolean>>;
}

export interface TailorResult {
  version: CvVersion & { cv: CvData; coverLetter: string | null };
  changes: string[];
  gaps: string[];
  questions: string[];
  ats: { before: number; after: number; report: AtsReport };
}

export function emptyCv(): CvData {
  return {
    basics: { name: '', headline: '', email: '', phone: '', location: '', links: [], summary: '' },
    experience: [], education: [], skills: [], languages: [], certifications: [], projects: [],
  };
}

/* ------------------------------------------------------------- calls */

export const careerApi = {
  // Live: the server asks the job feeds at the moment of the search, so give it a little longer.
  search: (params: Record<string, string | number | undefined>) =>
    api.get<SearchResult>('/jobs/search', { params, timeout: 30000 }).then((r) => r.data),
  newCount: (params: Record<string, string | number | undefined>) =>
    api.get<{ count: number; checkedAt: string }>('/jobs/new-count', { params }).then((r) => r.data),
  templates: () => api.get<{ templates: TemplateInfo[] }>('/career/templates?v=2').then((r) => r.data.templates),
  examples: () => api.get<{ roles: ExampleRole[] }>('/career/examples').then((r) => r.data.roles),
  example: (role: string, lang: string) =>
    api.get<{ role: string; labelEn: string; labelAr: string; cv: CvData }>(`/career/examples/${role}`, { params: { lang } }).then((r) => r.data),
  freeUses: () => api.get<{ freeUses: Partial<Record<FreeTool, boolean>> }>('/career/free-uses').then((r) => r.data.freeUses),
  facets: (lang: string) =>
    api.get<{ countries: { key: string; count: number; name: string }[] }>('/jobs/facets', { params: { lang } }).then((r) => r.data),
  job: (id: string) =>
    api.get<{ job: JobDetail; similar: JobCard[]; match: MatchResult | null }>(`/jobs/${id}`).then((r) => r.data),

  overview: () => api.get<Overview>('/career/overview').then((r) => r.data),
  profile: () => api.get<{ profile: CareerProfile; exists: boolean }>('/career/profile').then((r) => r.data),
  saveProfile: (body: { cv: CvData; targetTitle: string; targetCountry: string; openToRemote: boolean }) =>
    api.put<{ profile: CareerProfile }>('/career/profile', body).then((r) => r.data),
  matches: (params: { country?: string; remote?: '1' } = {}) =>
    api.get<{ query: { title: string; country: string | null }; jobs: JobCard[] }>('/career/matches', { params }).then((r) => r.data),
  match: (jobId: string) =>
    api.get<{ match: MatchResult; ats: AtsReport }>(`/career/match/${jobId}`).then((r) => r.data),
  ats: (body: { versionId?: string; jobId?: string; jobTitle?: string; jobDescription?: string }) =>
    api.post<AtsReport>('/career/ats', body).then((r) => r.data),
  // Model calls can take a while on a slow provider; give them room.
  tailor: (body: Record<string, unknown>) =>
    api.post<TailorResult>('/career/tailor', body, { timeout: 120000 }).then((r) => r.data),
  coverLetter: (body: Record<string, unknown>) =>
    api.post<{ subject: string; letter: string }>('/career/cover-letter', body, { timeout: 90000 }).then((r) => r.data),
  improveBullets: (body: { bullets: string[]; title: string; uiLanguage: string }) =>
    api.post<{ bullets: string[]; tips: string[] }>('/career/improve-bullets', body, { timeout: 90000 }).then((r) => r.data),

  versions: () => api.get<{ versions: CvVersion[] }>('/career/versions').then((r) => r.data.versions),
  version: (id: string) => api.get<{ version: CvVersion }>(`/career/versions/${id}`).then((r) => r.data.version),
  updateVersion: (id: string, body: Partial<{ title: string; template: Template; language: CvLanguage; coverLetter: string }>) =>
    api.put(`/career/versions/${id}`, body).then((r) => r.data),
  deleteVersion: (id: string) => api.delete(`/career/versions/${id}`).then((r) => r.data),

  applications: () =>
    api.get<{ applications: Application[]; counts: Record<AppStatus, number> }>('/career/applications').then((r) => r.data),
  track: (body: { jobId?: string; title?: string; company?: string; url?: string; status?: AppStatus }) =>
    api.post<{ application: Application }>('/career/applications', body).then((r) => r.data.application),
  updateApplication: (id: string, body: Partial<{ status: AppStatus; notes: string }>) =>
    api.patch<{ application: Application }>(`/career/applications/${id}`, body).then((r) => r.data.application),
  deleteApplication: (id: string) => api.delete(`/career/applications/${id}`).then((r) => r.data),

  searches: () => api.get<{ searches: SavedSearch[] }>('/career/searches').then((r) => r.data.searches),
  saveSearch: (body: { name: string; query: Record<string, string>; frequency: SavedSearch['frequency'] }) =>
    api.post<{ search: SavedSearch }>('/career/searches', body).then((r) => r.data.search),
  updateSearch: (id: string, body: Partial<Pick<SavedSearch, 'frequency' | 'name'>>) =>
    api.patch(`/career/searches/${id}`, body).then((r) => r.data),
  deleteSearch: (id: string) => api.delete(`/career/searches/${id}`).then((r) => r.data),
};

/* ------------------------------------------------------------ errors */

export type CareerErrorKind = 'quota' | 'profile' | 'ai' | 'rate' | 'notFound' | 'network' | 'invalid' | 'other';

export function errorKind(e: unknown): CareerErrorKind {
  if (!axios.isAxiosError(e)) return 'other';
  if (!e.response) return 'network';
  const code = (e.response.data as { code?: string } | undefined)?.code;
  if (e.response.status === 402 || code === 'QUOTA_EXCEEDED') return 'quota';
  if (code === 'PROFILE_REQUIRED') return 'profile';
  if (code === 'AI_UNAVAILABLE' || e.response.status === 503) return 'ai';
  if (e.response.status === 429) return 'rate';
  if (e.response.status === 404) return 'notFound';
  if (e.response.status === 422 || e.response.status === 400) return 'invalid';
  return 'other';
}

/* --------------------------------------------------------- downloads */

/**
 * The site origin the API lives on: '' on web (same origin), the absolute
 * host on native.
 */
function apiOrigin(): string {
  return /^https?:\/\//.test(API_BASE) ? API_BASE.replace(/\/api\/?$/, '') : '';
}

/**
 * Open a CV or letter download.
 *
 * The server hands back a short-lived signed link, so the file opens in the
 * system browser (or a new tab) with no auth header. On web the tab is opened
 * BEFORE the request, synchronously inside the tap, because a window opened
 * after an await is a popup the browser blocks.
 */
export async function openDownload(body: {
  kind?: 'cv' | 'letter';
  versionId?: string;
  format: 'html' | 'pdf' | 'docx';
  template?: Template;
  language?: CvLanguage;
}): Promise<void> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const tab = window.open('', '_blank');
    try {
      const { data } = await api.post<{ url: string }>('/career/print-link', body);
      if (tab) tab.location.href = `${window.location.origin}${data.url}`;
      else window.location.href = data.url;
    } catch (e) {
      tab?.close();
      throw e;
    }
    return;
  }
  const { data } = await api.post<{ url: string }>('/career/print-link', body);
  await WebBrowser.openBrowserAsync(`${apiOrigin()}${data.url}`);
}

/** A small picture of the template (made at build time, served next to the site). */
export function templateThumbUrl(id: Template, lang: string): string {
  const origin = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : apiOrigin();
  return `${origin}/shots/cv/${encodeURIComponent(id)}-${lang === 'ar' ? 'ar' : 'en'}.webp`;
}

/** A template rendered with an example CV — for the gallery's "Preview". Public, no auth. */
export function templatePreviewUrl(id: Template, lang: string, role?: string): string {
  const origin = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : apiOrigin();
  const q = `lang=${lang === 'ar' ? 'ar' : 'en'}${role ? `&role=${encodeURIComponent(role)}` : ''}`;
  return `${origin}/api/career/templates/${id}/preview?${q}`;
}

/** The employer's (or the source's) own page, outside the app. */
export async function openExternal(url: string): Promise<void> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener');
    return;
  }
  await WebBrowser.openBrowserAsync(url);
}

/* ---------------------------------------------------------- display */

export function countryName(code: string | null | undefined, lang: string): string {
  if (!code) return '';
  try {
    const Names = (Intl as unknown as { DisplayNames?: new (l: string[], o: { type: string }) => { of: (c: string) => string } }).DisplayNames;
    if (Names) return new Names([lang], { type: 'region' }).of(code) || code;
  } catch { /* fall through */ }
  return code;
}

export function salaryLabel(s: JobCard['salary']): string {
  if (!s || (!s.min && !s.max)) return '';
  const f = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const range = [s.min, s.max].filter((n): n is number => Boolean(n)).map(f).join('–');
  const per = s.period === 'year' ? '/yr' : s.period === 'month' ? '/mo' : s.period === 'hour' ? '/hr' : '';
  return `${s.currency ? `${s.currency} ` : ''}${range}${per}`;
}

/** 0–100 → the same tones the 0–10 interview scores use. */
export function percentTone(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 75) return 'success';
  if (score >= 55) return 'warning';
  return 'danger';
}
