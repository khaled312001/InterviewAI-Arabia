import { useState } from 'react';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddRounded from '@mui/icons-material/AddRounded';
import AdminPanelSettingsRounded from '@mui/icons-material/AdminPanelSettingsRounded';
import BlockRounded from '@mui/icons-material/BlockRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlined from '@mui/icons-material/EditOutlined';
import type { GridColDef } from '@mui/x-data-grid';

import { useConfirm } from '../components/common/ConfirmDialog';
import { DataTable } from '../components/common/DataTable';
import { Mono } from '../components/common/Mono';
import { Num } from '../components/common/Num';
import { PageHeader } from '../components/common/PageHeader';
import { StatusChip } from '../components/common/StatusChip';
import { actionsCol, chipCol, dateCol, textCol } from '../lib/columns';
import { useServerPagination } from '../lib/hooks/useServerPagination';
import { useAuth } from '../store/auth';
import { AdminFormDrawer } from '../features/admins/AdminFormDrawer';
import { useAdmins, useDeleteAdmin, useSetAdminActive, type AdminAccount } from '../features/admins/api';

export function AdminsPage() {
  const currentAdmin = useAuth((s) => s.admin);
  const confirm = useConfirm();
  const setActive = useSetAdminActive();
  const deleteAdmin = useDeleteAdmin();

  const { paginationModel, onPaginationModelChange, page, pageSize } = useServerPagination();
  const query = useAdmins({ page, limit: pageSize });

  // The row survives the close transition; `drawerOpen` alone drives visibility,
  // so an edit drawer does not turn into "مدير جديد" while it slides away.
  const [editing, setEditing] = useState<AdminAccount | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openCreate() {
    setEditing(null);
    setDrawerOpen(true);
  }

  function openEdit(row: AdminAccount) {
    setEditing(row);
    setDrawerOpen(true);
  }

  const isSelf = (row: AdminAccount) => row.id === currentAdmin?.id;

  function toggleActive(row: AdminAccount) {
    return confirm({
      title: row.isActive ? 'تعطيل هذا المدير؟' : 'إعادة تفعيل هذا المدير؟',
      description: <Mono value={row.email} />,
      confirmLabel: row.isActive ? 'تعطيل' : 'تفعيل',
      tone: row.isActive ? 'danger' : 'default',
      consequences: row.isActive
        ? [
            'سيُرفض تسجيل دخوله فورًا',
            'أي جلسة مفتوحة له تتوقف عن العمل مع أول طلب',
            'يبقى سجل إجراءاته في سجل التدقيق كما هو',
          ]
        : ['سيتمكن من تسجيل الدخول مرة أخرى بنفس الصلاحية'],
      onConfirm: () => setActive.mutateAsync({ id: row.id, isActive: !row.isActive }),
    });
  }

  function removeAdmin(row: AdminAccount) {
    return confirm({
      title: 'حذف حساب المدير نهائيًا؟',
      description: <Mono value={row.email} />,
      confirmLabel: 'حذف نهائي',
      tone: 'danger',
      consequences: [
        'حذف نهائي لا يمكن التراجع عنه',
        'إن كان لهذا الحساب أي صفوف في سجل التدقيق فسيرفض الخادم الحذف — لأن حذفه يمحو أثر ما قام به',
        'التعطيل هو الإجراء المطلوب غالبًا: يمنع الدخول فورًا ويُبقي السجل باسمه',
      ],
      requireTypedConfirmation: row.email,
      onConfirm: () => deleteAdmin.mutateAsync(row.id),
    });
  }

  const columns: GridColDef<AdminAccount>[] = [
    textCol<AdminAccount>({ field: 'id', headerName: '#', width: 80, mono: true }),
    textCol<AdminAccount>({ field: 'email', headerName: 'البريد الإلكتروني', flex: 1, minWidth: 220, mono: true, copyable: true }),
    textCol<AdminAccount>({ field: 'name', headerName: 'الاسم', flex: 1, minWidth: 150 }),
    chipCol<AdminAccount>({ field: 'role', headerName: 'الصلاحية', width: 140, kind: 'role' }),
    chipCol<AdminAccount>({
      field: 'isActive',
      headerName: 'الحالة',
      width: 110,
      kind: 'active',
      getValue: (row) => row.isActive,
    }),
    dateCol<AdminAccount>({ field: 'lastLoginAt', headerName: 'آخر دخول', width: 160 }),
    dateCol<AdminAccount>({ field: 'createdAt', headerName: 'أُنشئ', width: 150 }),
    actionsCol<AdminAccount>({
      width: 160,
      render: (row) => (
        <>
          <Tooltip title="تعديل">
            <IconButton size="small" aria-label="تعديل" onClick={() => openEdit(row)}>
              <EditOutlined fontSize="small" />
            </IconButton>
          </Tooltip>

          {/* An admin cannot deactivate or delete itself — the backend refuses
              it too, so the control is hidden rather than left to fail. */}
          {!isSelf(row) && (
            <Tooltip title={row.isActive ? 'تعطيل' : 'تفعيل'}>
              <IconButton
                size="small"
                aria-label={row.isActive ? 'تعطيل' : 'تفعيل'}
                color={row.isActive ? 'default' : 'success'}
                onClick={() => void toggleActive(row)}
              >
                {row.isActive ? <BlockRounded fontSize="small" /> : <CheckCircleRounded fontSize="small" />}
              </IconButton>
            </Tooltip>
          )}

          {!isSelf(row) && (
            <Tooltip title="حذف نهائي">
              <IconButton size="small" color="error" aria-label="حذف نهائي" onClick={() => void removeAdmin(row)}>
                <DeleteOutlineRounded fontSize="small" />
              </IconButton>
            </Tooltip>
          )}

          {isSelf(row) && <StatusChip kind="custom" value="self" label="أنت" tone="brand" />}
        </>
      ),
    }),
  ];

  return (
    <>
      <PageHeader
        title="المدراء"
        description="من يدخل لوحة التحكم، وبأي صلاحية. كل تغيير هنا يُسجَّل في سجل التدقيق."
        icon={<AdminPanelSettingsRounded />}
        meta={
          query.data ? (
            <Typography variant="caption" color="text.secondary">
              إجمالي: <Num value={query.data.total} variant="caption" />
            </Typography>
          ) : undefined
        }
        actions={
          <Button startIcon={<AddRounded />} onClick={openCreate}>
            مدير جديد
          </Button>
        }
      />

      <DataTable<AdminAccount>
        rows={query.data?.admins}
        columns={columns}
        query={query}
        paginationModel={paginationModel}
        onPaginationModelChange={onPaginationModelChange}
        rowCount={query.data?.total}
        empty={{
          title: 'لا يوجد مدراء',
          description: 'أضف أول حساب إدارة للوصول إلى اللوحة.',
          action: (
            <Button startIcon={<AddRounded />} onClick={openCreate}>
              مدير جديد
            </Button>
          ),
        }}
      />

      <Stack>
        <Typography variant="caption" color="text.secondary">
          لا يمكن خفض أو تعطيل أو حذف آخر مدير عام نشط — هذا ما يمنع إقفال اللوحة على الجميع.
        </Typography>
      </Stack>

      <AdminFormDrawer
        open={drawerOpen}
        admin={editing}
        currentAdminId={currentAdmin?.id}
        onClose={() => setDrawerOpen(false)}
      />
    </>
  );
}
