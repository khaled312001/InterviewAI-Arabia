import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import BlockRounded from '@mui/icons-material/BlockRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlined from '@mui/icons-material/EditOutlined';
import PeopleAltRounded from '@mui/icons-material/PeopleAltRounded';
import PersonAddAlt1Rounded from '@mui/icons-material/PersonAddAlt1Rounded';
import type { GridColDef } from '@mui/x-data-grid';

import { DataTable } from '../components/common/DataTable';
import { Can } from '../components/common/Guard';
import { Mono } from '../components/common/Mono';
import { Num } from '../components/common/Num';
import { PageHeader } from '../components/common/PageHeader';
import { RelativeTime } from '../components/common/RelativeTime';
import { StatusChip } from '../components/common/StatusChip';
import { chipCol, dateCol, textCol, actionsCol } from '../lib/columns';
import { can, effectivePlan } from '../lib/permissions';
import { useDebouncedValue } from '../lib/hooks/useDebouncedValue';
import { useServerPagination } from '../lib/hooks/useServerPagination';
import { useAuth } from '../store/auth';
import { useUsers } from '../features/users/api';
import { useUserActions } from '../features/users/actions';
import { UserFormDrawer } from '../features/users/UserFormDrawer';
import type { AdminUser, PlanFilter, StatusFilter } from '../features/users/types';

const EXPIRED_HINT =
  'الخطة مميزة لكن تاريخ الانتهاء مضى — المستخدم محدود بحصة المجاني حتى يُجدَّد';

