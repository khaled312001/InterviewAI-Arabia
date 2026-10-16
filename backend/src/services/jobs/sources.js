/**
 * Job feeds.
 *
 * Every source here is a PUBLIC feed its owner publishes so that others can
 * show the jobs — company career boards (Greenhouse, Lever, Ashby) and job
 * boards with a documented free API. Nothing is scraped from a site that
 * forbids it: LinkedIn, Indeed and Glassdoor jobs reach the index only through
 * JSearch (Google for Jobs), an API the operator turns on with a key.
 *
 * Terms we honour, by source:
 *   - Arbeitnow, Jobicy, Remote OK, Himalayas, Working Nomads: credit the
 *     source by name and send every "Apply" to the original posting URL. The
 *     clients show `source` on every card and never host an application form.
 *   - Remotive is deliberately ABSENT: its terms forbid showing its jobs on a
 *     site that asks for sign-ups, which ours does for the CV tools.
 *
 * A connector returns raw objects in the shape `normalizeJob()` takes. The
 * ingester (ingest.js) decides when each runs; `every` is the minimum gap.
 */

import { cfg } from '../secrets/store.js';
import { logger } from '../../utils/logger.js';
import { normalizeJob } from './normalize.js';

const UA = 'Mozilla/5.0 (compatible; InterprovaJobs/1.0; +https://interprova.com/jobs)';
const HOUR = 3600_000;

/** fetch → JSON with a timeout and a size ceiling, so one slow feed cannot stall the box. */
export async function getJson(url, { headers = {}, timeout = 25_000, maxBytes = 12 * 1024 * 1024 } = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  });
  if (!res.ok) {
    const err = new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
    err.status = res.status;
    throw err;
  }
  const len = Number(res.headers.get('content-length') || 0);
  if (len && len > maxBytes) throw new Error(`feed too large (${len} bytes) from ${new URL(url).host}`);
  const text = await res.text();
  if (text.length > maxBytes) throw new Error(`feed too large (${text.length} chars) from ${new URL(url).host}`);
  return JSON.parse(text);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------- company boards */

/**
 * A big employer's whole board, descriptions included, runs past 12 MB
 * (OpenAI's is ~14 MB). Boards are polled twice a day, one at a time, so the
 * larger ceiling costs a brief peak, not a steady load.
 */
const BOARD_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Companies whose public career boards are polled, by ATS. Chosen for global
 * reach — offices across Europe, the Gulf, Africa, Asia and the Americas — and
 * checked to be live. A board that starts returning 404 is skipped by the
 * ingester and shows as failing in the admin panel; remove it here.
 */
export const BOARDS = {
  greenhouse: [
    'stripe', 'airbnb', 'dropbox', 'discord', 'figma', 'gitlab', 'cloudflare', 'datadog', 'mongodb', 'elastic',
    'twilio', 'reddit', 'pinterest', 'coinbase', 'robinhood', 'instacart', 'lyft', 'gusto', 'databricks', 'okta',
    'asana', 'deliveroo', 'careem', 'n26', 'monzo', 'gocardless', 'toast', 'anthropic', 'duolingo', 'affirm',
    'brex', 'chime', 'hellofresh', 'getyourguide', 'doctolib', 'sumup', 'trivago', 'celonis', 'wolt', 'samsara',
    'squarespace', 'vercel', 'webflow', 'intercom', 'tamara', 'agoda', 'riotgames', 'epicgames', 'mozilla',
    'wikimedia', 'khanacademy', 'jumia', 'moniepoint', 'wise', 'contentful', 'scaleai', 'typeform', 'cabify', 'adyen',
    'xendit', 'turing', 'grafanalabs', 'similarweb', 'payoneer', 'taboola', 'riskified', 'peak', 'freenow', 'insider',
  ],
  lever: [
    'spotify', 'palantir', 'binance', 'outreach', 'zoox', 'nium', 'swile', 'pigment', 'jobandtalent', 'trendyol',
    'ninjavan', 'cred', 'meesho', 'kavak', 'toptal', 'deliverect', 'klivvr', 'iyzico', 'copia',
  ],
  ashby: [
    'ramp', 'notion', 'linear', 'openai', 'vanta', 'replit', 'perplexity', 'cohere', 'posthog', 'supabase',
    'zapier', 'multiverse', 'sanity', 'pleo', 'hopper', 'wealthsimple', 'leantech', 'andela', 'miro', 'snowflake',
    'plaid', 'mollie', 'nubank', 'sentry', 'clickup', 'lemonade', 'thndr', 'ziina', 'pure',
  ],
  // Delivery Hero runs talabat, HungerStation and Glovo; Yassir is North Africa's super-app.
  smartrecruiters: ['deliveryhero', 'grab', 'canva', 'yassir'],
  // Gulf and Egyptian employers: Salla, Foodics and Lucidya (Saudi), Tamatem (Jordan), Kuda, Nowlun, Contact.
  workable: ['salla', 'foodics', 'lucidya', 'tamatem', 'kuda', 'nowlun', 'contact'],
  recruitee: ['unifonic', 'bunq', 'obilet'],
};

