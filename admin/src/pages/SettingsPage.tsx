import { useEffect, useState } from 'react';
import { Card, CardContent, Stack, TextField, Button, Typography, Alert } from '@mui/material';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../api';

const LABELS: Record<string, string> = {
  free_daily_question_limit: 'الحد اليومي المجاني (عدد الأسئلة)',
  subscription_monthly_price_egp: 'سعر الاشتراك الشهري (EGP)',
  subscription_yearly_price_egp: 'سعر الاشتراك السنوي (EGP)',
  push_welcome_ar: 'رسالة ترحيب (عربي)',
  push_welcome_en: 'Welcome push (English)',
};

export function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const { data } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: async () => (await api.get('/admin/settings')).data,
  });

  useEffect(() => {
    if (data?.settings) setValues(data.settings);
  }, [data]);

  const save = useMutation({
    mutationFn: () => api.put('/admin/settings', values),
    onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2500); },
  });

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>إعدادات التطبيق</Typography>
        {saved && <Alert severity="success" sx={{ mb: 2 }}>تم الحفظ</Alert>}
        <Stack spacing={2}>
          {Object.keys(values).length === 0 && <Typography>جاري التحميل...</Typography>}
          {Object.entries(values).map(([key, value]) => (
            <TextField
              key={key}
              label={LABELS[key] ?? key}
              value={value}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
              fullWidth
              multiline={key.startsWith('push_')}
            />
          ))}
          <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending}>
            حفظ الإعدادات
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
