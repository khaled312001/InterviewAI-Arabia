import { Box, Card, Chip, IconButton, Tooltip } from '@mui/material';
import { MoneyOff } from '@mui/icons-material';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function SubscriptionsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'subscriptions'],
    queryFn: async () => (await api.get('/admin/subscriptions')).data,
  });
  const refund = useMutation({
    mutationFn: (id: string) => api.post(`/admin/subscriptions/${id}/refund`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'subscriptions'] }),
  });

  const columns: GridColDef[] = [
    { field: 'id', headerName: '#', width: 80 },
    { field: 'user', headerName: 'المستخدم', flex: 1, valueGetter: (_v, row) => row.user?.email },
    { field: 'productId', headerName: 'المنتج', width: 180 },
    {
      field: 'status',
      headerName: 'الحالة',
      width: 120,
      renderCell: ({ value }) => {
        const color = value === 'active' ? 'success' : value === 'cancelled' ? 'error' : 'default';
        return <Chip size="small" color={color as any} label={value} />;
      },
    },
    { field: 'startedAt', headerName: 'البداية', width: 170, valueFormatter: (v: any) => new Date(v).toLocaleString('ar-EG') },
    { field: 'expiresAt', headerName: 'الانتهاء', width: 170, valueFormatter: (v: any) => new Date(v).toLocaleString('ar-EG') },
    {
      field: 'actions',
      headerName: '',
      width: 100,
      sortable: false,
      renderCell: ({ row }) => row.status === 'active' ? (
        <Tooltip title="إلغاء / استرداد">
          <IconButton size="small" onClick={() => { if (confirm('إلغاء الاشتراك؟')) refund.mutate(row.id); }}>
            <MoneyOff color="error" fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null,
    },
  ];

  return (
    <Card sx={{ p: 2 }}>
      <Box sx={{ height: 640 }}>
        <DataGrid
          rows={data?.subscriptions ?? []}
          columns={columns}
          loading={isLoading}
          getRowId={(r) => r.id}
          disableRowSelectionOnClick
        />
      </Box>
    </Card>
  );
}
