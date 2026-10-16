/**
 * Turning one feed's idea of a job into ours.
 *
 * Every connector in sources.js hands raw fields to `normalizeJob()`, which
 * owns the decisions that must be made the same way for every feed: plain-text
 * description, country, workplace, seniority, employment type, salary, skills,
 * and the dedup hash that makes one job seen through two feeds a single row.
 */

import crypto from 'node:crypto';
import { parseLocation } from './countries.js';
import { extractSkills } from './skills.js';

const MAX_DESCRIPTION = 20000;

/* -------------------------------------------------------------- text */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', bull: '•', middot: '·',
  eacute: 'é', egrave: 'è', agrave: 'à', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß', ccedil: 'ç',
  euro: '€', pound: '£', copy: '©', reg: '®', trade: '™', laquo: '«', raquo: '»',
};

export function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => safeChar(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeChar(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function safeChar(code) {
  try { return String.fromCodePoint(code); } catch { return ''; }
}

/**
 * HTML → readable plain text that keeps the structure a reader relies on:
 * paragraphs become blank lines, list items become "• " lines, headings stand
 * on their own line. Scripts, styles and every attribute are dropped.
 */
export function htmlToText(html) {
  let s = String(html || '');
  // Greenhouse and some aggregators encode the markup once or twice: the HTML
  // arrives as &lt;p&gt; or &amp;lt;p&amp;gt;. Decode until real tags appear.
  for (let i = 0; i < 3 && /&(?:amp;)*lt;\/?[a-z]/i.test(s); i += 1) s = decodeEntities(s);
  s = s
    .replace(/<(script|style|noscript|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|section|article|ul|ol|li|tr|table|blockquote)>/gi, '\n')
    .replace(/<(h[1-6])[^>]*>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<(p|div|section|article|ul|ol|table|blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s)
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n•\s*\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s.length > MAX_DESCRIPTION ? `${s.slice(0, MAX_DESCRIPTION)}…` : s;
}

/** Plain text from a feed: same whitespace rules as htmlToText, no tag handling. */
export function plainText(text) {
  const s = decodeEntities(String(text || ''))
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s.length > MAX_DESCRIPTION ? `${s.slice(0, MAX_DESCRIPTION)}…` : s;
}

export function clean(s, max = 255) {
  const out = decodeEntities(String(s ?? '')).replace(/\s+/g, ' ').trim();
  return out.length > max ? out.slice(0, max - 1) + '…' : out;
}

/* ---------------------------------------------------- classification */

export function detectWorkplace({ remote, workplace, location, title, text }) {
  const w = String(workplace || '').toLowerCase();
  if (w.includes('hybrid')) return 'hybrid';
  if (w.includes('remote')) return 'remote';
  if (w.includes('onsite') || w.includes('on-site') || w.includes('office')) {
    return /\bremote\b/i.test(location || '') ? 'hybrid' : 'onsite';
  }
  if (remote === true) return 'remote';
  const loc = `${location || ''} ${title || ''}`;
  if (/\bhybrid\b/i.test(loc)) return 'hybrid';
  if (/\b(remote|anywhere|worldwide|work from home|wfh|home[- ]?office|fully distributed)\b/i.test(loc)) return 'remote';
  if (remote === false) return 'onsite';
  if (text && /\b(fully remote|100% remote|remote-first|work from anywhere)\b/i.test(text.slice(0, 3000))) return 'remote';
  return 'onsite';
}

export function detectSeniority(title, hint) {
  const h = String(hint || '').toLowerCase();
  const t = `${title || ''}`.toLowerCase();
  const probe = `${h} ${t}`;
  if (/\b(intern|internship|praktikum|werkstudent|trainee|apprentice|stagiaire|stage)\b/.test(probe)) return 'intern';
  // An explicit level in the title wins over the job family: a "Junior
  // Account Manager" is junior, a "Senior Product Manager" is senior. A bare
  // "Manager" says nothing about level, so it is not read as one.
  if (/\b(junior|jr\.?|entry[- ]level|graduate|new grad|berufseinsteiger)\b/.test(t)) return 'junior';
  if (/\b(chief|cto|ceo|cfo|coo|cmo|vp|vice president|head of|director|managing director|geschäftsführer)\b/.test(t) || h.includes('executive') || h.includes('director')) return 'executive';
  if (/\b(principal|staff|lead|team lead|tech lead|engineering manager)\b/.test(t)) return 'lead';
  if (/\b(senior|sr\.?|iii|iv|expert)\b/.test(t) || h.includes('senior')) return 'senior';
  if (h.includes('lead') || h.includes('manager')) return 'lead';
  if (/\barchitect\b/.test(t)) return 'senior';
  if (/\bassociate\b/.test(t) || h.includes('entry') || h.includes('junior')) return 'junior';
  if (h.includes('mid') || /\b(ii|mid[- ]level|intermediate)\b/.test(t)) return 'mid';
  return null;
}

/**
 * The feed's own employment-type field is trusted; the title is only a
 * fallback, and only for explicit markers. Word boundaries matter: an
 * "International" role is not an internship, and a "Contract Manager" or
 * "Sales Consultant" is a role, not a contract.
 */
export function detectEmploymentType(hint, title) {
  const s = [].concat(hint || []).filter(Boolean).join(' ').toLowerCase();
  if (s) {
    if (/\b(intern|internship|praktikum|werkstudent|trainee|stage|apprenticeship)\b/.test(s)) return 'internship';
    if (/part[\s_-]?time|teilzeit|minijob/.test(s)) return 'part_time';
    if (/\b(contract|contractor|freelance|freelancer|befristet)\b/.test(s)) return 'contract';
    if (/\b(temporary|temp|seasonal)\b/.test(s)) return 'temporary';
    if (/full[\s_-]?time|\b(permanent|vollzeit|unbefristet|cdi|fulltime|regular)\b/.test(s)) return 'full_time';
  }
  const t = String(title || '').toLowerCase();
  if (/\b(intern|internship|praktikum|werkstudent|trainee|apprentice)\b/.test(t)) return 'internship';
  if (/part[\s_-]?time|teilzeit|minijob/.test(t)) return 'part_time';
  if (/\b(freelance|freelancer|contractor)\b|\(contract\)|\bcontract (role|position)\b/.test(t)) return 'contract';
  if (/full[\s_-]?time|vollzeit/.test(t)) return 'full_time';
  return null;
}

/** Lightweight language guess: Arabic, German, French, Spanish or English. */
export function detectLanguage(text) {
  const s = String(text || '').slice(0, 1500);
  if (/[؀-ۿ]{4,}/.test(s)) return 'ar';
  const lower = ` ${s.toLowerCase()} `;
  const score = (words) => words.reduce((n, w) => n + (lower.split(` ${w} `).length - 1), 0);
  const de = score(['und', 'die', 'der', 'mit', 'für', 'wir', 'sie', 'ihre', 'eine', 'das']);
  const fr = score(['et', 'les', 'des', 'pour', 'nous', 'vous', 'une', 'avec', 'dans']);
  const es = score(['y', 'los', 'las', 'para', 'con', 'una', 'del', 'nuestro', 'somos']);
  const en = score(['and', 'the', 'with', 'for', 'you', 'our', 'will', 'are', 'your', 'to']);
  const best = Math.max(de, fr, es, en);
  if (best === 0) return null;
  if (best === en) return 'en';
  if (best === de) return 'de';
  if (best === fr) return 'fr';
  return 'es';
}

/* ------------------------------------------------------------ salary */

const CURRENCY_SYMBOL = { '$': 'USD', '€': 'EUR', '£': 'GBP', '₹': 'INR', '¥': 'JPY', 'CHF': 'CHF', 'AED': 'AED', 'SAR': 'SAR', 'EGP': 'EGP' };

/**
 * Normalise a salary to whole units with an explicit period, rejecting values
 * that cannot be a real salary for that period (feeds sometimes put "80" for
 * 80k, or a monthly figure in a yearly field).
 */
export function normalizeSalary({ min, max, currency, period, text }) {
  let lo = toNumber(min);
  let hi = toNumber(max);
  let cur = currency ? String(currency).toUpperCase().slice(0, 3) : null;
  let per = normalizePeriod(period);

  if ((!lo && !hi) && text) {
    const parsed = parseSalaryText(text);
    if (parsed) {
      lo = parsed.min;
      hi = parsed.max;
      cur = parsed.currency || cur;
      per = parsed.period || per;
    }
  }
  if (!lo && !hi) return { salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null };
  if (lo && hi && lo > hi) [lo, hi] = [hi, lo];
  if (!per) per = (hi || lo) < 500 ? 'hour' : (hi || lo) < 20000 ? 'month' : 'year';
  const plausible = (v) => {
    if (!v) return true;
    if (per === 'hour') return v >= 3 && v <= 1000;
    if (per === 'month') return v >= 100 && v <= 200000;
    return v >= 1000 && v <= 5000000;
  };
  if (!plausible(lo) || !plausible(hi)) return { salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null };
  return {
    salaryMin: lo ? Math.round(lo) : null,
    salaryMax: hi ? Math.round(hi) : null,
    salaryCurrency: cur && /^[A-Z]{3}$/.test(cur) ? cur : 'USD',
    salaryPeriod: per,
  };
}

function normalizePeriod(p) {
  const s = String(p || '').toLowerCase();
  if (!s) return null;
  if (/hour|hr/.test(s)) return 'hour';
  if (/month/.test(s)) return 'month';
  if (/year|annual|annum|yr/.test(s)) return 'year';
  return null;
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "$120K – $150K", "€55.000 - €70.000 per year", "$35,3k- $52k", "$40/hr". */
export function parseSalaryText(text) {
  const s = String(text || '');
  const cur = Object.entries(CURRENCY_SYMBOL).find(([sym]) => s.includes(sym))?.[1] || null;
  const nums = [...s.matchAll(/(\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*([kK])?/g)]
    .map((m) => {
      let raw = m[1];
      // "55.000" / "55,000" are thousands; "35,3" is a decimal comma.
      if (/^\d{1,3}([.,\s]\d{3})+$/.test(raw)) raw = raw.replace(/[.,\s]/g, '');
      else raw = raw.replace(',', '.');
      let n = Number(raw);
      if (m[2]) n *= 1000;
      return n;
    })
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return null;
  const period = /hour|hr\b|\/h\b/i.test(s) ? 'hour' : /month|\/mo\b|monat/i.test(s) ? 'month' : /year|annual|yr|jahr|\/y\b/i.test(s) ? 'year' : null;
  return { min: nums[0], max: nums[1] || null, currency: cur, period };
}

/* ------------------------------------------------------------- dedup */

function normKey(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\((m|w|d|f|h)\/(m|w|d|f|h)(\/(m|w|d|f|h))?\)/g, '')
    .replace(/\b(gmbh|inc|ltd|llc|ag|sa|bv|plc|corp|corporation|company|co)\b\.?/g, '')
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .trim();
}

export function dedupHash({ title, company, country }) {
  return crypto.createHash('sha1').update(`${normKey(title)}|${normKey(company)}|${country || ''}`).digest('hex');
}

/* ------------------------------------------------------------- whole */

/**
 * @param {object} raw
 * @param {string} raw.source
 * @param {string} [raw.board]
 * @param {string} raw.externalId
 * @param {string} raw.title
 * @param {string} raw.company
 * @param {string} raw.url
 * @param {string} [raw.applyUrl]
 * @param {string} [raw.logo]
 * @param {string} [raw.location]
 * @param {string} [raw.countryHint]
 * @param {boolean} [raw.remote]
 * @param {string} [raw.workplace]
 * @param {string|string[]} [raw.employmentType]
 * @param {string} [raw.seniorityHint]
 * @param {string} [raw.category]
 * @param {string} [raw.html]   description as HTML
 * @param {string} [raw.text]   description as plain text (preferred when given)
 * @param {string[]} [raw.tags]
 * @param {object} [raw.salary] { min, max, currency, period, text }
 * @param {Date|string|number} [raw.postedAt]
 * @returns {object|null} a row for store.upsertJobs(), or null when unusable
 */
export function normalizeJob(raw) {
  const title = clean(raw.title, 255).replace(/\s*\((m|w|d|f|h)\/(m|w|d|f|h)(\/(m|w|d|f|h))?\)\s*/gi, ' ').trim();
  const company = clean(raw.company, 191);
  const url = String(raw.url || '').trim();
  if (!title || !company || !/^https?:\/\//i.test(url)) return null;

  const description = raw.html ? htmlToText(raw.html) : plainText(raw.text);
  const location = clean(raw.location, 255) || null;
  const loc = parseLocation(location || '', { hint: raw.countryHint });
  const workplace = detectWorkplace({
    remote: raw.remote, workplace: raw.workplace, location, title, text: description,
  });

  const tagText = (raw.tags || []).join(', ');
  const skills = extractSkills(`${title}\n${tagText}\n${description.slice(0, 8000)}`, { limit: 25 });
  const salary = normalizeSalary(raw.salary || {});

  let posted = raw.postedAt ? new Date(typeof raw.postedAt === 'number' && raw.postedAt < 1e12 ? raw.postedAt * 1000 : raw.postedAt) : new Date();
  if (Number.isNaN(posted.getTime()) || posted.getTime() > Date.now() + 86400000) posted = new Date();

  return {
    source: raw.source,
    sourceBoard: raw.board || null,
    externalId: String(raw.externalId).slice(0, 191),
    dedupHash: dedupHash({ title, company, country: loc.country }),
    title,
    company,
    companyLogo: raw.logo && /^https:\/\//i.test(raw.logo) ? String(raw.logo).slice(0, 500) : null,
    url: url.slice(0, 700),
    applyUrl: raw.applyUrl && /^https?:\/\//i.test(raw.applyUrl) ? String(raw.applyUrl).slice(0, 700) : null,
    location,
    country: loc.country,
    city: loc.city ? loc.city.slice(0, 120) : null,
    workplace,
    employmentType: detectEmploymentType(raw.employmentType, title),
    seniority: detectSeniority(title, raw.seniorityHint),
    category: raw.category ? clean(raw.category, 64) : null,
    ...salary,
    description: description || title,
    skills: skills.join(',').slice(0, 1000) || null,
    language: detectLanguage(`${title}\n${description}`),
    postedAt: posted,
  };
}
