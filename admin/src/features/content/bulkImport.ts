import { isDifficulty, type QuestionInput } from './types';

/**
 * Client-side mirror of `questionSchema` in backend/src/routes/admin.js.
 *
 * The importer validates the *shape* of every row before sending anything, so
 * a typo in row 37 is reported as row 37 rather than as one opaque "Validation
 * failed" for the whole file. The backend repeats the same checks — this is a
 * fast local echo of them, never a replacement.
 */

export interface RowIssue {
  path: string;
  message: string;
}

export interface RowError {
  /** 0-based index into the submitted array. */
  row: number;
  issues: RowIssue[];
}

export interface BulkParseResult {
  /** Present only when the text is valid JSON of the expected outer shape. */
  rows?: unknown[];
  /** A whole-document failure — bad JSON, wrong outer shape, size limits. */
  fatal?: string;
}

export const BULK_MAX_ROWS = 500;

export const BULK_TEMPLATE = `{
  "questions": [
    {
      "categoryId": 1,
      "questionAr": "حدّثني عن نفسك.",
      "questionEn": "Tell me about yourself.",
      "difficulty": "easy",
      "isActive": true
    }
  ]
}`;

/** Accepts either `{ "questions": [...] }` or a bare `[...]`. */
export function parseBulkText(text: string): BulkParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { fatal: 'الصق محتوى JSON أولًا.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    const detail = err instanceof Error ? err.message : '';
    return { fatal: `JSON غير صالح${detail ? ` — ${detail}` : ''}` };
  }

  const rows = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { questions?: unknown }).questions)
      ? ((parsed as { questions: unknown[] }).questions)
      : null;

  if (!rows) {
    return { fatal: 'المتوقّع مصفوفة أسئلة، أو كائن يحتوي على المفتاح "questions".' };
  }
  if (rows.length === 0) return { fatal: 'المصفوفة فارغة — لا توجد أسئلة للاستيراد.' };
  if (rows.length > BULK_MAX_ROWS) {
    return { fatal: `الحد الأقصى ${BULK_MAX_ROWS} سؤال في الدفعة الواحدة (الملف يحتوي ${rows.length}).` };
  }

  return { rows };
}

export interface BulkValidation {
  questions: QuestionInput[];
  errors: RowError[];
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

export function validateBulkRows(rows: unknown[], knownCategoryIds: Set<number>): BulkValidation {
  const questions: QuestionInput[] = [];
  const errors: RowError[] = [];

  rows.forEach((raw, index) => {
    const issues: RowIssue[] = [];

    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      errors.push({ row: index, issues: [{ path: '', message: 'الصف ليس كائن JSON.' }] });
      return;
    }
    const row = raw as Record<string, unknown>;

    const categoryId = typeof row.categoryId === 'number' ? row.categoryId : Number.NaN;
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      issues.push({ path: 'categoryId', message: 'مطلوب: رقم صحيح موجب.' });
    } else if (knownCategoryIds.size > 0 && !knownCategoryIds.has(categoryId)) {
      // Caught here rather than as a foreign-key 500 on insert.
      issues.push({ path: 'categoryId', message: `القسم رقم ${categoryId} غير موجود.` });
    }

    if (!isNonEmptyString(row.questionAr)) {
      issues.push({ path: 'questionAr', message: 'مطلوب: نص السؤال بالعربية.' });
    }
    if (!isNonEmptyString(row.questionEn)) {
      issues.push({ path: 'questionEn', message: 'مطلوب: نص السؤال بالإنجليزية.' });
    }

    if (row.difficulty !== undefined && !isDifficulty(row.difficulty)) {
      issues.push({ path: 'difficulty', message: 'القيم المسموحة: easy أو medium أو hard.' });
    }
    if (row.isActive !== undefined && typeof row.isActive !== 'boolean') {
      issues.push({ path: 'isActive', message: 'القيم المسموحة: true أو false.' });
    }

    if (issues.length > 0) {
      errors.push({ row: index, issues });
      return;
    }

    questions.push({
      categoryId,
      questionAr: (row.questionAr as string).trim(),
      questionEn: (row.questionEn as string).trim(),
      difficulty: isDifficulty(row.difficulty) ? row.difficulty : 'medium',
      isActive: typeof row.isActive === 'boolean' ? row.isActive : true,
    });
  });

  return { questions, errors };
}

/** The `details` shape thrown by POST /admin/questions/bulk on BULK_ROW_ERRORS. */
export interface BulkServerDetails {
  rows?: RowError[];
  totalInvalid?: number;
}
