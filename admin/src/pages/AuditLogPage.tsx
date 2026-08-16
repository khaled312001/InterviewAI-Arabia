import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import DataObjectRounded from '@mui/icons-material/DataObjectRounded';
import type { GridColDef } from '@mui/x-data-grid';
import { useSearchParams } from 'react-router-dom';

import { PageHeader } from '../components/common/PageHeader';
import { DataTable } from '../components/common/DataTable';
import { Mono } from '../components/common/Mono';
import { StatusChip } from '../components/common/StatusChip';
import { dateCol } from '../lib/columns';
import { monoFamily } from '../theme/typography';
import { useServerPagination } from '../lib/hooks/useServerPagination';
import { useDebouncedValue } from '../lib/hooks/useDebouncedValue';
import {
  useAuditQuery,
  actionLabel,
  actionTone,
  prettyMetadata,
  ENTITY_TYPE_AR,
  type AuditLogEntry,
} from '../features/audit/api';

export function AuditLogPage() {
  const [params, setParams] = useSearchParams();
  const { paginationModel, onPaginationModelChange, page, pageSize, reset } = useServerPagination();

  const action = params.get('action') ?? '';
  const entityType = params.get('entityType') ?? '';
  const adminId = params.get('adminId') ?? '';

  const [search, setSearch] = useState(params.get('q') ?? '');
  const debouncedSearch = useDebouncedValue(search, 300);

  const query = useAuditQuery({
    page,
    limit: pageSize,
    action,
    entityType,
    adminId,
    q: debouncedSearch,
  });

  const [detail, setDetail] = useState<AuditLogEntry | null>(null);

  function setParam(key: string, value: string) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (value) p.set(key, value);
        else p.delete(key);
        p.set('page', '1');
        return p;
      },
      { replace: true },
    );
    reset();
  }

  const facets = query.data?.facets;

  const columns = useMemo<GridColDef<AuditLogEntry>[]>(
    () => [
      dateCol<AuditLogEntry>({ field: 'createdAt', headerName: 'التاريخ', width: 160, mode: 'both' }),
      {
        field: 'admin',
        headerName: 'المسؤول',
        width: 220,
        sortable: false,
        align: 'left',
        headerAlign: 'left',
        valueGetter: (_v, row) => row.admin?.email ?? '',
        renderCell: ({ row }) =>
          row.admin ? (
            <Stack gap={0.25} sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {row.admin.name || '—'}
              </Typography>
              <Mono value={row.admin.email} maxChars={24} variant="caption" />
            </Stack>
          ) : (
            // The account is gone; the action still happened.
            <Typography variant="body2" color="text.disabled">
              حساب محذوف
            </Typography>
          ),
      },
      {
        field: 'action',
        headerName: 'الإجراء',
        width: 180,
        align: 'left',
        headerAlign: 'left',
        renderCell: ({ value }) => (
          <StatusChip
            kind="custom"
            value={value as string}
            label={actionLabel(value as string)}
            tone={actionTone(value as string)}
            tooltip={value as string}
          />
        ),
      },
      {
        field: 'entityType',
        headerName: 'العنصر',
        width: 150,
        align: 'left',
        headerAlign: 'left',
        renderCell: ({ row }) => (
          <Stack direction="row" gap={0.5} alignItems="baseline" sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {ENTITY_TYPE_AR[row.entityType] ?? row.entityType}
            </Typography>
            {row.entityId && <Mono value={`#${row.entityId}`} variant="caption" />}
          </Stack>
        ),
      },
      {
        field: 'ip',
        headerName: 'IP',
        width: 130,
        sortable: false,
        align: 'left',
        headerAlign: 'left',
        renderCell: ({ value }) => <Mono value={value as string} maxChars={18} />,
      },
      {
        field: '__metadata',
        headerName: 'التفاصيل',
        width: 90,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        align: 'right',
        headerAlign: 'right',
        renderCell: ({ row }) =>
          row.metadata ? (
            <Tooltip title="عرض البيانات المرسلة">
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  setDetail(row);
                }}
                aria-label="عرض التفاصيل"
              >
                <DataObjectRounded fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : (
            <Typography variant="body2" color="text.disabled">
              —
            </Typography>
          ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="سجل التدقيق"
        description="من فعل ماذا ومتى — يُسجَّل تلقائيًا لكل تعديل ناجح في لوحة التحكم."
        icon={<HistoryRounded />}
      />

      <DataTable<AuditLogEntry>
        rows={query.data?.logs}
        columns={columns}
        query={query}
        paginationModel={paginationModel}
        onPaginationModelChange={onPaginationModelChange}
        rowCount={query.data?.total}
        getRowId={(r) => r.id}
        // No row click: only some rows carry metadata, and a pointer cursor on
        // a row that does nothing is a control that lies.
        toolbar={
          <Stack direction={{ xs: 'column', md: 'row' }} gap={1.5} alignItems={{ md: 'center' }}>
            <TextField
              select
              label="الإجراء"
              value={action}
              onChange={(e) => setParam('action', e.target.value)}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="">كل الإجراءات</MenuItem>
              {(facets?.actions ?? []).map((a) => (
                <MenuItem key={a} value={a}>
                  {actionLabel(a)}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label="العنصر"
              value={entityType}
              onChange={(e) => setParam('entityType', e.target.value)}
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="">كل العناصر</MenuItem>
              {(facets?.entityTypes ?? []).map((t) => (
                <MenuItem key={t} value={t}>
                  {ENTITY_TYPE_AR[t] ?? t}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label="المسؤول"
              value={adminId}
              onChange={(e) => setParam('adminId', e.target.value)}
              sx={{ minWidth: 190 }}
            >
              <MenuItem value="">كل المسؤولين</MenuItem>
              {(facets?.admins ?? []).map((a) => (
                <MenuItem key={a.id} value={a.id}>
                  {a.name || a.email || `#${a.id}`}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setParam('q', e.target.value);
              }}
              placeholder="ابحث بالبريد أو رقم العنصر أو IP…"
              sx={{ minWidth: { md: 240 } }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRounded fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
          </Stack>
        }
        empty={{
          title: 'لا توجد سجلات',
          description:
            action || entityType || adminId || debouncedSearch
              ? 'لا نتائج مطابقة لعوامل التصفية الحالية.'
              : 'ستظهر هنا كل عمليات التعديل التي يقوم بها المسؤولون.',
          icon: <HistoryRounded />,
        }}
      />

      <Dialog open={Boolean(detail)} onClose={() => setDetail(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{detail ? actionLabel(detail.action) : ''}</DialogTitle>
        <DialogContent>
          <Stack gap={2}>
            <Typography variant="caption" color="text.secondary">
              البيانات المرسلة مع الطلب. تُحذف منها كلمات المرور والمفاتيح قبل التخزين.
            </Typography>
            <Box
              sx={{
                backgroundColor: 'surface.sunken',
                borderRadius: 2,
                padding: 2,
                maxHeight: 420,
                overflow: 'auto',
                overscrollBehavior: 'contain',
              }}
            >
              <Box
                component="pre"
                className="ltr-island"
                sx={{
                  margin: 0,
                  fontFamily: monoFamily,
                  fontSize: '0.75rem',
                  lineHeight: 1.6,
                  whiteSpace: 'pre',
                  textAlign: 'start',
                }}
              >
                {prettyMetadata(detail?.metadata ?? null)}
              </Box>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="inherit" onClick={() => setDetail(null)}>
            إغلاق
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
