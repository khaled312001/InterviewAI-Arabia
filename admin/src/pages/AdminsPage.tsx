import { useState } from 'react';
import {
  Box, Card, Button, Stack, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, Chip,
} from '@mui/material';
import { Add } from '@mui/icons-material';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function AdminsPage() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'admins'],
    queryFn: async () => (await api.get('/admin/admins')).data,
  });

  const create = useMutation({
    mutationFn: (body: any) => api.post('/admin/admins', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'admins'] });
      setCreating(null);
    },
  });

  const columns: GridColDef[] = [
    { field: 'id', headerName: '#', width: 80 },
    { field: 'email', headerName: 'البريد الإلكتروني', flex: 1 },
    { field: 'name', headerName: 'الاسم', flex: 1 },
    { field: 'role', headerName: 'الصلاحية', width: 160, renderCell: ({ value }) => <Chip size="small" label={value} /> },
    { field: 'isActive', headerName: 'حالة', width: 100, renderCell: ({ value }) => value ? <Chip size="small" color="success" label="نشط" /> : <Chip size="small" label="معطّل" /> },
    { field: 'createdAt', headerName: 'التسجيل', width: 170, valueFormatter: (v: any) => new Date(v).toLocaleString('ar-EG') },
  ];

  return (
    <Card sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <Button variant="contained" startIcon={<Add />} onClick={() => setCreating({ role: 'moderator' })}>
          مدير جديد
        </Button>
      </Stack>
      <Box sx={{ height: 520 }}>
        <DataGrid
          rows={data?.admins ?? []}
          columns={columns}
          loading={isLoading}
          getRowId={(r) => r.id}
          disableRowSelectionOnClick
        />
      </Box>

      <Dialog open={!!creating} onClose={() => setCreating(null)} maxWidth="sm" fullWidth>
        <DialogTitle>مدير جديد</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="البريد الإلكتروني" type="email" value={creating?.email ?? ''}
              onChange={(e) => setCreating({ ...creating, email: e.target.value })} fullWidth required />
            <TextField label="الاسم" value={creating?.name ?? ''}
              onChange={(e) => setCreating({ ...creating, name: e.target.value })} fullWidth required />
            <TextField label="كلمة المرور المبدئية" type="password" value={creating?.password ?? ''}
              onChange={(e) => setCreating({ ...creating, password: e.target.value })} fullWidth required />
            <TextField select label="الصلاحية" value={creating?.role ?? 'moderator'}
              onChange={(e) => setCreating({ ...creating, role: e.target.value })} fullWidth>
              <MenuItem value="super_admin">مدير عام</MenuItem>
              <MenuItem value="moderator">مشرف</MenuItem>
              <MenuItem value="content_editor">محرر محتوى</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreating(null)}>إلغاء</Button>
          <Button variant="contained" onClick={() => create.mutate(creating)} disabled={create.isPending}>إضافة</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
