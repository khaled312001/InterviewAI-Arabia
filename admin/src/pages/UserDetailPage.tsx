import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid2';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import BlockRounded from '@mui/icons-material/BlockRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlined from '@mui/icons-material/EditOutlined';
import ForumOutlined from '@mui/icons-material/ForumOutlined';
import QuestionAnswerOutlined from '@mui/icons-material/QuestionAnswerOutlined';
import StarBorderRounded from '@mui/icons-material/StarBorderRounded';
import TodayOutlined from '@mui/icons-material/TodayOutlined';
import type { GridColDef } from '@mui/x-data-grid';

import { DataTable } from '../components/common/DataTable';
import { ErrorState } from '../components/common/ErrorState';
import { Mono } from '../components/common/Mono';
import { Num } from '../components/common/Num';
import { PageHeader } from '../components/common/PageHeader';
import { RelativeTime } from '../components/common/RelativeTime';
import { SectionCard } from '../components/common/SectionCard';
import { StatCard } from '../components/common/StatCard';
import { StatusChip } from '../components/common/StatusChip';
import { StatGridSkeleton, TableSkeleton } from '../components/common/Skeletons';
import { chipCol, dateCol, numCol, textCol } from '../lib/columns';
import { formatNumber, formatRelative } from '../lib/format';
import { can, effectivePlan } from '../lib/permissions';
import { useServerPagination } from '../lib/hooks/useServerPagination';
import { useAuth } from '../store/auth';
import { MinutesPanel } from '../features/minutes/MinutesPanel';
import { useUser, useUserSessions } from '../features/users/api';
import { useUserActions } from '../features/users/actions';
import { UserFormDrawer } from '../features/users/UserFormDrawer';
import type { UserSession } from '../features/users/types';

