import { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import Divider from '@mui/material/Divider';
import InputBase from '@mui/material/InputBase';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import PersonRounded from '@mui/icons-material/PersonRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { isEnabled } from '../../lib/flags';
import { useDebouncedValue } from '../../lib/hooks/useDebouncedValue';
import { useAuth } from '../../store/auth';
import { useUi } from '../../store/ui';
import { Mono } from '../common/Mono';
import { allNavItems } from './navConfig';
import { findRouteMeta } from './routeMeta';

interface Entry {
  key: string;
  labelAr: string;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  to: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
}

const MIN_QUERY = 2;

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const role = useAuth((s) => s.admin?.role);
  const recentRoutes = useUi((s) => s.recentRoutes);

  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const debounced = useDebouncedValue(q.trim(), 300);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setCursor(0);
    }
  }, [open]);

  const pages = useMemo<Entry[]>(() => {
    const visible = allNavItems.filter(
      (item) => (!item.roles || (role && item.roles.includes(role))) && isEnabled(item.featureFlag),
    );
    if (!debounced) {
      const recent = recentRoutes
        .map((path) => visible.find((item) => item.path === path))
        .filter((item): item is (typeof visible)[number] => Boolean(item));
      const list = recent.length > 0 ? recent : visible;
      return list.slice(0, 6).map((item) => ({
        key: `page:${item.path}`,
        labelAr: item.labelAr,
        icon: item.icon,
        to: item.path,
      }));
    }
    return visible
      .filter((item) => item.labelAr.includes(debounced))
      .slice(0, 6)
      .map((item) => ({ key: `page:${item.path}`, labelAr: item.labelAr, icon: item.icon, to: item.path }));
  }, [debounced, role, recentRoutes]);

  const usersQ = useQuery({
    queryKey: ['admin', 'palette', 'users', debounced],
    queryFn: async () =>
      (await api.get<{ users: UserRow[] }>('/admin/users', { params: { q: debounced, limit: 5 } })).data,
    enabled: open && debounced.length >= MIN_QUERY,
    staleTime: 30_000,
  });

  const users = useMemo<Entry[]>(
    () =>
      (usersQ.data?.users ?? []).slice(0, 5).map((u) => ({
        key: `user:${u.id}`,
        labelAr: u.name || u.email,
        hint: <Mono value={u.email} variant="caption" />,
        icon: <PersonRounded />,
        to: `/users/${u.id}`,
      })),
    [usersQ.data],
  );

  const groups: Array<{ title: string; entries: Entry[] }> = [
    { title: 'الصفحات', entries: pages },
    { title: 'المستخدمون', entries: users },
  ];
  const flat = groups.flatMap((g) => g.entries);

  function go(entry: Entry) {
    navigate(entry.to);
    onClose();
  }

  // Vertical list — arrow keys are deliberately not direction-mirrored.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (flat.length ? (c + 1) % flat.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (flat.length ? (c - 1 + flat.length) % flat.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const entry = flat[cursor];
      if (entry) go(entry);
    }
  }

  let runningIndex = -1;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <Stack direction="row" alignItems="center" gap={1.5} sx={{ p: 2 }}>
        <SearchRounded color="disabled" />
        <InputBase
          autoFocus
          fullWidth
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="ابحث عن صفحة أو مستخدم…"
          sx={{ fontSize: '1rem' }}
        />
        {usersQ.isFetching && <CircularProgress size={16} />}
      </Stack>
      <Divider />

      <Box ref={listRef} sx={{ maxHeight: fullScreen ? '100%' : 420, overflowY: 'auto', pb: 1 }}>
        {groups.map((group) =>
          group.entries.length === 0 ? null : (
            <Box key={group.title}>
              <Typography
                variant="overline"
                color="text.disabled"
                sx={{ display: 'block', paddingInline: 2.5, marginBlock: '12px 4px' }}
              >
                {group.title}
              </Typography>
              <List disablePadding>
                {group.entries.map((entry) => {
                  runningIndex += 1;
                  const selected = runningIndex === cursor;
                  return (
                    <ListItemButton key={entry.key} selected={selected} onClick={() => go(entry)}>
                      {entry.icon && <ListItemIcon>{entry.icon}</ListItemIcon>}
                      <ListItemText
                        primary={entry.labelAr}
                        secondary={entry.hint}
                        primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }}
                      />
                    </ListItemButton>
                  );
                })}
              </List>
            </Box>
          ),
        )}

        {debounced.length >= MIN_QUERY && (
          // Honest about the gap: /admin/questions has no `q` parameter yet, so
          // there is no question search to show rather than a misleading list.
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{ display: 'block', paddingInline: 2.5, paddingBlock: 1.5 }}
          >
            البحث في الأسئلة غير متاح بعد — يحتاج دعمًا من الخادم.
          </Typography>
        )}

        {flat.length === 0 && debounced.length >= MIN_QUERY && !usersQ.isFetching && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
            لا نتائج للبحث «{debounced}»
          </Typography>
        )}
      </Box>
    </Dialog>
  );
}

/** Kept next to the palette so the header and the palette agree on the title. */
export function currentPageTitle(pathname: string): string {
  return findRouteMeta(pathname)?.titleAr ?? 'لوحة التحكم';
}
