/** Shapes returned by backend/src/routes/admin.js for the content section. */

export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

/** Labels live in StatusChip's central map; this is for selects and helper copy. */
export const DIFFICULTY_LABEL_AR: Record<Difficulty, string> = {
  easy: 'سهل',
  medium: 'متوسط',
  hard: 'صعب',
};

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && (DIFFICULTIES as string[]).includes(value);
}

export interface AdminCategory {
  id: number;
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  icon: string | null;
  isPremium: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  /** Deleted with the category (schema.prisma: Question.category onDelete Cascade). */
  questionCount: number;
  /** Blocks deletion outright — Session.category has no cascade. */
  sessionCount: number;
}

export interface AdminQuestion {
  /** BigInt on the server, serialised as a string. */
  id: string;
  categoryId: number;
  questionAr: string;
  questionEn: string;
  difficulty: Difficulty;
  usageCount: number;
  isActive: boolean;
  createdAt: string;
  category?: { id: number; nameAr: string; nameEn: string; icon: string | null };
}

export interface QuestionInput {
  categoryId: number;
  questionAr: string;
  questionEn: string;
  difficulty: Difficulty;
  isActive: boolean;
}

export interface CategoryInput {
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  icon: string | null;
  isPremium: boolean;
  isActive: boolean;
  sortOrder: number;
}