async function greenhouse(board) {
  const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`, { maxBytes: BOARD_MAX_BYTES });
  return (data.jobs || []).map((j) => ({
    source: 'greenhouse',
    board,
    externalId: `${board}:${j.id}`,
    title: j.title,
    company: j.company_name || board,
    url: j.absolute_url,
    applyUrl: j.absolute_url,
    location: j.location?.name || (j.offices || []).map((o) => o.name).join(', '),
    html: j.content,
    category: j.departments?.[0]?.name,
    postedAt: j.first_published || j.updated_at,
    employmentType: (j.metadata || []).map((m) => (typeof m?.value === 'string' ? m.value : '')).join(' '),
  }));
}

async function lever(board) {
  const data = await getJson(`https://api.lever.co/v0/postings/${board}?mode=json`, { maxBytes: BOARD_MAX_BYTES });
  return (Array.isArray(data) ? data : []).map((j) => {
    const lists = (j.lists || []).map((l) => `<h3>${l.text}</h3><ul>${l.content}</ul>`).join('');
    return {
      source: 'lever',
      board,
      externalId: `${board}:${j.id}`,
      title: j.text,
      company: board.charAt(0).toUpperCase() + board.slice(1),
      url: j.hostedUrl,
      applyUrl: j.applyUrl,
      location: j.categories?.allLocations?.join(', ') || j.categories?.location,
      countryHint: j.country,
      workplace: j.workplaceType,
      employmentType: j.categories?.commitment,
      category: j.categories?.team || j.categories?.department,
      html: `${j.description || ''}${lists}${j.additional || ''}`,
      salary: j.salaryRange ? {
        min: j.salaryRange.min, max: j.salaryRange.max, currency: j.salaryRange.currency, period: j.salaryRange.interval,
      } : undefined,
      postedAt: j.createdAt,
    };
  });
}

