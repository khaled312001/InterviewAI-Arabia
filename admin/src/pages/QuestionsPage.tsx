import { useState } from 'react';
import {
  Box, Card, Button, Stack, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, IconButton, Chip,
} from '@mui/material';
import { Add, Edit, Delete, Upload } from '@mui/icons-material';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

interface Q {
  id: string;
  categoryId: number;
  questionAr: string;
  questionEn: string;
  difficulty: 'easy' | 'medium' | 'hard';
  isActive: boolean;
  category?: { id: number; nameAr: string };
}

export function QuestionsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<Q> | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');

  const questionsQ = useQuery({
    queryKey: ['admin', 'questions'],
    queryFn: async () => (await api.get('/admin/questions', { params: { limit: 100 } })).data,
  });
  const categoriesQ = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: async () => (await api.get('/categories')).data,
  });

  const save = useMutation({
    mutationFn: async (body: any) => {
      if (body.id) return api.patch(`/admin/questions/${body.id}`, body);
      return api.post('/admin/questions', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'questions'] });
      setEditing(null);
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/questions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'questions'] }),
  });

  const bulk = useMutation({
    mutationFn: (payload: any) => api.post('/admin/questions/bulk', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'questions'] });
      setImportOpen(false);
      setImportText('');
    },
  });

  const columns: GridColDef[] = [
    { field: 'id', headerName: '#', width: 80 },
    {
      field: 'category',
      headerName: 'القسم',
      width: 140,
      valueGetter: (_v, row) => row.category?.nameAr ?? '',
    },
    { field: 'questionAr', headerName: 'السؤال (عربي)', flex: 1, minWidth: 280 },
    { field: 'questionEn', headerName: 'English', flex: 1, minWidth: 260 },
    {
      field: 'difficulty',
      headerName: 'الصعوبة',
      width: 110,
      renderCell: ({ value }) => <Chip size="small" label={value} />,
    },
    {
      field: 'isActive',
      headerName: 'مفعّل',
      width: 100,
      renderCell: ({ value }) => (value ? <Chip size="small" color="success" label="نعم" /> : <Chip size="small" label="لا" />),
    },
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
        <Button variant="contained" startIcon={<Add />} onClick={() => setEditing({ difficulty: 'medium', isActive: true })}>
          سؤال جديد
        </Button>
        <Button variant="outlined" startIcon={<Upload />} onClick={() => setImportOpen(true)}>
          استيراد مجمّع
        </Button>
      </Stack>
      <Box sx={{ height: 640 }}>
        <DataGrid
          rows={questionsQ.data?.questions ?? []}
          columns={columns}
          loading={questionsQ.isLoading}
          getRowId={(r) => r.id}
          disableRowSelectionOnClick
          pageSizeOptions={[25, 50, 100]}
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
        />
      </Box>

      <Dialog open={!!editing} onClose={() => setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing?.id ? 'تعديل سؤال' : 'سؤال جديد'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select label="القسم" value={editing?.categoryId ?? ''}
              onChange={(e) => setEditing({ ...editing!, categoryId: Number(e.target.value) })}
              fullWidth required
            >
              {(categoriesQ.data?.categories ?? []).map((c: any) => (
                <MenuItem key={c.id} value={c.id}>{c.nameAr}</MenuItem>
              ))}
            </TextField>
            <TextField label="السؤال (عربي)" value={editing?.questionAr ?? ''}
              onChange={(e) => setEditing({ ...editing!, questionAr: e.target.value })} multiline rows={2} fullWidth />
            <TextField label="Question (English)" value={editing?.questionEn ?? ''}
              onChange={(e) => setEditing({ ...editing!, questionEn: e.target.value })} multiline rows={2} fullWidth />
            <TextField select label="الصعوبة" value={editing?.difficulty ?? 'medium'}
              onChange={(e) => setEditing({ ...editing!, difficulty: e.target.value as any })} fullWidth>
              <MenuItem value="easy">سهل</MenuItem>
              <MenuItem value="medium">متوسط</MenuItem>
              <MenuItem value="hard">صعب</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>إلغاء</Button>
          <Button variant="contained" onClick={() => save.mutate(editing)} disabled={save.isPending}>حفظ</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={importOpen} onClose={() => setImportOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>استيراد مجمّع (JSON)</DialogTitle>
        <DialogContent>
          <TextField
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            multiline rows={14} fullWidth
            placeholder='{"questions": [{"categoryId": 1, "questionAr": "...", "questionEn": "...", "difficulty": "medium"}]}'
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImportOpen(false)}>إلغاء</Button>
          <Button
            variant="contained"
            onClick={() => {
              try { bulk.mutate(JSON.parse(importText)); }
              catch { alert('JSON غير صحيح'); }
            }}
            disabled={bulk.isPending}
          >
            استيراد
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
