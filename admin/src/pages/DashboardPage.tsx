import { Grid, Card, CardContent, Typography, Stack, CircularProgress, Box } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface Overview {
  totalUsers: number;
  activeToday: number;
  premiumUsers: number;
  newUsers30d: number;
  sessionsToday: number;
  answers30d: number;
  conversionRate: number;
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        <Typography variant="h4" sx={{ fontWeight: 800, mt: 0.5 }}>{value}</Typography>
        {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const overviewQ = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: async () => (await api.get<Overview>('/admin/analytics/overview')).data,
  });
  const popularQ = useQuery({
    queryKey: ['admin', 'popular-categories'],
    queryFn: async () => (await api.get('/admin/analytics/popular-categories')).data,
  });

  if (overviewQ.isLoading) return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>;
  if (overviewQ.error) return <Typography color="error">فشل تحميل البيانات</Typography>;

  const o = overviewQ.data!;
  const chartData = (popularQ.data?.rows ?? []).map((r: any) => ({
    name: r.category?.nameAr ?? `#${r.category?.id}`,
    جلسات: r.sessions,
  }));

  return (
    <Stack spacing={3}>
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}><Stat label="إجمالي المستخدمين" value={o.totalUsers} /></Grid>
        <Grid item xs={12} sm={6} md={3}><Stat label="نشطون اليوم" value={o.activeToday} /></Grid>
        <Grid item xs={12} sm={6} md={3}><Stat label="المشتركون المميزون" value={o.premiumUsers} hint={`نسبة التحويل ${(o.conversionRate * 100).toFixed(1)}%`} /></Grid>
        <Grid item xs={12} sm={6} md={3}><Stat label="مستخدمون جدد (30 يومًا)" value={o.newUsers30d} /></Grid>
        <Grid item xs={12} sm={6} md={3}><Stat label="جلسات اليوم" value={o.sessionsToday} /></Grid>
        <Grid item xs={12} sm={6} md={3}><Stat label="إجابات آخر 30 يومًا" value={o.answers30d} /></Grid>
      </Grid>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>الأقسام الأكثر شعبية</Typography>
          <Box sx={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="جلسات" fill="#0F5AA8" />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </CardContent>
      </Card>
    </Stack>
  );
}
