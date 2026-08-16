import type { Tone } from '../../components/common/StatusChip';
import type { LedgerKind, TimeBucket } from './types';

/**
 * Arabic for every `time_ledger.kind`, with the tone that says which way the
 * balance moved.
 *
 * The kinds are transcribed from `enum TimeLedgerKind` in schema.prisma. An
 * unknown kind falls through to its raw value rather than to a dash: a row
 * written by a newer backend is still a real movement of a customer's balance,
 * and hiding it behind '—' in a statement is the one thing a statement may not
 * do.
 */
export const LEDGER_KIND_AR: Record<LedgerKind, { label: string; tone: Tone }> = {
  trial_grant: { label: 'تجربة مجانية', tone: 'info' },
  purchase: { label: 'شراء', tone: 'success' },
  // NOT «رصيد اشتراك» — that is what the *bucket* is called, and the two chips
  // sit side by side in the statement. Naming both the same made the row read
  // as a stutter and hid the distinction the columns exist to draw: the kind is
  // the EVENT, the bucket is the WALLET it landed in.
  subscription_grant: { label: 'تجديد الاشتراك', tone: 'brand' },
  promo_grant: { label: 'عرض ترويجي', tone: 'gold' },
  admin_grant: { label: 'منحة يدوية', tone: 'gold' },
  consumption: { label: 'استهلاك', tone: 'neutral' },
  refund: { label: 'استرداد', tone: 'warning' },
  expiry: { label: 'انتهاء صلاحية', tone: 'warning' },
  adjustment: { label: 'تسوية يدوية', tone: 'warning' },
};

export const BUCKET_AR: Record<TimeBucket, { label: string; tone: Tone; hint: string }> = {
  perpetual: {
    label: 'رصيد دائم',
    tone: 'success',
    hint: 'التجربة المجانية والباقات المشتراة والمنح اليدوية — لا تنتهي صلاحيته.',
  },
  subscription: {
    label: 'رصيد اشتراك',
    tone: 'brand',
    hint: 'مخصّص الدورة الشهرية — ينتهي مع الدورة ولا يُرحَّل، ويُستهلك قبل الرصيد الدائم.',
  },
};

export function ledgerKindLabel(kind: string): string {
  return LEDGER_KIND_AR[kind as LedgerKind]?.label ?? kind;
}

export function ledgerKindTone(kind: string): Tone {
  return LEDGER_KIND_AR[kind as LedgerKind]?.tone ?? 'neutral';
}

export function bucketLabel(bucket: string): string {
  return BUCKET_AR[bucket as TimeBucket]?.label ?? bucket;
}

export function bucketTone(bucket: string): Tone {
  return BUCKET_AR[bucket as TimeBucket]?.tone ?? 'neutral';
}
