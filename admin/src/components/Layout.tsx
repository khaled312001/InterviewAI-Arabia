import { useState } from 'react';
import {
  AppBar, Toolbar, Typography, IconButton, Drawer, List, ListItemButton,
  ListItemIcon, ListItemText, Box, Divider, Avatar, Menu, MenuItem, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  Menu as MenuIcon, Dashboard, People, QuestionAnswer, Category, CardMembership,
  Analytics, SmartToy, Flag, Settings, AdminPanelSettings, Logout,
} from '@mui/icons-material';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

const drawerWidth = 240;

const navItems = [
  { path: '/',              label: 'اللوحة الرئيسية',       icon: <Dashboard /> },
  { path: '/users',         label: 'المستخدمون',             icon: <People /> },
  { path: '/questions',     label: 'الأسئلة',                icon: <QuestionAnswer /> },
  { path: '/categories',    label: 'الأقسام',                icon: <Category /> },
  { path: '/subscriptions', label: 'الاشتراكات',             icon: <CardMembership /> },
  { path: '/analytics',     label: 'التحليلات',              icon: <Analytics /> },
  { path: '/ai-usage',      label: 'استخدام الذكاء الصناعي', icon: <SmartToy /> },
  { path: '/reports',       label: 'البلاغات',               icon: <Flag /> },
  { path: '/settings',      label: 'الإعدادات',              icon: <Settings /> },
  { path: '/admins',        label: 'المدراء',                icon: <AdminPanelSettings /> },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { admin, logout } = useAuth();

  const drawer = (
    <Box>
      <Toolbar sx={{ gap: 1 }}>
        <Avatar sx={{ bgcolor: 'primary.main', width: 32, height: 32 }}>IA</Avatar>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, lineHeight: 1 }}>InterviewAI</Typography>
          <Typography variant="caption" color="text.secondary">لوحة التحكم</Typography>
        </Box>
      </Toolbar>
      <Divider />
      <List>
        {navItems.map((item) => (
          <ListItemButton
            key={item.path}
            component={Link}
            to={item.path}
            selected={location.pathname === item.path}
            onClick={() => setMobileOpen(false)}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', direction: 'rtl' }}>
      <AppBar
        position="fixed"
        color="inherit"
        elevation={1}
        sx={{
          width: { md: `calc(100% - ${drawerWidth}px)` },
          mr: { md: `${drawerWidth}px` },
        }}
      >
        <Toolbar>
          <IconButton
            edge="start"
            onClick={() => setMobileOpen(true)}
            sx={{ display: { md: 'none' }, ml: 1 }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>
            {navItems.find((n) => n.path === location.pathname)?.label || 'InterviewAI Arabia'}
          </Typography>
          <IconButton onClick={(e) => setMenuAnchor(e.currentTarget)}>
            <Avatar sx={{ bgcolor: 'secondary.main', width: 32, height: 32 }}>
              {admin?.name?.[0]?.toUpperCase() || 'A'}
            </Avatar>
          </IconButton>
          <Menu
            anchorEl={menuAnchor}
            open={!!menuAnchor}
            onClose={() => setMenuAnchor(null)}
          >
            <MenuItem disabled>{admin?.email}</MenuItem>
            <Divider />
            <MenuItem
              onClick={() => {
                logout();
                navigate('/login');
              }}
            >
              <Logout fontSize="small" sx={{ ml: 1 }} /> تسجيل الخروج
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box
        component="nav"
        sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}
      >
        {isMobile ? (
          <Drawer
            variant="temporary"
            anchor="right"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{ '& .MuiDrawer-paper': { width: drawerWidth } }}
          >
            {drawer}
          </Drawer>
        ) : (
          <Drawer
            variant="permanent"
            anchor="right"
            open
            sx={{ '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box' } }}
          >
            {drawer}
          </Drawer>
        )}
      </Box>

      <Box
        component="main"
        sx={{ flexGrow: 1, p: 3, width: { md: `calc(100% - ${drawerWidth}px)` } }}
      >
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
}
