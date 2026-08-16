import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid2';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AccessTimeRounded from '@mui/icons-material/AccessTimeRounded';
import AllInclusiveRounded from '@mui/icons-material/AllInclusiveRounded';
import AutorenewRounded from '@mui/icons-material/AutorenewRounded';
import LockClockRounded from '@mui/icons-material/LockClockRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import type { GridColDef } from '@mui/x-data-grid';

import { DataTable } from '../../components/common/DataTable';
import { Mono } from '../../components/common/Mono';
import { SectionCard } from '../../components/common/SectionCard';
import { StatCard } from '../../components/common/StatCard';
import { StatusChip } from '../../components/common/StatusChip';
import { RelativeTime } from '../../components/common/RelativeTime';
import { StatGridSkeleton } from '../../components/common/Skeletons';
import { dateCol } from '../../lib/columns';
import { can } from '../../lib/permissions';
import { formatClock, formatDurationAr, secondsToMinutes } from '../../lib/format';
import { useAuth } from '../../store/auth';
import { AdjustMinutesDrawer } from './AdjustMinutesDrawer';
import { useUserMinutes } from './api';
import { bucketLabel, bucketTone, ledgerKindLabel, ledgerKindTone } from './labels';
import type { LedgerEntry } from './types';

export interface MinutesPanelProps {
  userId: string;
  userEmail: string | null;
  userDisabled: boolean;
}

/**
 * The minute balance and the statement behind it.
 *
 * The balance is FOUR numbers, not one, because four things can be true at
 * once and collapsing them is how a support answer becomes wrong: perpetual
 * minutes that never expire, a subscription allowance that does, seconds held
 * by a meeting that is running right now, and the available figure the app
 * actually shows the customer. Every one of them is read from
 * `balanceSnapshot()`; none is computed here.
 *
 * The ledger below is the append-only truth (`time_ledger`). It is what makes
 * "where did my minutes go?" answerable instead of arguable, so it shows the
 * signed movement, the bucket it came out of, and the balance it left behind.
 */
