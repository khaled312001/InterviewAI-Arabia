/**
 * The CV data model.
 *
 * One JSON shape is used everywhere — the master profile, every tailored
 * version, the AI's input and output, and the print templates — so a CV can
 * move between them without conversion. `sanitizeCv()` is the only way data
 * enters that shape: from a form, from an import, or from a model. Models in
 * JSON mode (Groq) guarantee valid JSON but not a valid SHAPE, so this is also
 * the line that stops a malformed AI answer from reaching storage.
 */

import { canonicalSkills, extractSkills } from '../jobs/skills.js';

const str = (v, max = 300) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, max);
const longStr = (v, max = 2000) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const url = (v) => {
  const s = str(v, 300);
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return `https://${s}`;
  return '';
};
/** "2021-03", "2021", "03/2021", "Mar 2021" → "YYYY-MM" or "YYYY". */
export function normDate(v) {
  const s = str(v, 40);
  if (!s) return '';
  if (/^(present|current|now|today|حتى الآن|حاليا|حاليًا|الآن|heute|aujourd'hui)$/i.test(s)) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.](\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  m = s.toLowerCase().match(/([a-z]{3})[a-z]*\.?\s+(\d{4})/);
  if (m && months.includes(m[1])) return `${m[2]}-${String(months.indexOf(m[1]) + 1).padStart(2, '0')}`;
  m = s.match(/(\d{4})/);
  return m ? m[1] : '';
}

export function emptyCv() {
  return {
    basics: { name: '', headline: '', email: '', phone: '', location: '', links: [], summary: '' },
    experience: [],
    education: [],
    skills: [],
    languages: [],
    certifications: [],
    projects: [],
  };
}

/** Coerce anything into a valid CV, dropping what does not fit. */
export function sanitizeCv(input) {
  const d = input && typeof input === 'object' ? input : {};
  const b = d.basics && typeof d.basics === 'object' ? d.basics : {};
  const cv = {
    basics: {
      name: str(b.name, 120),
      headline: str(b.headline ?? b.title, 160),
      email: str(b.email, 160),
      phone: str(b.phone, 40),
      location: str(b.location, 120),
      links: arr(b.links, 6)
        .map((l) => (typeof l === 'string' ? { label: '', url: url(l) } : { label: str(l?.label, 40), url: url(l?.url) }))
        .filter((l) => l.url),
      summary: longStr(b.summary, 1200),
    },
    experience: arr(d.experience, 15).map((e) => ({
      title: str(e?.title, 160),
      company: str(e?.company, 160),
      location: str(e?.location, 120),
      start: normDate(e?.start),
      end: e?.current ? '' : normDate(e?.end),
      current: Boolean(e?.current) || (/present|current|now|حاليا|الآن/i.test(String(e?.end || '')) && !normDate(e?.end)),
      bullets: arr(e?.bullets, 10).map((x) => longStr(x, 400)).filter(Boolean),
    })).filter((e) => e.title || e.company),
    education: arr(d.education, 8).map((e) => ({
      degree: str(e?.degree, 160),
      field: str(e?.field, 160),
      school: str(e?.school, 160),
      location: str(e?.location, 120),
      start: normDate(e?.start),
      end: normDate(e?.end),
      details: longStr(e?.details, 400),
    })).filter((e) => e.degree || e.school),
    skills: [...new Set(arr(d.skills, 60).map((s) => str(typeof s === 'string' ? s : s?.name, 60)).filter(Boolean))],
    languages: arr(d.languages, 10).map((l) => (typeof l === 'string'
      ? { name: str(l, 40), level: '' }
      : { name: str(l?.name, 40), level: str(l?.level, 40) })).filter((l) => l.name),
    certifications: arr(d.certifications, 15).map((c) => (typeof c === 'string'
      ? { name: str(c, 160), issuer: '', date: '' }
      : { name: str(c?.name, 160), issuer: str(c?.issuer, 120), date: normDate(c?.date) })).filter((c) => c.name),
    projects: arr(d.projects, 10).map((p) => ({
      name: str(p?.name, 160),
      url: url(p?.url),
      description: longStr(p?.description, 500),
      bullets: arr(p?.bullets, 6).map((x) => longStr(x, 300)).filter(Boolean),
    })).filter((p) => p.name),
  };
  return cv;
}

/** Plain text of a CV, in reading order — what an ATS parser would extract. */
export function cvToText(cv) {
  const c = sanitizeCv(cv);
  const lines = [];
  const b = c.basics;
  lines.push(b.name, b.headline, [b.email, b.phone, b.location].filter(Boolean).join(' | '), b.links.map((l) => l.url).join(' | '));
  if (b.summary) lines.push('', 'SUMMARY', b.summary);
  if (c.experience.length) {
    lines.push('', 'EXPERIENCE');
    for (const e of c.experience) {
      lines.push(`${e.title}${e.company ? ` — ${e.company}` : ''}${e.location ? `, ${e.location}` : ''}`);
      lines.push(`${e.start || ''} – ${e.current ? 'Present' : e.end || ''}`);
      e.bullets.forEach((x) => lines.push(`• ${x}`));
    }
  }
  if (c.education.length) {
    lines.push('', 'EDUCATION');
    for (const e of c.education) {
      lines.push([e.degree, e.field].filter(Boolean).join(', ') + (e.school ? ` — ${e.school}` : ''));
      if (e.start || e.end) lines.push(`${e.start || ''} – ${e.end || ''}`);
      if (e.details) lines.push(e.details);
    }
  }
  if (c.skills.length) lines.push('', 'SKILLS', c.skills.join(', '));
  if (c.projects.length) {
    lines.push('', 'PROJECTS');
    for (const p of c.projects) {
      lines.push(p.name + (p.url ? ` (${p.url})` : ''));
      if (p.description) lines.push(p.description);
      p.bullets.forEach((x) => lines.push(`• ${x}`));
    }
  }
  if (c.certifications.length) lines.push('', 'CERTIFICATIONS', ...c.certifications.map((x) => [x.name, x.issuer, x.date].filter(Boolean).join(' — ')));
  if (c.languages.length) lines.push('', 'LANGUAGES', c.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(', '));
  return lines.filter((l) => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Months between two YYYY-MM / YYYY strings ('' end = now). */
function months(start, end) {
  if (!start) return 0;
  const [sy, sm = '01'] = start.split('-');
  const e = end || new Date().toISOString().slice(0, 7);
  const [ey, em = '12'] = e.split('-');
  const n = (Number(ey) - Number(sy)) * 12 + (Number(em) - Number(sm)) + 1;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 600) : 0;
}

/** Total professional experience in years, overlapping roles counted once. */
export function yearsOfExperience(cv) {
  const spans = sanitizeCv(cv).experience
    .filter((e) => e.start)
    .map((e) => {
      const s = e.start.length === 4 ? `${e.start}-01` : e.start;
      const end = e.current || !e.end ? new Date().toISOString().slice(0, 7) : (e.end.length === 4 ? `${e.end}-12` : e.end);
      return [s, end];
    })
    .sort((a, b) => a[0].localeCompare(b[0]));
  let total = 0;
  let cur = null;
  for (const [s, e] of spans) {
    if (!cur) { cur = [s, e]; continue; }
    if (s <= cur[1]) { if (e > cur[1]) cur[1] = e; continue; }
    total += months(cur[0], cur[1]);
    cur = [s, e];
  }
  if (cur) total += months(cur[0], cur[1]);
  return Math.round((total / 12) * 10) / 10;
}

/** Canonical skill keys the CV evidences: its skills list plus what its text mentions. */
export function cvSkillKeys(cv) {
  const c = sanitizeCv(cv);
  const listed = canonicalSkills(c.skills);
  const mentioned = extractSkills(cvToText(c), { limit: 60 });
  return [...new Set([...listed, ...mentioned])];
}

/**
 * Hold a rewritten CV to the facts of the original.
 *
 * The tailoring prompt forbids inventing anything, and this is what makes that
 * true rather than hoped for: every fact a model could get wrong is copied
 * back from the original. Contact details, every employer / title / date,
 * education, certifications and languages come from the source, untouched.
 * What the model may change is wording: the headline, the summary and the
 * bullets, and a bullet carrying a number the original never states is
 * rejected. The order of roles is the original's; a role the model left out
 * stays out only when the CV has more than four (shortening a long CV is
 * allowed, erasing a short one is not). A skill survives only if the original
 * CV lists it or its text mentions it.
 */
export function lockFacts(originalInput, rewrittenInput) {
  const o = sanitizeCv(originalInput);
  const r = sanitizeCv(rewrittenInput);
  const key = (e) => `${e.title}|${e.company}`.toLowerCase();
  const rewrittenByKey = new Map(r.experience.map((e) => [key(e), e]));

  const originalText = cvToText(o).toLowerCase();
  // A number in a rewritten bullet that the original never states is invented;
  // the role then keeps its original bullets rather than a fabricated metric.
  const knownNumbers = new Set(originalText.match(/\d+(?:[.,]\d+)?/g) || []);
  const inventsNumber = (bullets) => bullets.some((b) => (b.match(/\d+(?:[.,]\d+)?/g) || []).some((n) => !knownNumbers.has(n.toLowerCase())));
  const honest = (got, fallback) => (got?.length && !inventsNumber(got) ? got : fallback);

  const experience = [];
  o.experience.forEach((orig, i) => {
    // Match on title+company; fall back to position when the model reworded the title.
    const got = rewrittenByKey.get(key(orig)) || r.experience[i];
    if (!got && o.experience.length > 4 && i >= 3) return;
    experience.push({ ...orig, bullets: honest(got?.bullets, orig.bullets) });
  });

  const originalSkillKeys = new Set(cvSkillKeys(o));
  const skills = r.skills.filter((s) => {
    if (originalText.includes(s.toLowerCase())) return true;
    const k = canonicalSkills([s]);
    return k.length > 0 && k.every((x) => originalSkillKeys.has(x));
  });
  // Skills the model dropped are kept at the end: an ATS cannot match what is absent.
  for (const s of o.skills) if (!skills.some((x) => x.toLowerCase() === s.toLowerCase())) skills.push(s);

  const projectsByName = new Map(r.projects.map((p) => [p.name.toLowerCase(), p]));
  const projects = o.projects.map((p) => {
    const got = projectsByName.get(p.name.toLowerCase());
    return got ? { ...p, description: got.description || p.description, bullets: honest(got.bullets, p.bullets) } : p;
  });

  const summary = r.basics.summary && !inventsNumber([r.basics.summary]) ? r.basics.summary : o.basics.summary;
  return {
    basics: {
      ...o.basics,
      headline: r.basics.headline || o.basics.headline,
      summary,
    },
    experience,
    education: o.education,
    skills: skills.slice(0, 40),
    languages: o.languages,
    certifications: o.certifications,
    projects,
  };
}

/** Best guess at the role the person is aiming for. */
export function headlineOf(cv) {
  const c = sanitizeCv(cv);
  return c.basics.headline || c.experience[0]?.title || '';
}