async function ashby(board) {
  const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`, { maxBytes: BOARD_MAX_BYTES });
  return (data.jobs || []).filter((j) => j.isListed !== false).map((j) => {
    const comp = j.compensation?.summaryComponents?.find?.((c) => c.compensationType === 'Salary');
    const country = j.address?.postalAddress?.addressCountry;
    return {
      source: 'ashby',
      board,
      externalId: `${board}:${j.id}`,
      title: j.title,
      company: board.charAt(0).toUpperCase() + board.slice(1),
      url: j.jobUrl,
      applyUrl: j.applyUrl,
      location: [j.location, country].filter(Boolean).join(', '),
      workplace: j.workplaceType || (j.isRemote ? 'remote' : undefined),
      remote: j.isRemote,
      employmentType: j.employmentType,
      category: j.department,
      text: j.descriptionPlain,
      html: j.descriptionPlain ? undefined : j.descriptionHtml,
      salary: comp ? {
        min: comp.minValue, max: comp.maxValue, currency: comp.currencyCode, period: comp.interval,
      } : { text: j.compensation?.scrapeableCompensationSalarySummary },
      postedAt: j.publishedAt,
    };
  });
}

/**
 * SmartRecruiters' public posting API. The list carries no description, so
 * each item has a `hydrate()` the ingester calls for NEW postings only.
 */
async function smartrecruiters(board) {
  const out = [];
  for (let offset = 0; offset < 3000; offset += 100) {
    const data = await getJson(`https://api.smartrecruiters.com/v1/companies/${board}/postings?limit=100&offset=${offset}`);
    const list = data.content || [];
    for (const j of list) {
      const loc = j.location || {};
      out.push({
        source: 'smartrecruiters',
        board,
        externalId: `${board}:${j.id}`,
        title: j.name,
        company: j.company?.name || board,
        url: `https://jobs.smartrecruiters.com/${j.company?.identifier || board}/${j.id}`,
        applyUrl: `https://jobs.smartrecruiters.com/${j.company?.identifier || board}/${j.id}`,
        location: [loc.city, loc.region, loc.country?.toUpperCase()].filter(Boolean).join(', '),
        countryHint: loc.country ? loc.country.toUpperCase() : undefined,
        workplace: loc.remote ? 'remote' : loc.hybrid ? 'hybrid' : undefined,
        remote: Boolean(loc.remote),
        employmentType: j.typeOfEmployment?.label,
        seniorityHint: j.experienceLevel?.label,
        category: j.function?.label || j.department?.label,
        text: j.name,
        postedAt: j.releasedDate,
        hydrate: async () => {
          const d = await getJson(`https://api.smartrecruiters.com/v1/companies/${board}/postings/${j.id}`, { timeout: 15_000 });
          const s = d.jobAd?.sections || {};
          const html = [s.jobDescription, s.qualifications, s.additionalInformation]
            .map((x) => (x?.text ? `<h3>${x.title || ''}</h3>${x.text}` : '')).join('');
          return {
            html: html || undefined,
            url: d.postingUrl || undefined,
            applyUrl: d.applyUrl || d.postingUrl || undefined,
          };
        },
      });
    }
    if (list.length < 100 || out.length >= (data.totalFound || 0)) break;
    await sleep(500);
  }
  return out;
}

/** Workable's public careers-widget feed, descriptions included. */
async function workable(board) {
  const data = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${board}?details=true`, { maxBytes: BOARD_MAX_BYTES });
  const company = data.name || board;
  return (data.jobs || []).map((j) => {
    const place = (j.locations || [])[0] || {};
    return {
      source: 'workable',
      board,
      externalId: `${board}:${j.shortcode}`,
      title: j.title,
      company,
      url: j.url || j.shortlink,
      applyUrl: j.application_url || j.url,
      location: [j.city || place.city, j.state || place.region, j.country || place.country].filter(Boolean).join(', '),
      countryHint: place.countryCode,
      remote: Boolean(j.telecommuting),
      employmentType: j.employment_type,
      seniorityHint: j.experience,
      category: j.function || j.department,
      html: j.description,
      postedAt: j.published_on || j.created_at,
    };
  });
}

/** Recruitee's public offers feed, descriptions and requirements included. */
async function recruitee(board) {
  const data = await getJson(`https://${board}.recruitee.com/api/offers/`, { maxBytes: BOARD_MAX_BYTES });
  return (data.offers || []).filter((o) => !o.status || o.status === 'published').map((o) => ({
    source: 'recruitee',
    board,
    externalId: `${board}:${o.id}`,
    title: o.title,
    company: o.company_name || board,
    url: o.careers_url,
    applyUrl: o.careers_apply_url || o.careers_url,
    location: o.location || [o.city, o.country].filter(Boolean).join(', '),
    countryHint: o.country_code,
    workplace: o.remote ? 'remote' : o.hybrid ? 'hybrid' : undefined,
    remote: Boolean(o.remote),
    employmentType: String(o.employment_type_code || '').replace('fulltime', 'full-time').replace('parttime', 'part-time').replace(/_/g, ' '),
    seniorityHint: o.experience_code,
    category: o.department,
    html: `${o.description || ''}${o.requirements ? `<h3>Requirements</h3>${o.requirements}` : ''}`,
    postedAt: o.published_at || o.created_at,
  }));
}

