/**
 * How well a person fits a job — deterministic, explainable, free.
 *
 * A score the person is shown must be one they can move by doing something,
 * and must say the same thing twice for the same inputs. So this is plain
 * arithmetic over things they can see: the skills the job asks for that their
 * CV shows, how close their title is to the job's, whether their experience is
 * at the job's level, and whether they can work where the job is. The AI is
 * used to REWRITE a CV for a job (career routes), never to grade the fit.
 */

import { skillLabel } from '../jobs/skills.js';

const LEVELS = ['intern', 'junior', 'mid', 'senior', 'lead', 'executive'];

export function levelForYears(years) {
  const y = Number(years) || 0;
  if (y < 1) return 'junior';
  if (y < 3) return 'junior';
  if (y < 6) return 'mid';
  if (y < 10) return 'senior';
  return 'lead';
}

const STOP = new Set(['and', 'of', 'the', 'for', 'with', 'in', 'at', 'to', 'a', 'an', 'm', 'w', 'd', 'f', 'h', 'remote', 'hybrid', 'senior', 'junior', 'sr', 'jr', 'lead', 'staff', 'principal', 'ii', 'iii', 'i']);
const SYN = {
  developer: 'engineer', programmer: 'engineer', dev: 'engineer', swe: 'engineer', engineering: 'engineer',
  frontend: 'front', 'front-end': 'front', backend: 'back', 'back-end': 'back', fullstack: 'full', 'full-stack': 'full',
  mgr: 'manager', management: 'manager', specialist: 'specialist', analyst: 'analyst', analytics: 'analyst',
  designer: 'design', design: 'design', ux: 'design', ui: 'design', marketer: 'marketing', accountant: 'accounting',
  recruiter: 'recruiting', recruitment: 'recruiting', administrator: 'admin', administration: 'admin',
};

function titleTokens(s) {
  return new Set(String(s || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .split(/[^a-z0-9؀-ۿ+#]+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => SYN[w] || w.replace(/(ing|er|s)$/, (m) => (w.length > 5 ? '' : m))));
}

export function titleSimilarity(a, b) {
  const A = titleTokens(a);
  const B = titleTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  // Overlap relative to the JOB title: "Software Engineer" fits "Senior Software Engineer, Payments".
  return inter / Math.min(A.size, B.size);
}

/**
 * @param {object} p   profile: { skills: string[] (canonical keys), years, titles: string[], countries: string[], openToRemote }
 * @param {object} job row or card: { title, skills (csv or [{key}]), seniority, country, workplace }
 * @returns {{ score:number, breakdown:object, matched:object[], missing:object[] }}
 */
export function matchJob(p, job) {
  const jobSkills = (Array.isArray(job.skills) ? job.skills.map((s) => s.key || s) : String(job.skills || '').split(','))
    .filter(Boolean)
    // Languages and soft skills are weak signals — they appear in every posting.
    .filter((k) => !['english', 'communication', 'problem-solving', 'leadership'].includes(k));
  const core = jobSkills.slice(0, 12);
  const mine = new Set(p.skills || []);
  const matched = core.filter((k) => mine.has(k));
  const missing = core.filter((k) => !mine.has(k));

  const skillScore = core.length ? matched.length / core.length : 0.5;

  const titleScore = Math.max(0, ...(p.titles || []).filter(Boolean).map((t) => titleSimilarity(t, job.title)));

  let levelScore = 0.7;
  if (job.seniority && p.years != null) {
    const want = LEVELS.indexOf(job.seniority);
    const have = LEVELS.indexOf(levelForYears(p.years));
    const gap = Math.abs(want - have);
    levelScore = gap === 0 ? 1 : gap === 1 ? 0.6 : 0.15;
    if (job.seniority === 'intern' && p.years < 2) levelScore = 1;
  }

  let placeScore = 0.5;
  if (job.workplace === 'remote' && (!job.country || p.openToRemote !== false)) placeScore = job.country && p.countries?.length && !p.countries.includes(job.country) ? 0.6 : 1;
  else if (job.country && p.countries?.includes(job.country)) placeScore = 1;
  else if (p.countries?.length) placeScore = 0.15;

  const score = Math.round(100 * (0.5 * skillScore + 0.25 * titleScore + 0.15 * levelScore + 0.1 * placeScore));
  return {
    score: Math.max(0, Math.min(100, score)),
    breakdown: {
      skills: Math.round(skillScore * 100),
      title: Math.round(titleScore * 100),
      level: Math.round(levelScore * 100),
      location: Math.round(placeScore * 100),
    },
    matched: matched.map((k) => ({ key: k, label: skillLabel(k) })),
    missing: missing.map((k) => ({ key: k, label: skillLabel(k) })),
  };
}
