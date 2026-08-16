import type { Shadows } from '@mui/material/styles';

/**
 * Flat by default. The dark scheme communicates elevation with borders, not
 * shadows — these five levels are reserved for genuinely floating surfaces
 * (Menu, Popover, Dialog, Tooltip, Snackbar). App code may use 0–4 only.
 */
const s1 = '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)';
const s2 = '0 2px 4px -1px rgba(16,24,40,.05), 0 4px 8px -2px rgba(16,24,40,.08)';
const s3 = '0 4px 8px -2px rgba(16,24,40,.06), 0 12px 16px -4px rgba(16,24,40,.10)';
const s4 = '0 8px 12px -4px rgba(16,24,40,.06), 0 20px 24px -4px rgba(16,24,40,.12)';

export const shadows = ['none', s1, s2, s3, s4, ...Array(20).fill(s4)] as unknown as Shadows;
