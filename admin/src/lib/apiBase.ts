/**
 * Where the admin app sends its API calls.
 *
 * This used to be a guess: a hardcoded list of hostnames got the relative
 * `/api`, and *every other host* silently fell back to a compiled-in absolute
 * URL for a backend that this repo does not own or deploy. Two things were
 * wrong with that, and only one of them was the dead URL.
 *
 *  1. The rule was a deny-by-omission list. Any new domain — a preview
 *     deployment, a renamed project, a custom domain — was not on it, so it
 *     inherited the cross-origin fallback without anyone choosing that. When
 *     the fallback is unreachable, or its CORS preflight fails, login dies
 *     with "تعذّر الاتصال بالخادم" and nothing on screen says the app is
 *     pointed at the wrong host.
 *
 *  2. Cross-origin was never necessary. The frontend project rewrites `/api/*`
 *     to the backend deployment (see vercel.json at the repo root), and the
 *     single-domain Hostinger box serves the API from `/api` directly. So the
 *     relative path is correct on every deployment this repo produces, and
 *     going same-origin removes CORS — preflights, allow-lists, credentialed
 *     requests — from the failure surface entirely.
 *
 * The rule is therefore: same-origin `/api`, unless the build explicitly says
 * otherwise via VITE_API_BASE_URL. An explicit override is a deliberate act
 * with a value someone can read in the deploy config; the old fallback was
 * neither.
 */

const DEFAULT_BASE = '/api';

const configured = (import.meta.env.VITE_API_BASE_URL || '').trim();

export const API_BASE_URL = (configured || DEFAULT_BASE).replace(/\/$/, '') || DEFAULT_BASE;

/**
 * True when calls leave this origin, which is the only case where CORS can be
 * the reason a request failed. Used to make that visible in the error text
 * instead of leaving the operator with a generic "cannot reach the server".
 */
export const IS_CROSS_ORIGIN_API = /^https?:\/\//i.test(API_BASE_URL);

if (import.meta.env.DEV) {
  // eslint-disable-next-line no-console
  console.info(`[api] base = ${API_BASE_URL}`);
}
