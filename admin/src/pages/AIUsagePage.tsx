import { Box, Card, CardContent, Grid, Typography, Chip } from '@mui/material';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

// Rough Anthropic Haiku 4.5 pricing (adjust when Anthropic publishes updates):
// input  ~$0.80 / 1M tokens
// output ~$4.00 / 1M tokens
const INPUT_COST_PER_TOKEN = 0.80 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 4.00 / 1_000_000;

export function AIUsagePage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'ai-usage'],
    queryFn: async () => (await api.get('/admin/ai-usage')).data,
  });

  const summary = data?.summary;
  const estInput = (summary?._sum?.inputTokens ?? 0) * INPUT_COST_PER_TOKEN;
  const estOutput = (summary?._sum?.outputTokens ?? 0) * OUTPUT_COST_PER_TOKEN;
  const estTotal = estInput + estOutput;

  const columns: GridColDef[] = [
    { field: 'id', headerName: '#', width: 80 },
    { field: 'createdAt', headerName: 'التاريخ', width: 170, valueFormatter: (v: any) => new Date(v).toLocaleString('ar-EG') },
    { field: 'model', headerName: 'النموذج', width: 200 },
    { field: 'inputTokens', headerName: 'Input', width: 110 },
    { field: 'outputTokens', headerName: 'Output', width: 110 },
    { field: 'latencyMs', headerName: 'زمن (ms)', width: 110 },
    {
      field: 'success',
      headerName: 'حالة',
      width: 100,
      renderCell: ({ value }) => value ? <Chip size="small" color="success" label="ناجح" /> : <Chip size="small" color="error" label="فشل" />,
    },
    { field: 'errorMessage', headerName: 'خطأ', flex: 1 },
  ];

  return (
    <Box>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card><CardContent>
            <Typography variant="caption" color="text.secondary">إجمالي الطلبات (7 أيام)</Typography>
            <Typography variant="h4" sx={{ fontWeight: 800 }}>{summary?._count?._all ?? 0}</Typography>
          </CardContent></Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card><CardContent>
            <Typography variant="caption" color="text.secondary">Input tokens</Typography>
            <Typography variant="h4" sx={{ fontWeight: 800 }}>{(summary?._sum?.inputTokens ?? 0).toLocaleString()}</Typography>
          </CardContent></Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card><CardContent>
            <Typography variant="caption" color="text.secondary">Output tokens</Typography>
            <Typography variant="h4" sx={{ fontWeight: 800 }}>{(summary?._sum?.outputTokens ?? 0).toLocaleString()}</Typography>
          </CardContent></Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card><CardContent>
            <Typography variant="caption" color="text.secondary">التكلفة التقديرية (USD)</Typography>
            <Typography variant="h4" sx={{ fontWeight: 800 }}>${estTotal.toFixed(2)}</Typography>
            <Typography variant="caption" color="text.secondary">in ${estInput.toFixed(3)} · out ${estOutput.toFixed(3)}</Typography>
          </CardContent></Card>
        </Grid>
      </Grid>
      <Card sx={{ p: 2 }}>
        <Box sx={{ height: 520 }}>
          <DataGrid
            rows={data?.logs ?? []}
            columns={columns}
            loading={isLoading}
            getRowId={(r) => r.id}
            disableRowSelectionOnClick
          />
        </Box>
      </Card>
    </Box>
  );
}
