/**
 * The person's master career profile: their CV plus what they are looking for.
 *
 * Stored as the CV JSON with a few derived columns (skills, years, target) so
 * matching a page of jobs needs one primary-key read and no re-parsing.
 */

import { query, queryOne } from '../../db/mysql.js';
import { sanitizeCv, cvSkillKeys, yearsOfExperience, headlineOf, emptyCv } from './cv.js';

function parseJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

export async function loadProfile(userId) {
  const r = await queryOne('SELECT * FROM career_profiles WHERE user_id = ?', [String(userId)]);
  if (!r) return null;
  return {
    cv: sanitizeCv(parseJson(r.data)),
    skills: r.skills ? String(r.skills).split(',').filter(Boolean) : [],
    targetTitle: r.target_title || '',
    targetCountry: r.target_country || '',
    openToRemote: Boolean(r.open_to_remote),
    years: r.years == null ? null : Number(r.years),
    updatedAt: r.updated_at,
  };
}

export async function saveProfile(userId, { cv, targetTitle, targetCountry, openToRemote }) {
  const clean = sanitizeCv(cv);
  const skills = cvSkillKeys(clean).join(',').slice(0, 1000);
  const years = yearsOfExperience(clean);
  const now = new Date();
  await query(
    `INSERT INTO career_profiles (user_id, data, skills, target_title, target_country, open_to_remote, years, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE data = VALUES(data), skills = VALUES(skills), target_title = VALUES(target_title),
       target_country = VALUES(target_country), open_to_remote = VALUES(open_to_remote), years = VALUES(years),
       updated_at = VALUES(updated_at)`,
    [
      String(userId), JSON.stringify(clean), skills || null,
      String(targetTitle || '').trim().slice(0, 191) || null,
      /^[A-Z]{2}$/.test(String(targetCountry || '')) ? targetCountry : null,
      openToRemote === false ? 0 : 1,
      years || null, now, now,
    ],
  );
  return loadProfile(userId);
}

/** What `matchJob()` needs, from a stored profile (or an ad-hoc CV). */
export function matchProfileOf(profile) {
  if (!profile) return null;
  const cv = profile.cv || emptyCv();
  const titles = [profile.targetTitle, headlineOf(cv), ...cv.experience.slice(0, 2).map((e) => e.title)].filter(Boolean);
  return {
    skills: profile.skills?.length ? profile.skills : cvSkillKeys(cv),
    years: profile.years ?? yearsOfExperience(cv),
    titles,
    countries: profile.targetCountry ? [profile.targetCountry] : [],
    openToRemote: profile.openToRemote !== false,
  };
}

export function profileIsUsable(profile) {
  if (!profile) return false;
  const cv = profile.cv;
  return Boolean(profile.targetTitle || cv.basics.headline || cv.experience.length || cv.skills.length);
}