export function MinutesPanel({ userId, userEmail, userDisabled }: MinutesPanelProps) {
  const role = useAuth((s) => s.admin?.role);
  const canAdjust = can(role, 'minutes.adjust');
  const [adjusting, setAdjusting] = useState(false);

  const query = useUserMinutes(userId);
  const balance = query.data?.balance;
  const failed = query.isError;

  const rows = useMemo<LedgerEntry[]>(() => query.data?.entries ?? [], [query.data]);

  const columns = useMemo<GridColDef<LedgerEntry>[]>(
    () => [
      dateCol<LedgerEntry>({ field: 'createdAt', headerName: 'التاريخ', mode: 'both', width: 170 }),
      {
        field: 'kind',
        headerName: 'الحركة',
        width: 140,
        sortable: false,
        align: 'left',
        headerAlign: 'left',
        renderCell: ({ row }) => (
          <StatusChip
            kind="custom"
            value={row.kind}
            label={ledgerKindLabel(row.kind)}
            tone={ledgerKindTone(row.kind)}
          />
        ),
      },
      {
        field: 'bucket',
        headerName: 'المحفظة',
        width: 130,
        sortable: false,
        align: 'left',
        headerAlign: 'left',
        renderCell: ({ row }) => (
          <StatusChip
            kind="custom"
            value={row.bucket}
            label={bucketLabel(row.bucket)}
            tone={bucketTone(row.bucket)}
          />
        ),
      },
      {
        field: 'seconds',
        headerName: 'المقدار',
        width: 130,
        type: 'number',
        align: 'left',
        headerAlign: 'left',
        // mm:ss, not minutes: a statement rounded to minutes cannot be added up
        // and checked against the balance it produced.
        renderCell: ({ row }) => (
          <Tooltip title={formatDurationAr(Math.abs(row.seconds))}>
            <Typography
              variant="body2"
              className="ltr-island tabular"
              color={row.seconds >= 0 ? 'success.main' : 'text.primary'}
            >
              {row.seconds >= 0 ? '+' : '−'}
              {formatClock(Math.abs(row.seconds))}
            </Typography>
          </Tooltip>
        ),
      },
      {
        field: 'balanceAfterSeconds',
        headerName: 'الرصيد بعدها',
        width: 140,
        type: 'number',
        align: 'left',
        headerAlign: 'left',
        renderCell: ({ row }) => (
          <Tooltip title={formatDurationAr(row.balanceAfterSeconds)}>
            <Typography variant="body2" className="ltr-island tabular">
              {formatClock(row.balanceAfterSeconds)}
            </Typography>
          </Tooltip>
        ),
      },
      {
        field: 'note',
        headerName: 'التفاصيل',
        flex: 1,
        minWidth: 200,
        sortable: false,
        align: 'left',
        headerAlign: 'left',
        renderCell: ({ row }) => (
          <Stack gap={0.25} sx={{ minWidth: 0, py: 0.5 }}>
            <Typography variant="body2" noWrap>
              {row.note || '—'}
            </Typography>
            {(row.meetingSessionId || row.paymentId) && (
              <Typography variant="caption" color="text.secondary" component="span">
                {row.meetingSessionId ? 'مقابلة ' : 'دفعة '}
                <Mono value={row.meetingSessionId ?? row.paymentId} variant="caption" />
              </Typography>
            )}
          </Stack>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <Box>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ sm: 'center' }}
          gap={1.5}
          sx={{ mb: 2 }}
        >
          <Box>
            <Typography variant="h4">رصيد الدقائق</Typography>
            <Typography variant="body2" color="text.secondary">
              الرصيد المتاح هو ما يراه المستخدم في التطبيق، وكشف الحساب أسفله هو مصدره.
            </Typography>
          </Box>
          {canAdjust && (
            <Button startIcon={<TuneRounded />} onClick={() => setAdjusting(true)}>
              تعديل الرصيد
            </Button>
          )}
        </Stack>

        {query.isLoading ? (
          <StatGridSkeleton count={4} />
        ) : (
          <Grid container spacing={{ xs: 2, md: 3 }}>
            <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
              <StatCard
                index={0}
                label="الرصيد المتاح (دقائق)"
                value={balance?.minutesRemaining}
                icon={<AccessTimeRounded />}
                tone={
                  balance && balance.availableSeconds <= balance.lowWaterSeconds
                    ? 'warning'
                    : 'brand'
                }
                hint={
                  balance && balance.availableSeconds <= balance.lowWaterSeconds
                    ? 'تحت حد التنبيه — يرى المستخدم تحذير النفاد داخل المقابلة'
                    : 'رصيد الاشتراك يُستهلك قبل الرصيد الدائم'
                }
                error={failed}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
              <StatCard
                index={1}
                label="رصيد دائم (دقائق)"
                value={balance ? secondsToMinutes(balance.balanceSeconds) : undefined}
                icon={<AllInclusiveRounded />}
                tone="success"
                hint="التجربة والباقات والمنح اليدوية — لا تنتهي صلاحيته"
                error={failed}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
              <StatCard
                index={2}
                label="رصيد الاشتراك (دقائق)"
                value={balance ? secondsToMinutes(balance.subSeconds) : undefined}
                icon={<AutorenewRounded />}
                tone="info"
                hint={
                  balance?.subExpiresAt
                    ? 'مخصّص الدورة الحالية — لا يُرحَّل بعد انتهائها'
                    : 'لا توجد دورة اشتراك سارية'
                }
                error={failed}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
              <StatCard
                index={3}
                label="محجوز لمقابلة جارية (دقائق)"
                value={balance ? secondsToMinutes(balance.heldSeconds) : undefined}
                icon={<LockClockRounded />}
                tone="neutral"
                hint="حجز مؤقت وليس خصمًا — يُفرج عنه عند انتهاء المقابلة"
                error={failed}
              />
            </Grid>
          </Grid>
        )}
      </Box>

      <SectionCard title="حالة الرصيد">
        <Stack direction="row" gap={1} sx={{ flexWrap: 'wrap', mb: 1.5 }}>
          <StatusChip
            kind="custom"
            value="trial"
            label={
              balance?.trialGranted
                ? `التجربة المجانية: مُنحت (${formatDurationAr(balance.trialSeconds)})`
                : 'التجربة المجانية: لم تُمنح بعد'
            }
            tone={balance?.trialGranted ? 'neutral' : 'info'}
            tooltip={
              balance?.trialGranted
                ? 'تُمنح مرة واحدة لكل حساب، عند أول قراءة للرصيد أو أول مقابلة.'
                : 'ستُمنح تلقائيًا عند أول استخدام — لا تُمنح عند التسجيل.'
            }
          />
          {balance?.subExpiresAt && (
            <StatusChip
              kind="custom"
              value="cycle"
              label="دورة اشتراك سارية"
              tone="brand"
              tooltip="ينتهي رصيد الاشتراك مع هذه الدورة"
            />
          )}
        </Stack>

        <Stack gap={0.5}>
          {balance?.subExpiresAt && (
            <Typography variant="caption" color="text.secondary" component="span">
              ينتهي رصيد الاشتراك: <RelativeTime value={balance.subExpiresAt} mode="both" variant="caption" />
            </Typography>
          )}
          {balance && balance.heldSeconds > 0 && (
            <Typography variant="caption" color="warning.main">
              هناك حجز قائم الآن — الأرجح أن المستخدم في مقابلة. الحجز ليس خصمًا، ويُسوّى عند
              انتهائها.
            </Typography>
          )}
        </Stack>
      </SectionCard>

      <Box>
        <Typography variant="h4" sx={{ mb: 2 }}>
          كشف حساب الدقائق
        </Typography>
        <DataTable<LedgerEntry>
          rows={rows}
          columns={columns}
          query={query}
          // The endpoint returns the newest 100 rows and no total, so there is
          // nothing to page through. Rendering an inert pager would imply there
          // is — the note under the table says what the cap is instead.
          paginationMode="none"
          errorTitle="تعذّر تحميل كشف الحساب"
          empty={{
            title: 'لا توجد حركات على الرصيد',
            description:
              'لم يُمنح هذا الحساب أي دقائق ولم يستهلك أيًّا منها بعد — بما في ذلك التجربة المجانية، التي تُمنح عند أول استخدام لا عند التسجيل.',
            icon: <AccessTimeRounded />,
          }}
        />
        {rows.length > 0 && (
          // Both numeric columns are exact seconds, and a movement (٧:٢٢) and a
          // balance (٣:١٦:١٢) in the same format are indistinguishable at a
          // glance — one is mm:ss, the other h:mm:ss, and nothing on the row
          // says which. They stay exact rather than rounding to minutes,
          // because a statement rounded to minutes cannot be added up and
          // checked against the balance it produced; the format is stated here
          // instead. Hovering any figure shows it written out in full.
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            المقدار والرصيد بصيغة (ساعات:)دقائق:ثوانٍ بالثانية الدقيقة — مرّر المؤشر فوق أي رقم
            لقراءته مكتوبًا.
          </Typography>
        )}
        {rows.length >= 100 && (
          <Alert severity="info" sx={{ mt: 1.5 }}>
            يعرض الخادم أحدث ١٠٠ حركة فقط. للحركات الأقدم راجع قاعدة البيانات مباشرة.
          </Alert>
        )}
      </Box>

      {canAdjust && (
        <AdjustMinutesDrawer
          open={adjusting}
          onClose={() => setAdjusting(false)}
          userId={userId}
          userEmail={userEmail}
          userDisabled={userDisabled}
          balance={balance}
        />
      )}
    </>
  );
}
