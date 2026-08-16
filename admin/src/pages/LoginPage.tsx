import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { parseApiError } from '../lib/errors';
import { useAuth, type Admin } from '../store/auth';
import { brand } from '../theme/tokens';

export function LoginPage() {
  const navigate = useNavigate();
  const login = useAuth((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capsLock, setCapsLock] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post<{ token: string; admin: Admin }>('/admin/auth/login', {
        email,
        password,
      });
      login(data.token, data.admin);
      navigate('/');
    } catch (err) {
      const parsed = parseApiError(err);
      setError(
        parsed.status === 401
          ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
          : parsed.status === 429
            ? 'محاولات كثيرة، حاول بعد قليل'
            : parsed.messageAr,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        paddingInline: 2,
        background: `linear-gradient(135deg, ${brand[500]} 0%, ${brand[900]} 100%)`,
      }}
    >
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent sx={{ p: 4 }}>
          <Stack gap={1} sx={{ mb: 3, textAlign: 'center' }}>
            <Typography variant="h3">ثقتي</Typography>
            <Typography variant="body2" color="text.secondary">
              لوحة تحكم المشرفين
            </Typography>
          </Stack>

          <form onSubmit={onSubmit}>
            <Stack gap={2}>
              <TextField
                label="البريد الإلكتروني"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="username"
                inputProps={{ dir: 'ltr' }}
              />
              <TextField
                label="كلمة المرور"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={(e) => setCapsLock(e.getModifierState?.('CapsLock') ?? false)}
                required
                autoComplete="current-password"
                inputProps={{ dir: 'ltr' }}
                helperText={capsLock ? 'تنبيه: مفتاح Caps Lock مُفعّل' : undefined}
              />
              {error && <Alert severity="error">{error}</Alert>}
              <Button type="submit" size="large" disabled={loading} sx={{ minWidth: 120 }}>
                {loading ? <CircularProgress size={22} color="inherit" /> : 'تسجيل الدخول'}
              </Button>
            </Stack>
          </form>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', textAlign: 'center', mt: 3 }}
          >
            شركة برمجلي — barmagly.tech
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
