import { useState } from 'react';
import {
  Box, Card, Button, Stack, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, FormControlLabel, Switch, IconButton, Chip,
} from '@mui/material';
import { Add, Edit, Delete, Star } from '@mui/icons-material';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function CategoriesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: async () => (await api.get('/categories')).data,
  });

  const save = useMutation({
    mutationFn: async (body: any) => {
      if (body.id) return api.patch(`/admin/categories/${body.id}`, body);
      return api.post('/admin/categories', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'categories'] });
      setEditing(null);
    },
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/categories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'categories'] }),
  });

  const columns: GridColDef[] = [
    { field: 'id', headerName: '#', width: 70 },
    { field: 'nameAr', headerName: 'الاسم (عربي)', flex: 1 },
    { field: 'nameEn', headerName: 'Name (EN)', flex: 1 },
    { field: 'icon', headerName: 'أيقونة', width: 120 },
    {
      field: 'isPremium',
      headerName: 'مميز',
      width: 100,
      renderCell: ({ value }) => value ? <Chip size="small" color="warning" icon={<Star />} label="نعم" /> : <Chip size="small" label="لا" />,
    },
    { field: 'sortOrder', headerName: 'الترتيب', width: 100 },
    {
      field: 'actions',
      headerName: '',
      width: 110,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row">
          <IconButton size="small" onClick={() => setEditing(row)}><Edit fontSize="small" /></IconButton>
          <IconButton size="small" onClick={() => { if (confirm('حذف؟')) del.mutate(row.id); }}>
            <Delete fontSize="small" color="error" />
          </IconButton>
        </Stack>
      ),
    },
  ];

  return (
    <Card sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <Button variant="contained" startIcon={<Add />} onClick={() => setEditing({ isPremium: false, sortOrder: 100 })}>
          قسم جديد
        </Button>
      </Stack>
      <Box sx={{ height: 560 }}>
        <DataGrid
          rows={data?.categories ?? []}
          columns={columns}
          loading={isLoading}
          getRowId={(r) => r.id}
          disableRowSelectionOnClick
        />
      </Box>

      <Dialog open={!!editing} onClose={() => setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing?.id ? 'تعديل قسم' : 'قسم جديد'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="الاسم (عربي)" value={editing?.nameAr ?? ''}
              onChange={(e) => setEditing({ ...editing, nameAr: e.target.value })} fullWidth />
            <TextField label="Name (English)" value={editing?.nameEn ?? ''}
              onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })} fullWidth />
            <TextField label="أيقونة (Lucide/slug)" value={editing?.icon ?? ''}
              onChange={(e) => setEditing({ ...editing, icon: e.target.value })} fullWidth />
            <TextField label="ترتيب الظهور" type="number" value={editing?.sortOrder ?? 0}
              onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) })} fullWidth />
            <FormControlLabel
              control={<Switch checked={!!editing?.isPremium}
                onChange={(e) => setEditing({ ...editing, isPremium: e.target.checked })} />}
              label="قسم مميز (للمشتركين فقط)"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>إلغاء</Button>
          <Button variant="contained" onClick={() => save.mutate(editing)} disabled={save.isPending}>حفظ</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