/* --------------------------------------------------- job boards */

async function arbeitnow({ pages = 5 } = {}) {
  const out = [];
  for (let page = 1; page <= pages; page += 1) {
    const data = await getJson(`https://www.arbeitnow.com/api/job-board-api?page=${page}`);
    for (const j of data.data || []) {
      out.push({
        source: 'arbeitnow',
        externalId: j.slug,
        title: j.title,
        company: j.company_name,
        url: j.url,
        applyUrl: j.url,
        location: j.location,
        // Arbeitnow is a German board: a bare town name is almost always German.
        countryHint: 'DE',
        remote: j.remote,
        employmentType: j.job_types,
        tags: j.tags,
        html: j.description,
        postedAt: j.created_at,
      });
    }
    if (!data.links?.next) break;
    await sleep(1500);
  }
  return out;
}

async function jobicy() {
  const data = await getJson('https://jobicy.com/api/v2/remote-jobs?count=100');
  return (data.jobs || []).map((j) => ({
    source: 'jobicy',
    externalId: String(j.id),
    title: j.jobTitle,
    company: j.companyName,
    logo: j.companyLogo,
    url: j.url,
    applyUrl: j.url,
    location: j.jobGeo,
    remote: true,
    employmentType: j.jobType,
    seniorityHint: j.jobLevel,
    category: Array.isArray(j.jobIndustry) ? j.jobIndustry[0] : j.jobIndustry,
    html: j.jobDescription,
    salary: { min: j.salaryMin, max: j.salaryMax, currency: j.salaryCurrency, period: j.salaryPeriod },
    postedAt: j.pubDate,
  }));
}

async function remoteok() {
  const data = await getJson('https://remoteok.com/api');
  return (Array.isArray(data) ? data.slice(1) : []).filter((j) => j && j.id).map((j) => ({
    source: 'remoteok',
    externalId: String(j.id),
    title: j.position,
    company: j.company,
    logo: j.company_logo || j.logo,
    url: j.url,
    applyUrl: j.apply_url || j.url,
    location: j.location || 'Worldwide',
    remote: true,
    tags: j.tags,
    html: j.description,
    salary: { min: j.salary_min, max: j.salary_max, currency: 'USD', period: 'year' },
    postedAt: j.date || j.epoch,
  }));
}

