import FormHelperText from '@mui/material/FormHelperText';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import { RANGE_PRESETS, type UseDateRangeResult } from '../../lib/hooks/useDateRange';
import { formatYmd, TIMEZONE } from '../../lib/format';

export interface DateRangeControlProps {
  /** The whole useDateRange() result — the control owns no state of its own. */
  value: UseDateRangeResult;
  /** Hides the resolved "from → to" caption; useful in tight toolbars. */
  hideSummary?: boolean;
}

/**
 * The shared analytics range picker. Presets stay relative; a custom range
 * uses two native date inputs, which are direction-neutral by construction —
 * their internal layout is the browser's, so they are marked as LTR islands
 * rather than being flipped.
 */
export function DateRangeControl({ value, hideSummary = false }: DateRangeControlProps) {
  const { preset, range, days, setPreset, setCustom, error, maxDay } = value;
  const isCustom = preset === 'custom';

  return (
    <Stack gap={0.75} sx={{ width: { xs: '100%', sm: 'auto' } }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        gap={1}
        alignItems={{ sm: 'center' }}
        sx={{ width: { xs: '100%', sm: 'auto' } }}
      >
        <TextField
          select
          size="small"
          label="المدى الزمني"
          value={preset}
          onChange={(e) => setPreset(e.target.value as typeof preset)}
          sx={{ minWidth: 168, width: { xs: '100%', sm: 168 } }}
        >
          {RANGE_PRESETS.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.labelAr}
            </MenuItem>
          ))}
        </TextField>

        {isCustom && (
          <>
            <TextField
              type="date"
              size="small"
              label="من"
              value={range.from}
              onChange={(e) => setCustom({ from: e.target.value })}
              error={Boolean(error)}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { max: maxDay, dir: 'ltr', 'aria-label': 'تاريخ البداية' },
              }}
              sx={{ minWidth: 156, width: { xs: '100%', sm: 156 } }}
            />
            <TextField
              type="date"
              size="small"
              label="إلى"
              value={range.to}
              onChange={(e) => setCustom({ to: e.target.value })}
              error={Boolean(error)}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { max: maxDay, dir: 'ltr', 'aria-label': 'تاريخ النهاية' },
              }}
              sx={{ minWidth: 156, width: { xs: '100%', sm: 156 } }}
            />
          </>
        )}
      </Stack>

      {error ? (
        <FormHelperText error>{error}</FormHelperText>
      ) : (
        !hideSummary && (
          <Stack direction="row" alignItems="center" gap={0.5} sx={{ color: 'text.secondary' }}>
            <CalendarMonthRounded sx={{ fontSize: 14 }} />
            <Typography variant="caption" color="text.secondary">
              {formatYmd(range.from)} — {formatYmd(range.to)} ({days} يومًا، بتوقيت {TIMEZONE === 'Africa/Cairo' ? 'القاهرة' : TIMEZONE})
            </Typography>
          </Stack>
        )
      )}
    </Stack>
  );
}
