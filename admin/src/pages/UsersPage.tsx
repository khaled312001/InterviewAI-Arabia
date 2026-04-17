import { useState } from 'react';
import { Box, Card, TextField, Stack, Chip, IconButton, Tooltip, Button } from '@mui/material';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Block, CheckCircle, Star } from '@mui/icons-material';
import { api } from '../api';

export function UsersPage() {
  const [q, setQ] = useState('');
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', q],
    queryFn: async () => (await api.get('/admin/users', { params: { q, limit: 100 } })).data,
  });

  const patch = useMutation({
    mutationFn: (p: { id: string; body: any }) => api.patch(`/admin/users/${p.id}`, p.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  const columns: GridColDef[] = [
    { field: 'id', headerName: '#', width: 90 },
    { field: 'email', headerName: 'البريد الإلكتروني', flex: 1, minWidth: 200 },
    { field: 'name', headerName: 'الاسم', flex: 1, minWidth: 150 },
    {
      field: 'plan',
      headerName: 'الخطة',
      width: 120,
      renderCell: ({ value }) => (
        <Chip
          size="small"
          label={value === 'premium' ? 'مميز' : 'مجاني'}
          color={value === 'premium' ? 'warning' : 'default'}
          icon={value === 'premium' ? <Star /> : undefined}
        />
      ),
    },
    { field: 'language', headerName: 'اللغة', width: 80 },
    {
      field: 'isDisabled',
      headerName: 'الحالة',
      width: 120,
      renderCell: ({ value }) =>
        value ? <Chip size="small" color="error" label="معطّل" /> : <Chip size="small" color="success" label="نشط" />,
    },
    { field: 'createdAt', headerName: 'التسجيل', width: 170, valueFormatter: (v: any) => new Date(v).toLocaleString('ar-EG') },
    {
      field: 'actions',
      headerName: '',
      width: 140,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5}>
          <Tooltip title={row.plan === 'premium' ? 'خفض لمجاني' : 'ترقية لمميز'}>
            <IconButton
              size="small"
              onClick={() => patch.mutate({ id: row.id, body: { plan: row.plan === 'premium' ? 'free' : 'premium' } })}
            >
              <Star color={row.plan === 'premium' ? 'warning' : 'disabled'} />
            </IconButton>
          </Tooltip>
          <Tooltip title={row.isDisabled ? 'تفعيل' : 'تعطيل'}>
            <IconButton
              size="small"
              onClick={() => patch.mutate({ id: row.id, body: { isDisabled: !row.isDisabled } })}
            >
              {row.isDisabled ? <CheckCircle color="success" /> : <Block color="error" />}
            </IconButton>
          </Tooltip>
        </Stack>
      ),
    },
  ];

  return (
    <Card sx={{ p: 2 }}>
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <TextField
          size="small"
          placeholder="ابحث بالبريد أو الاسم..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          sx={{ minWidth: 300 }}
        />
      </Stack>
      <Box sx={{ height: 640 }}>
        <DataGrid
          rows={data?.users ?? []}
          columns={columns}
          loading={isLoading}
          getRowId={(row) => row.id}
          disableRowSelectionOnClick
          pageSizeOptions={[25, 50, 100]}
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
        />
      </Box>
    </Card>
  );
}