export function UsersPage() {
  const navigate = useNavigate();
  const role = useAuth((s) => s.admin?.role);
  const canWrite = can(role, 'users.write');
  const canDelete = can(role, 'users.delete');
  const canCreate = can(role, 'users.create');

  const { paginationModel, onPaginationModelChange, page, pageSize, reset } = useServerPagination();
  const [search, setSearch] = useState('');
  const [plan, setPlan] = useState<PlanFilter>('');
  const [status, setStatus] = useState<StatusFilter>('');
  const q = useDebouncedValue(search, 300);
  // The row is kept after the drawer closes so its content does not blank out
  // mid-transition; only `editOpen` drives visibility.
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const query = useUsers({ page, limit: pageSize, q, plan, status });
  const { toggleDisabled, remove } = useUserActions();

  // A narrowed result set must start at page 1, or the grid asks for page 7 of
  // a 2-page result and shows nothing. Skipped on mount so a shared
  // ?page=3 link still opens on page 3.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    reset();
  }, [q, plan, status, reset]);

  const filtered = Boolean(q || plan || status);

  const columns: GridColDef<AdminUser>[] = [
    textCol<AdminUser>({ field: 'id', headerName: '#', width: 90, mono: true }),
    textCol<AdminUser>({ field: 'email', headerName: 'البريد الإلكتروني', flex: 1, minWidth: 220, mono: true, copyable: true }),
    textCol<AdminUser>({ field: 'name', headerName: 'الاسم', flex: 1, minWidth: 150 }),
    chipCol<AdminUser>({
      field: 'plan',
      headerName: 'الخطة',
      width: 130,
      kind: 'plan',
      // The effective plan, not the raw column: a lapsed premium row is gated
      // as free by services/quota.js and must not read as an active subscription.
      getValue: (row) => effectivePlan(row),
      tooltip: (row) => (effectivePlan(row) === 'premium_expired' ? EXPIRED_HINT : undefined),
    }),
    dateCol<AdminUser>({ field: 'premiumUntil', headerName: 'ينتهي في', width: 150 }),
    chipCol<AdminUser>({
      field: 'isDisabled',
      headerName: 'الحالة',
      width: 110,
      kind: 'active',
      getValue: (row) => !row.isDisabled,
    }),
    // The daily question counter used to sit here. Migration 002 replaced the
    // daily quota with a minute balance, and `users.daily_questions_used` is now
    // a column nothing reads — it is kept in the schema only so a rolled-back
    // backend still boots, and 003 drops it. Showing it would be showing a live
    // number that stopped moving. The balance is not shown in its place because
    // availability is `validSub + perpetual − held`, and whether the
    // subscription bucket is still valid is a server-side comparison against
    // its expiry: recomputing that per row here would be a second, drifting
    // copy of the rule. The real figure is on the account page, from
    // GET /admin/users/:id/minutes.
    dateCol<AdminUser>({ field: 'lastLoginAt', headerName: 'آخر دخول', width: 150 }),
    dateCol<AdminUser>({ field: 'createdAt', headerName: 'التسجيل', width: 150 }),
    // A role with no write rights gets no actions column at all, rather than an
    // empty strip of disabled ghosts.
    ...(!canWrite && !canDelete ? [] : [actionsCol<AdminUser>({
      width: canDelete ? 150 : 110,
      render: (row) => (
        <>
          {canWrite && (
            <Tooltip title="تعديل">
              <IconButton
                size="small"
                aria-label="تعديل"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(row);
                  setEditOpen(true);
                }}
              >
                <EditOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {canWrite && (
            <Tooltip title={row.isDisabled ? 'تفعيل الحساب' : 'تعطيل الحساب'}>
              <IconButton
                size="small"
                aria-label={row.isDisabled ? 'تفعيل الحساب' : 'تعطيل الحساب'}
                color={row.isDisabled ? 'success' : 'default'}
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleDisabled(row);
                }}
              >
                {row.isDisabled ? <CheckCircleRounded fontSize="small" /> : <BlockRounded fontSize="small" />}
              </IconButton>
            </Tooltip>
          )}
          {canDelete && (
            <Tooltip title="حذف نهائي">
              <IconButton
                size="small"
                color="error"
                aria-label="حذف نهائي"
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(row);
                }}
              >
                <DeleteOutlineRounded fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </>
      ),
    })]),
  ];

  const toolbar = (
    <Stack direction={{ xs: 'column', md: 'row' }} gap={1.5} alignItems={{ md: 'center' }}>
      <TextField
        placeholder="ابحث بالبريد أو الاسم…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ maxWidth: { md: 320 } }}
        inputProps={{ 'aria-label': 'بحث في المستخدمين' }}
      />
      <TextField
        select
        label="الخطة"
        value={plan}
        onChange={(e) => setPlan(e.target.value as PlanFilter)}
        sx={{ maxWidth: { md: 180 } }}
      >
        <MenuItem value="">كل الخطط</MenuItem>
        <MenuItem value="free">مجاني</MenuItem>
        <MenuItem value="premium">مميز نشط</MenuItem>
        <MenuItem value="premium_expired">مميز منتهي</MenuItem>
      </TextField>
      <TextField
        select
        label="الحالة"
        value={status}
        onChange={(e) => setStatus(e.target.value as StatusFilter)}
        sx={{ maxWidth: { md: 160 } }}
      >
        <MenuItem value="">الكل</MenuItem>
        <MenuItem value="active">مفعّل</MenuItem>
        <MenuItem value="disabled">موقوف</MenuItem>
      </TextField>
      <Box sx={{ flexGrow: 1 }} />
      {filtered && (
        <Button
          variant="text"
          color="inherit"
          onClick={() => {
            setSearch('');
            setPlan('');
            setStatus('');
          }}
        >
          مسح عوامل التصفية
        </Button>
      )}
    </Stack>
  );

  const mobileCard = (row: AdminUser) => (
    <Card variant="outlined" onClick={() => navigate(`/users/${row.id}`)} sx={{ cursor: 'pointer' }}>
      <CardContent>
        <Stack gap={1}>
          <Stack direction="row" alignItems="center" gap={1}>
            <Typography variant="subtitle2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
              {row.name}
            </Typography>
            <StatusChip kind="active" value={!row.isDisabled} />
          </Stack>
          <Mono value={row.email} />
          <Stack direction="row" alignItems="center" gap={1} sx={{ flexWrap: 'wrap' }}>
            <StatusChip
              kind="plan"
              value={effectivePlan(row)}
              tooltip={effectivePlan(row) === 'premium_expired' ? EXPIRED_HINT : undefined}
            />
            <Box sx={{ flexGrow: 1 }} />
            <RelativeTime value={row.createdAt} variant="caption" color="text.secondary" />
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );

  return (
    <>
      <PageHeader
        title="المستخدمون"
        description="ابحث عن حساب، افتح تفاصيله، وأدِر خطته وحالته."
        icon={<PeopleAltRounded />}
        actions={
          <Can action="users.create">
            <Button startIcon={<PersonAddAlt1Rounded />} onClick={() => setCreateOpen(true)}>
              مستخدم جديد
            </Button>
          </Can>
        }
        meta={
          query.data ? (
            <Typography variant="caption" color="text.secondary">
              إجمالي: <Num value={query.data.total} variant="caption" />
            </Typography>
          ) : undefined
        }
      />

      <DataTable<AdminUser>
        rows={query.data?.users}
        columns={columns}
        query={query}
        paginationModel={paginationModel}
        onPaginationModelChange={onPaginationModelChange}
        rowCount={query.data?.total}
        toolbar={toolbar}
        onRowClick={(row) => navigate(`/users/${row.id}`)}
        renderMobileCard={mobileCard}
        empty={{
          title: filtered ? 'لا نتائج مطابقة' : 'لا يوجد مستخدمون بعد',
          description: filtered
            ? 'جرّب بحثًا أوسع أو امسح عوامل التصفية.'
            : 'سيظهر هنا كل من ينشئ حسابًا في التطبيق.',
          action: filtered ? (
            <Button
              variant="outlined"
              onClick={() => {
                setSearch('');
                setPlan('');
                setStatus('');
              }}
            >
              مسح عوامل التصفية
            </Button>
          ) : canCreate ? (
            <Button startIcon={<PersonAddAlt1Rounded />} onClick={() => setCreateOpen(true)}>
              مستخدم جديد
            </Button>
          ) : undefined,
        }}
      />

      {/* Two instances rather than one: `user === null` is what selects create
          mode, and the edit drawer keeps its row after closing so the content
          does not blank out mid-transition. */}
      <UserFormDrawer open={createOpen} user={null} onClose={() => setCreateOpen(false)} />
      {editing && (
        <UserFormDrawer open={editOpen} user={editing} onClose={() => setEditOpen(false)} />
      )}
    </>
  );
}