async function himalayas({ pages = 25 } = {}) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < pages; i += 1) {
    const url = `https://himalayas.app/jobs/api?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const data = await getJson(url);
    for (const j of data.jobs || []) {
      const places = j.locationRestrictions || [];
      out.push({
        source: 'himalayas',
        externalId: j.guid || j.applicationLink,
        title: j.title,
        company: j.companyName,
        logo: j.companyLogo,
        url: j.guid || j.applicationLink,
        applyUrl: j.applicationLink,
        location: places.length ? places.join(', ') : 'Worldwide',
        remote: true,
        employmentType: j.employmentType,
        seniorityHint: (j.seniority || []).join(' '),
        category: j.parentCategories?.[0],
        tags: j.categories,
        html: j.description,
        salary: { min: j.minSalary, max: j.maxSalary, currency: j.currency, period: j.salaryPeriod },
        postedAt: j.pubDate,
      });
    }
    cursor = data.nextCursor;
    if (!cursor) break;
    await sleep(1200);
  }
  return out;
}

async function workingnomads() {
  const data = await getJson('https://www.workingnomads.com/api/exposed_jobs/');
  return (Array.isArray(data) ? data : []).map((j) => ({
    source: 'workingnomads',
    externalId: j.url,
    title: j.title,
    company: j.company_name,
    url: j.url,
    applyUrl: j.url,
    location: j.location || 'Worldwide',
    remote: true,
    category: j.category_name,
    tags: String(j.tags || '').split(','),
    html: j.description,
    postedAt: j.pub_date,
  }));
}

/* ------------------------------------------------ live search (no key) */

/**
 * Feeds that take a search term, asked at the moment someone searches — so a
 * search shows what is open right now, not only what the scheduler last saw.
 * Each returns raw items like the scheduled connectors.
 */
function himalayasItem(j) {
  const places = j.locationRestrictions || [];
  return {
    source: 'himalayas',
    externalId: j.guid || j.applicationLink,
    title: j.title,
    company: j.companyName,
    logo: j.companyLogo,
    url: j.guid || j.applicationLink,
    applyUrl: j.applicationLink,
    location: places.length ? places.join(', ') : 'Worldwide',
    remote: true,
    employmentType: j.employmentType,
    seniorityHint: (j.seniority || []).join(' '),
    category: j.parentCategories?.[0],
    tags: j.categories,
    html: j.description,
    salary: { min: j.minSalary, max: j.maxSalary, currency: j.currency, period: j.salaryPeriod },
    postedAt: j.pubDate,
  };
}

export async function himalayasSearch({ query, country, page = 1, timeout = 7000 }) {
  const params = new URLSearchParams({ q: query });
  if (country) params.set('country', country.toUpperCase());
  if (page > 1) params.set('page', String(page));
  const data = await getJson(`https://himalayas.app/jobs/api/search?${params}`, { timeout });
  return (data.jobs || []).map(himalayasItem);
}

export async function jobicySearch({ query, timeout = 7000 }) {
  const data = await getJson(`https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(query)}`, { timeout });
  return (data.jobs || []).map((j) => ({
    source: 'jobicy',
    externalId: String(j.id),
    title: j.jobTitle,
    company: j.companyName,
    logo: j.companyLogo,
    url: j.url,
    applyUrl: j.url,
    location: j.jobGeo,
    remote: true,
    employmentType: j.jobType,
    seniorityHint: j.jobLevel,
    category: Array.isArray(j.jobIndustry) ? j.jobIndustry[0] : j.jobIndustry,
    html: j.jobDescription,
    salary: { min: j.salaryMin, max: j.salaryMax, currency: j.salaryCurrency, period: j.salaryPeriod },
    postedAt: j.pubDate,
  }));
}

/** Remote OK's tag match is loose ("accounting" returns coaches), so keep only titles that carry a query word. */
export async function remoteokSearch({ query, timeout = 7000 }) {
  const words = String(query).toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  const tag = words.join('-');
  const data = await getJson(`https://remoteok.com/api?tag=${encodeURIComponent(tag)}`, { timeout });
  return (Array.isArray(data) ? data.slice(1) : [])
    .filter((j) => j && j.id && words.some((w) => String(j.position || '').toLowerCase().includes(w.slice(0, 6))))
    .map((j) => ({
      source: 'remoteok',
      externalId: String(j.id),
      title: j.position,
      company: j.company,
      logo: j.company_logo || j.logo,
      url: j.url,
      applyUrl: j.apply_url || j.url,
      location: j.location || 'Worldwide',
      remote: true,
      tags: j.tags,
      html: j.description,
      salary: { min: j.salary_min, max: j.salary_max, currency: 'USD', period: 'year' },
      postedAt: j.date || j.epoch,
    }));
}

/* -------------------------------------------- keyed (operator) APIs */

/**
 * Jooble — a job search engine across ~70 countries (the Gulf and North
 * Africa included). Free key from jooble.org/api/about; searched live only.
 */
export function joobleConfigured() {
  return Boolean(cfg('JOOBLE_API_KEY'));
}

