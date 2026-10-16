/**
 * The search query, one shape for every caller: the public search endpoint,
 * the app, and saved-search alerts (which store exactly these query params),
 * so an alert runs precisely the search the person saved.
 */

import { z } from 'zod';

export const list = (v) => (v == null || v === '' ? [] : String(v).split(',').map((s) => s.trim()).filter(Boolean));

export const searchSchema = z.object({
  q: z.string().max(120).optional().default(''),
  country: z.string().max(200).optional(),
  city: z.string().max(80).optional(),
  workplace: z.string().max(60).optional(),
  type: z.string().max(100).optional(),
  seniority: z.string().max(100).optional(),
  salary: z.enum(['0', '1']).optional(),
  posted: z.coerce.number().int().min(1).max(60).optional(),
  company: z.string().max(120).optional(),
  language: z.string().regex(/^[a-z]{2}$/).optional(),
  worldwide: z.enum(['0', '1']).optional().default('1'),
  sort: z.enum(['best', 'relevance', 'date', 'salary']).optional().default('best'),
  page: z.coerce.number().int().min(1).max(50).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export function toFilters(p) {
  return {
    q: p.q.trim(),
    country: list(p.country).map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)).slice(0, 10),
    city: p.city?.trim() || null,
    workplace: list(p.workplace),
    type: list(p.type),
    seniority: list(p.seniority),
    salaryOnly: p.salary === '1',
    postedWithin: p.posted || null,
    company: p.company?.trim() || null,
    language: p.language || null,
    includeWorldwide: p.worldwide !== '0',
    sort: p.sort,
    page: p.page,
    pageSize: p.pageSize,
  };
}
