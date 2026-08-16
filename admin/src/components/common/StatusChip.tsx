import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import type { Theme } from '@mui/material/styles';
import type { SxProps } from '@mui/material/styles';
import { ROLE_LABEL_AR } from '../../lib/permissions';

export type Tone = 'neutral' | 'brand' | 'gold' | 'success' | 'warning' | 'error' | 'info';

export type StatusKind =
  | 'plan' | 'subscription' | 'role' | 'active' | 'reportStatus' | 'aiResult' | 'source' | 'env'
  | 'difficulty' | 'custom';

export interface StatusChipProps {
  kind: StatusKind;
  value: string | boolean | null | undefined;
  /** Required only for kind='custom'. */
  label?: string;
  tone?: Tone;
  size?: 'small' | 'medium';
  variant?: 'soft' | 'solid' | 'outlined';
  icon?: React.ReactElement;
  tooltip?: string;
}

interface Entry { label: string; tone: Tone }

/** Every status/enum in the product resolves here; pages never build chips inline. */
const MAPS: Record<Exclude<StatusKind, 'custom'>, Record<string, Entry>> = {
  plan: {
    free: { label: 'مجاني', tone: 'neutral' },
    premium: { label: 'مميز', tone: 'gold' },
    premium_expired: { label: 'مميز (منتهي)', tone: 'warning' },
  },
  subscription: {
    active: { label: 'نشط', tone: 'success' },
    cancelled: { label: 'ملغي', tone: 'neutral' },
    expired: { label: 'منتهي', tone: 'warning' },
    refunded: { label: 'مسترد', tone: 'info' },
    pending: { label: 'قيد الانتظار', tone: 'warning' },
  },
  role: {
    super_admin: { label: ROLE_LABEL_AR.super_admin, tone: 'brand' },
    moderator: { label: ROLE_LABEL_AR.moderator, tone: 'info' },
    content_editor: { label: ROLE_LABEL_AR.content_editor, tone: 'neutral' },
  },
  active: {
    true: { label: 'مفعّل', tone: 'success' },
    false: { label: 'موقوف', tone: 'neutral' },
  },
  reportStatus: {
    true: { label: 'تمت المعالجة', tone: 'success' },
    false: { label: 'قيد المراجعة', tone: 'warning' },
    resolved: { label: 'تمت المعالجة', tone: 'success' },
    open: { label: 'قيد المراجعة', tone: 'warning' },
  },
  aiResult: {
    ok: { label: 'ناجح', tone: 'success' },
    success: { label: 'ناجح', tone: 'success' },
    error: { label: 'فشل', tone: 'error' },
    fallback: { label: 'احتياطي', tone: 'warning' },
    cached: { label: 'من الذاكرة', tone: 'info' },
  },
  source: {
    db: { label: 'قاعدة البيانات', tone: 'brand' },
    env: { label: 'ملف البيئة', tone: 'neutral' },
    unset: { label: 'غير مضبوط', tone: 'warning' },
  },
  env: {
    production: { label: 'إنتاج', tone: 'success' },
    staging: { label: 'تجريبي', tone: 'warning' },
    development: { label: 'تطوير', tone: 'neutral' },
  },
  // Question.difficulty (schema.prisma enum Difficulty).
  difficulty: {
    easy: { label: 'سهل', tone: 'success' },
    medium: { label: 'متوسط', tone: 'info' },
    hard: { label: 'صعب', tone: 'warning' },
  },
};

const UNKNOWN: Entry = { label: '—', tone: 'neutral' };

/** Tones borrow the semantic palette so both schemes are correct for free. */
const TONE_PATH: Record<Tone, 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info' | null> = {
  brand: 'primary',
  gold: 'secondary',
  success: 'success',
  warning: 'warning',
  error: 'error',
  info: 'info',
  neutral: null,
};

function toneSx(tone: Tone, variant: 'soft' | 'solid' | 'outlined'): SxProps<Theme> {
  const path = TONE_PATH[tone];

  return (t: Theme) => {
    const channel = path
      ? t.vars.palette[path].mainChannel
      : t.vars.palette.text.secondaryChannel;
    const main = path ? t.vars.palette[path].main : t.vars.palette.text.secondary;
    const contrast = path ? t.vars.palette[path].contrastText : t.vars.palette.background.paper;

    if (variant === 'solid') {
      return { backgroundColor: main, color: contrast, border: 0 };
    }
    if (variant === 'outlined') {
      return {
        backgroundColor: 'transparent',
        color: main,
        border: `1px solid rgba(${channel} / 0.4)`,
      };
    }
    return {
      backgroundColor: `rgba(${channel} / 0.12)`,
      color: main,
      border: 0,
      '& .MuiChip-icon': { color: 'inherit' },
    };
  };
}

export function StatusChip({
  kind,
  value,
  label,
  tone,
  size = 'small',
  variant = 'soft',
  icon,
  tooltip,
}: StatusChipProps) {
  const key = typeof value === 'boolean' ? String(value) : (value ?? '').toString();
  const entry: Entry =
    kind === 'custom'
      ? { label: label ?? key ?? '—', tone: tone ?? 'neutral' }
      : (MAPS[kind][key] ?? UNKNOWN);

  const finalTone = tone ?? entry.tone;
  const chip = (
    <Chip
      size={size}
      label={label ?? entry.label}
      icon={icon}
      sx={toneSx(finalTone, variant)}
    />
  );

  return tooltip ? <Tooltip title={tooltip}><span>{chip}</span></Tooltip> : chip;
}
