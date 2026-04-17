import { Card, CardContent, Grid, Typography, Box } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';

const COLORS = ['#0F5AA8', '#F39C12', '#2E7D32', '#C62828', '#6A1B9A', '#00838F', '#4E342E'];

export function AnalyticsPage() {
  const overviewQ = useQuery({ queryKey: ['analytics', 'overview'], queryFn: async () => (await api.get('/admin/analytics/overview')).data });
  const popularQ = useQuery({ queryKey: ['analytics', 'popular'], queryFn: async () => (await api.get('/admin/analytics/popular-categories')).data });

  const pieData = [
    { name: 'مجاني', value: (overviewQ.data?.totalUsers ?? 0) - (overviewQ.data?.premiumUsers ?? 0) },
    { name: 'مميز', value: overviewQ.data?.premiumUsers ?? 0 },
  ];
  const barData = (popularQ.data?.rows ?? []).map((r: any) => ({
    name: r.category?.nameAr ?? '—', جلسات: r.sessions,
  }));

  return (
    <Grid container spacing={2}>
      <Grid item xs={12} md={5}>
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>توزيع الخطط</Typography>
            <Box sx={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={110} label>
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </Box>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={7}>
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>الأقسام الأكثر جلسات</Typography>
            <Box sx={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData}>
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
      </Grid>
    </Grid>
  );
}
