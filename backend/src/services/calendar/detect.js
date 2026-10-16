/**
 * Reading a calendar event the way a job seeker would: is this an interview,
 * and where do I click to join it? Pure functions — no network, no env.
 */

/*
 * Words that make an event look like part of a hiring process. English ones
 * are matched on word boundaries ("screen" must not fire on "screenshot");
 * Arabic has no reliable \b in JS regex and is matched as a substring, which
 * is also what makes the definite-article forms (المقابلة) match for free.
 */
const EN_WORDS = [
  'interview', 'interviews', 'interviewing', 'screening', 'phone screen', 'hiring', 'recruiter',
  'recruiting', 'recruitment', 'talent acquisition', 'technical round', 'final round',
  'hiring manager', 'culture fit', 'hr call', 'job offer',
  // Other job-market languages the platform serves.
  'entretien', 'entrevista', 'vorstellungsgespräch', 'bewerbungsgespräch', 'colloquio',
];
const AR_WORDS = [
  'مقابلة', 'مقابله', 'مقابلات', 'توظيف', 'الموارد البشرية', 'مسؤول التوظيف',
  'اختبار فني', 'تقييم فني', 'عرض وظيفي', 'لقاء عمل',
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EN_RE = new RegExp(`(^|[^\\p{L}\\p{N}])(${EN_WORDS.map(escapeRe).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu');

export function looksLikeInterview(...texts) {
  const hay = texts.filter(Boolean).join('\n');
  if (!hay) return false;
  if (EN_RE.test(hay)) return true;
  return AR_WORDS.some((w) => hay.includes(w));
}

/* ------------------------------------------------------------ join links */

const PROVIDERS = [
  { id: 'meet', re: /https:\/\/meet\.google\.com\/[a-z0-9-]+(?:\?[^\s"'<>]*)?/i },
  { id: 'zoom', re: /https:\/\/(?:[a-z0-9-]+\.)?zoom\.(?:us|com)\/(?:j|my|w|s)\/[^\s"'<>]+/i },
  { id: 'teams', re: /https:\/\/teams\.(?:microsoft|live)\.com\/[^\s"'<>]+/i },
  { id: 'webex', re: /https:\/\/[a-z0-9-]+\.webex\.com\/[^\s"'<>]+/i },
  { id: 'whereby', re: /https:\/\/whereby\.com\/[^\s"'<>]+/i },
  { id: 'jitsi', re: /https:\/\/meet\.jit\.si\/[^\s"'<>]+/i },
];

/** Google returns descriptions as HTML; URLs inside come entity-encoded. */
function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function providerOf(url) {
  for (const p of PROVIDERS) if (p.re.test(url)) return p.id;
  return 'other';
}

/** Strip punctuation a sentence leaves stuck to the end of a URL. */
const trimUrl = (u) => u.replace(/[).,;:!?\]]+$/, '');

function isHttps(u) {
  try { return new URL(u).protocol === 'https:'; } catch { return false; }
}

/**
 * The best "Join" link for a Google Calendar event resource.
 * Order: the event's own Meet link, its conference entry points, then a known
 * video provider found in the location or the description.
 *
 * @returns {{ url: string, provider: string } | null}
 */
export function findJoinLink(event) {
  if (event?.hangoutLink && isHttps(event.hangoutLink)) {
    return { url: event.hangoutLink, provider: 'meet' };
  }
  const entry = (event?.conferenceData?.entryPoints || []).find((e) => e.entryPointType === 'video' && isHttps(e.uri));
  if (entry) return { url: entry.uri, provider: providerOf(entry.uri) };

  const text = decodeEntities(`${event?.location || ''}\n${event?.description || ''}`);
  for (const p of PROVIDERS) {
    const m = p.re.exec(text);
    if (m) return { url: trimUrl(m[0]), provider: p.id };
  }
  return null;
}

/** Plain text from Google's HTML description, capped. */
export function plainDescription(html, max = 1000) {
  const text = decodeEntities(String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
