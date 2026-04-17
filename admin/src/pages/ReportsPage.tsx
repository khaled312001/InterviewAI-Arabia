import { Box, Card, Chip, IconButton, Tooltip } from '@mui/material';
import { Check } from '@mui/icons-material';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function ReportsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'reports'],
    queryFn: async () => (await api.get('/admin/reports')).data,
  });
  const resolve = useMutation({
    mutationFn: (id: string) => api.post(`/admin/reports/${id}/resolve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'reports'] }),
  });

  const columns: GridColDef[] = [
    { field: 'id', headerName: '#', width: 80 },
    { field: 'reason', headerName: 'السبب', flex: 1 },
    { field: 'reporter', headerName: 'المُبلِّغ', width: 220, valueGetter: (_v, row) => row.reporter?.email },
    { field: 'createdAt', headerName: 'التاريخ', width: 170, valueFormatter: (v: any) => new Date(v).toLocaleString('ar-EG') },
    {
      field: 'resolved',
      headerName: 'الحالة',
      width: 110,
      renderCell: ({ value }) => value ? <Chip size="small" color="success" label="مُحلّ" /> : <Chip size="small" color="warning" label="معلّق" />,
    },
    {
      field: 'actions',
      headerName: '',
      width: 90,
      sortable: false,
      renderCell: ({ row }) => !row.resolved ? (
        <Tooltip title="وضع كمحلول">
          <IconButton size="small" onClick={() => resolve.mutate(row.id)}>
            <Check color="success" fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null,
    },
  ];

  return (
    <Card sx={{ p: 2 }}>
      <Box sx={{ height: 640 }}>
        <DataGrid
          rows={data?.reports ?? []}
          columns={columns}
          loading={isLoading}
          getRowId={(r) => r.id}
          disableRowSelectionOnClick
        />
      </Box>
    </Card>
  );
}