export async function jooble({ query, location = '', page = 1, timeout = 9000 }) {
  const key = cfg('JOOBLE_API_KEY');
  if (!key) return [];
  const res = await fetch(`https://jooble.org/api/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ keywords: query, location, page: String(page) }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`${res.status} from jooble`);
  const data = await res.json();
  return (data.jobs || []).map((j) => ({
    source: 'jooble',
    board: j.source || null,
    externalId: String(j.id || j.link),
    title: j.title,
    company: j.company || 'Unknown',
    url: j.link,
    applyUrl: j.link,
    location: j.location,
    employmentType: j.type,
    html: j.snippet,
    salary: j.salary ? { text: j.salary } : undefined,
    postedAt: j.updated,
  }));
}



/**
 * JSearch (OpenWeb Ninja, on RapidAPI) — Google for Jobs, which is where
 * LinkedIn, Indeed, Glassdoor, ZipRecruiter and company sites syndicate their
 * postings. Metered per request, so it is used for LIVE searches the index
 * cannot answer well (see store.liveSearch), not polled on a schedule.
 */
export function jsearchConfigured() {
  return Boolean(cfg('JSEARCH_API_KEY'));
}

export async function jsearch({ query, country, page = 1, remoteOnly = false, datePosted = 'month' }) {
  const key = cfg('JSEARCH_API_KEY');
  if (!key) return [];
  const host = cfg('JSEARCH_API_HOST') || 'jsearch.p.rapidapi.com';
  const params = new URLSearchParams({
    query: query || 'jobs',
    page: String(page),
    num_pages: '1',
    date_posted: datePosted,
  });
  if (country) params.set('country', country.toLowerCase());
  if (remoteOnly) params.set('work_from_home', 'true');
  const data = await getJson(`https://${host}/search?${params}`, {
    headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': host },
    timeout: 30_000,
  });
  return (data.data || []).map((j) => ({
    source: 'jsearch',
    board: j.job_publisher || null,
    externalId: j.job_id,
    title: j.job_title,
    company: j.employer_name,
    logo: j.employer_logo,
    url: j.job_apply_link || j.job_google_link,
    applyUrl: j.job_apply_link,
    location: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', ') || j.job_location,
    countryHint: j.job_country,
    remote: j.job_is_remote,
    employmentType: j.job_employment_type,
    text: j.job_description,
    salary: { min: j.job_min_salary, max: j.job_max_salary, currency: j.job_salary_currency, period: j.job_salary_period },
    postedAt: j.job_posted_at_datetime_utc || j.job_posted_at_timestamp,
  }));
}

/** Adzuna's own country list. Searches for any other country do not go to Adzuna. */
export const ADZUNA_COUNTRIES = ['at', 'au', 'be', 'br', 'ca', 'ch', 'de', 'es', 'fr', 'gb', 'in', 'it', 'mx', 'nl', 'nz', 'pl', 'sg', 'us', 'za'];

export function adzunaConfigured() {
  return Boolean(cfg('ADZUNA_APP_ID') && cfg('ADZUNA_APP_KEY'));
}

export async function adzuna({ country, query = '', page = 1, perPage = 50 }) {
  const id = cfg('ADZUNA_APP_ID');
  const key = cfg('ADZUNA_APP_KEY');
  const cc = String(country || '').toLowerCase();
  if (!id || !key || !ADZUNA_COUNTRIES.includes(cc)) return [];
  const params = new URLSearchParams({
    app_id: id, app_key: key, results_per_page: String(perPage), sort_by: 'date', 'content-type': 'application/json',
  });
  if (query) params.set('what', query);
  const data = await getJson(`https://api.adzuna.com/v1/api/jobs/${cc}/search/${page}?${params}`);
  return (data.results || []).map((j) => ({
    source: 'adzuna',
    board: cc,
    externalId: String(j.id),
    title: j.title,
    company: j.company?.display_name || 'Unknown',
    url: j.redirect_url,
    applyUrl: j.redirect_url,
    location: j.location?.display_name,
    countryHint: cc.toUpperCase() === 'GB' ? 'GB' : cc.toUpperCase(),
    employmentType: [j.contract_time, j.contract_type],
    category: j.category?.label,
    text: j.description,
    salary: j.salary_is_predicted === '1' ? undefined : { min: j.salary_min, max: j.salary_max, currency: null, period: 'year' },
    postedAt: j.created,
  }));
}