/** The grid row: the API's nested category flattened, plus the per-answer average. */
interface SessionRow extends UserSession {
  categoryName: string;
  avgScore: number | null;
}

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const role = useAuth((s) => s.admin?.role);
  const canWrite = can(role, 'users.write');
  const canDelete = can(role, 'users.delete');
  // Every role may read the balance — support answers "where did my minutes
  // go?" and must not need the role that can also change it. The panel gates
  // its own write button on minutes.adjust.
  const canReadMinutes = can(role, 'minutes.read');

  const [editing, setEditing] = useState(false);
  const detail = useUser(id);
  const { paginationModel, onPaginationModelChange, page, pageSize } = useServerPagination();
  const sessions = useUserSessions(id, { page, limit: pageSize });
  const { toggleDisabled, remove } = useUserActions();

  if (detail.isError) {
    return (
      <ErrorState
        error={detail.error}
        variant="page"
        onRetry={() => detail.refetch()}
        description="تعذّر فتح هذا الحساب. قد يكون محذوفًا أو المعرّف غير صحيح."
      />
    );
  }

  if (detail.isLoading || !detail.data) {
    return (
      <>
        <PageHeader title="" loading />
        <StatGridSkeleton count={4} />
        <Card>
          <TableSkeleton rows={6} cols={5} />
        </Card>
      </>
    );
  }

  const { user, stats } = detail.data;
  const plan = effectivePlan(user);

  const rows: SessionRow[] = (sessions.data?.sessions ?? []).map((s) => ({
    ...s,
    categoryName: s.category?.nameAr ?? '—',
    // total_score is a SUM over answers, so only the average is comparable
    // between a 3-answer and a 10-answer session.
    avgScore: s.answersCount > 0 ? s.totalScore / s.answersCount : null,
  }));

  const columns: GridColDef<SessionRow>[] = [
    textCol<SessionRow>({ field: 'id', headerName: '#', width: 90, mono: true }),
    textCol<SessionRow>({ field: 'categoryName', headerName: 'القسم', flex: 1, minWidth: 160 }),
    chipCol<SessionRow>({ field: 'kind', headerName: 'النوع', width: 110, kind: 'sessionKind' }),
    numCol<SessionRow>({ field: 'answersCount', headerName: 'الإجابات', width: 110 }),
    numCol<SessionRow>({ field: 'avgScore', headerName: 'متوسط الدرجة', width: 140, format: 'decimal' }),
    dateCol<SessionRow>({ field: 'startedAt', headerName: 'بدأت', width: 160 }),
    chipCol<SessionRow>({
      field: 'endedAt',
      headerName: 'الحالة',
      width: 130,
      kind: 'sessionStatus',
      getValue: (row) => Boolean(row.endedAt),
    }),
  ];

  const facts: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'البريد الإلكتروني', value: <Mono value={user.email} copyable /> },
    { label: 'رقم الهاتف', value: <Mono value={user.phone} /> },
    { label: 'لغة الواجهة', value: <Typography variant="body2">{user.language === 'en' ? 'الإنجليزية' : 'العربية'}</Typography> },
    { label: 'تفعيل البريد', value: <RelativeTime value={user.emailVerifiedAt} emptyLabel="لم يُفعَّل" /> },
    { label: 'آخر دخول', value: <RelativeTime value={user.lastLoginAt} /> },
    { label: 'تاريخ التسجيل', value: <RelativeTime value={user.createdAt} mode="both" /> },
    { label: 'ينتهي الاشتراك المميز', value: <RelativeTime value={user.premiumUntil} mode="both" /> },
    { label: 'عدد الاشتراكات المسجّلة', value: <Num value={stats.subscriptionsCount} variant="body2" /> },
  ];

  return (
    <>
      <PageHeader
        title={user.name}
        description={`حساب رقم ${user.id}`}
        actions={
          <>
            {canWrite && (
              <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => setEditing(true)}>
                تعديل
              </Button>
            )}
            {canWrite && (
              <Button
                variant={user.isDisabled ? 'contained' : 'outlined'}
                color={user.isDisabled ? 'success' : 'warning'}
                startIcon={user.isDisabled ? <CheckCircleRounded /> : <BlockRounded />}
                onClick={() => void toggleDisabled(user)}
              >
                {user.isDisabled ? 'تفعيل الحساب' : 'تعطيل الحساب'}
              </Button>
            )}
          </>
        }
        meta={
          <>
            <StatusChip
              kind="plan"
              value={plan}
              tooltip={
                plan === 'premium_expired'
                  ? 'الخطة مميزة لكن تاريخ الانتهاء مضى — المستخدم محدود بحصة المجاني'
                  : undefined
              }
            />
            <StatusChip kind="active" value={!user.isDisabled} />
            <Mono value={user.email} />
          </>
        }
      />

      <Grid container spacing={{ xs: 2, md: 3 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard label="الجلسات" value={stats.sessionsCount} icon={<ForumOutlined />} index={0}
            hint={`منها ${formatNumber(stats.completedCount)} مكتملة`} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard label="الإجابات" value={stats.answersCount} icon={<QuestionAnswerOutlined />} tone="info" index={1} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            label="متوسط الدرجة لكل إجابة"
            // A user who never answered has no average; '—' is the truth, 0 is not.
            value={stats.avgScore === null ? undefined : formatNumber(stats.avgScore, 'decimal')}
            format="raw"
            icon={<StarBorderRounded />}
            tone="gold"
            index={2}
            hint={stats.avgScore === null ? 'لا توجد إجابات بعد' : undefined}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          {/* This tile used to show `daily_questions_used`. That counter was the
              old free tier, and migration 002 replaced it with the minute
              balance — nothing increments it any more, so it would have sat at
              whatever value it held on the day of the deploy and read as "this
              user asked nothing today". The balance has its own section below,
              from its own endpoint; last activity is what this slot is for. */}
          <StatCard
            label="آخر جلسة"
            value={
              stats.lastSessionAt ? formatRelative(new Date(stats.lastSessionAt)) : undefined
            }
            format="raw"
            icon={<TodayOutlined />}
            tone="neutral"
            index={3}
            hint={stats.lastSessionAt ? undefined : 'لم يبدأ أي جلسة بعد'}
          />
        </Grid>
      </Grid>

      <SectionCard title="بيانات الحساب">
        <Grid container spacing={2}>
          {facts.map((f) => (
            <Grid key={f.label} size={{ xs: 12, sm: 6, md: 4 }}>
              <Stack gap={0.5}>
                <Typography variant="caption" color="text.secondary">
                  {f.label}
                </Typography>
                {f.value}
              </Stack>
            </Grid>
          ))}
        </Grid>
      </SectionCard>

      {canReadMinutes && (
        <MinutesPanel userId={user.id} userEmail={user.email} userDisabled={user.isDisabled} />
      )}

      <Box>
        <Typography variant="h4" sx={{ mb: 2 }}>
          الجلسات
        </Typography>
        <DataTable<SessionRow>
          rows={rows}
          columns={columns}
          query={sessions}
          paginationModel={paginationModel}
          onPaginationModelChange={onPaginationModelChange}
          rowCount={sessions.data?.total}
          empty={{
            title: 'لا توجد جلسات',
            description: 'لم يبدأ هذا المستخدم أي جلسة تدريب أو مقابلة بعد.',
          }}
        />
      </Box>

      {canDelete && (
        <SectionCard
          title="منطقة الخطر"
          description="حذف الحساب نهائي ويشمل جلساته وإجاباته واشتراكاته ومدفوعاته."
        >
          <Button
            color="error"
            startIcon={<DeleteOutlineRounded />}
            onClick={() => void remove(user, () => navigate('/users', { replace: true }))}
          >
            حذف الحساب نهائيًا
          </Button>
        </SectionCard>
      )}

      <UserFormDrawer open={editing} user={user} onClose={() => setEditing(false)} />
    </>
  );
}
