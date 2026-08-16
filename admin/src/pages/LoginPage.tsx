/**
 * Admin sign-in.
 *
 * The only screen an unauthenticated visitor ever sees, so it carries the
 * product's identity rather than a bare form: a brand panel on one side, the
 * form on the other, collapsing to form-only below md.
 *
 * Two details are deliberate. The credential fields are forced to LTR while
 * their labels stay RTL — an email or password rendered right-to-left puts the
 * caret and any punctuation in the wrong place. And the theme toggle lives here
 * too, because the shell that normally hosts it has not mounted yet.
 */

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Fade from '@mui/material/Fade';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import { useColorScheme, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import { useNavigate } from 'react-router-dom';

import { api } from '../lib/api';
import { parseApiError } from '../lib/errors';
import { usePrefersReducedMotion } from '../lib/hooks/usePrefersReducedMotion';
import { useAuth, type Admin } from '../store/auth';
import { brand, gold } from '../theme/tokens';
import { motion, motionSafe } from '../theme/motion';

const PANEL_POINTS = [
  'متابعة المستخدمين والجلسات والتقييمات',
  'إدارة الأسئلة والمجالات ومراجعة البلاغات',
  'الاشتراكات والمدفوعات واستهلاك الذكاء الاصطناعي',
];

export function LoginPage() {
  const navigate = useNavigate();
  const login = useAuth((s) => s.login);
  const theme = useTheme();
  const { mode, setMode } = useColorScheme();
  const reduced = usePrefersReducedMotion();
  const wide = useMediaQuery(theme.breakpoints.up('md'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capsLock, setCapsLock] = useState(false);

  const dark = mode === 'dark';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post<{ token: string; admin: Admin }>('/admin/auth/login', {
        email: email.trim(),
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
            ? 'محاولات كثيرة. انتظر دقيقة ثم حاول مرة أخرى.'
            : parsed.status === 403
              ? 'هذا الحساب لا يملك صلاحية الدخول للوحة التحكم'
              : parsed.messageAr,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', lg: '1.05fr 1fr' },
        bgcolor: 'background.default',
      }}
    >
      {/* Brand panel — decorative, so it is dropped rather than stacked on
          small screens where it would push the form below the fold. */}
      {wide && (
        <Box
          aria-hidden
          sx={{
            position: 'relative',
            overflow: 'hidden',
            display: 'grid',
            alignContent: 'center',
            gap: 4,
            p: 8,
            color: '#fff',
            background: `linear-gradient(140deg, ${brand[600]} 0%, ${brand[900]} 100%)`,
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              insetBlockStart: -160,
              insetInlineStart: -120,
              width: 460,
              height: 460,
              borderRadius: '50%',
              background: gold[500],
              opacity: 0.16,
              filter: 'blur(90px)',
            }}
          />
          <Stack gap={1.5} sx={{ position: 'relative' }}>
            <Typography variant="h2" sx={{ fontWeight: 800, letterSpacing: 0 }}>
              ثقتي
            </Typography>
            <Typography sx={{ opacity: 0.85, fontSize: 18 }}>
              لوحة تحكم المشرفين
            </Typography>
          </Stack>

          <Stack gap={2} sx={{ position: 'relative' }}>
            {PANEL_POINTS.map((line, i) => (
              <Fade
                key={line}
                in
                timeout={motionSafe(reduced, motion.duration.enteringScreen)}
                style={{ transitionDelay: `${motionSafe(reduced, 90 * (i + 1))}ms` }}
              >
                <Stack direction="row" gap={1.5} alignItems="center">
                  <Box
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      bgcolor: gold[500],
                      flex: '0 0 auto',
                    }}
                  />
                  <Typography sx={{ opacity: 0.9 }}>{line}</Typography>
                </Stack>
              </Fade>
            ))}
          </Stack>
        </Box>
      )}

      {/* Form side */}
      <Box sx={{ display: 'grid', placeItems: 'center', p: { xs: 3, sm: 5 }, position: 'relative' }}>
        <Tooltip title={dark ? 'الوضع النهاري' : 'الوضع الليلي'}>
          <IconButton
            onClick={() => setMode(dark ? 'light' : 'dark')}
            sx={{ position: 'absolute', insetBlockStart: 16, insetInlineEnd: 16 }}
            aria-label={dark ? 'التبديل للوضع النهاري' : 'التبديل للوضع الليلي'}
          >
            {dark ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
          </IconButton>
        </Tooltip>

        <Paper
          variant="outlined"
          sx={{ width: '100%', maxWidth: 400, p: { xs: 3, sm: 4 }, borderRadius: 3 }}
        >
          <Stack gap={0.5} sx={{ mb: 3 }}>
            {!wide && (
              <Typography variant="h4" sx={{ fontWeight: 800 }}>
                ثقتي
              </Typography>
            )}
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              تسجيل الدخول
            </Typography>
            <Typography variant="body2" color="text.secondary">
              أدخل بيانات حسابك للمتابعة
            </Typography>
          </Stack>

          <form onSubmit={onSubmit} noValidate>
            <Stack gap={2.25}>
              <TextField
                label="البريد الإلكتروني"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="username"
                // Credentials are Latin; rendering them RTL misplaces the caret.
                slotProps={{
                  htmlInput: { dir: 'ltr', inputMode: 'email' },
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <MailOutlineIcon fontSize="small" color="disabled" />
                      </InputAdornment>
                    ),
                  },
                }}
              />

              <TextField
                label="كلمة المرور"
                type={reveal ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={(e) => setCapsLock(e.getModifierState?.('CapsLock') ?? false)}
                onBlur={() => setCapsLock(false)}
                required
                autoComplete="current-password"
                helperText={capsLock ? 'تنبيه: مفتاح Caps Lock مُفعّل' : ' '}
                slotProps={{
                  htmlInput: { dir: 'ltr' },
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <LockOutlinedIcon fontSize="small" color="disabled" />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => setReveal((v) => !v)}
                          edge="end"
                          size="small"
                          tabIndex={-1}
                          aria-label={reveal ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                        >
                          {reveal ? (
                            <VisibilityOffOutlinedIcon fontSize="small" />
                          ) : (
                            <VisibilityOutlinedIcon fontSize="small" />
                          )}
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />

              {error && (
                <Alert severity="error" variant="outlined" role="alert">
                  {error}
                </Alert>
              )}

              <Button
                type="submit"
                size="large"
                variant="contained"
                disabled={loading || !email || !password}
                sx={{ minHeight: 48 }}
              >
                {loading ? <CircularProgress size={22} color="inherit" /> : 'تسجيل الدخول'}
              </Button>
            </Stack>
          </form>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', textAlign: 'center', mt: 3 }}
          >
            تطوير{' '}
            <Box
              component="a"
              href="https://barmagly.tech/"
              target="_blank"
              rel="noopener noreferrer"
              sx={{ color: 'text.secondary', fontWeight: 700 }}
            >
              شركة برمجلي
            </Box>
          </Typography>
        </Paper>
      </Box>
    </Box>
  );
}