/* ----------------------------------------------------------- registry */

/**
 * Everything the ingester can run, as { id, every, run }. Company boards fan
 * out to one entry per company so a single broken board never blocks the rest
 * and each one's health is visible on its own.
 */
export function sourceRegistry() {
  const list = [
    { id: 'arbeitnow', label: 'Arbeitnow', every: 2 * HOUR, run: () => arbeitnow() },
    { id: 'jobicy', label: 'Jobicy', every: 2 * HOUR, run: () => jobicy() },
    { id: 'remoteok', label: 'Remote OK', every: 3 * HOUR, run: () => remoteok() },
    { id: 'himalayas', label: 'Himalayas', every: 2 * HOUR, run: () => himalayas() },
    { id: 'workingnomads', label: 'Working Nomads', every: 3 * HOUR, run: () => workingnomads() },
  ];
  for (const b of BOARDS.greenhouse) list.push({ id: `greenhouse:${b}`, label: `Greenhouse · ${b}`, every: 12 * HOUR, run: () => greenhouse(b) });
  for (const b of BOARDS.lever) list.push({ id: `lever:${b}`, label: `Lever · ${b}`, every: 12 * HOUR, run: () => lever(b) });
  for (const b of BOARDS.ashby) list.push({ id: `ashby:${b}`, label: `Ashby · ${b}`, every: 12 * HOUR, run: () => ashby(b) });
  // Every 3 h: the big SmartRecruiters boards fill in HYDRATE_CAP new postings per run (ingest.js).
  for (const b of BOARDS.smartrecruiters) list.push({ id: `smartrecruiters:${b}`, label: `SmartRecruiters · ${b}`, every: 3 * HOUR, run: () => smartrecruiters(b) });
  for (const b of BOARDS.workable) list.push({ id: `workable:${b}`, label: `Workable · ${b}`, every: 12 * HOUR, run: () => workable(b) });
  for (const b of BOARDS.recruitee) list.push({ id: `recruitee:${b}`, label: `Recruitee · ${b}`, every: 12 * HOUR, run: () => recruitee(b) });
  if (adzunaConfigured()) {
    for (const cc of ADZUNA_COUNTRIES) {
      list.push({ id: `adzuna:${cc}`, label: `Adzuna · ${cc.toUpperCase()}`, every: 6 * HOUR, run: () => adzuna({ country: cc }) });
    }
  }
  return list;
}

/** Human name for a stored `source` value, shown as the credit on every job. */
export const SOURCE_NAMES = {
  arbeitnow: 'Arbeitnow',
  jobicy: 'Jobicy',
  remoteok: 'Remote OK',
  himalayas: 'Himalayas',
  workingnomads: 'Working Nomads',
  greenhouse: 'Company careers page',
  lever: 'Company careers page',
  ashby: 'Company careers page',
  smartrecruiters: 'Company careers page',
  workable: 'Company careers page',
  recruitee: 'Company careers page',
  jsearch: 'Google for Jobs',
  adzuna: 'Adzuna',
  jooble: 'Jooble',
};

/** Run raw items through the normaliser, dropping the unusable ones. */
export function normalizeAll(items) {
  const out = [];
  for (const raw of items) {
    try {
      const row = normalizeJob(raw);
      if (row) out.push(row);
    } catch (err) {
      logger.warn('job normalise failed', { source: raw?.source, message: err.message });
    }
  }
  return out;
}
