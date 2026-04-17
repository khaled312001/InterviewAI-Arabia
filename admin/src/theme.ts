import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  direction: 'rtl',
  palette: {
    mode: 'light',
    primary: { main: '#0F5AA8', dark: '#0A3F75', light: '#3679C6' },
    secondary: { main: '#F39C12' },
    background: { default: '#F4F6FA', paper: '#FFFFFF' },
    success: { main: '#2E7D32' },
    error:   { main: '#C62828' },
    warning: { main: '#ED6C02' },
  },
  typography: {
    fontFamily: ['Cairo', 'IBM Plex Sans Arabic', 'Segoe UI', 'system-ui', 'sans-serif'].join(','),
    h1: { fontWeight: 800 }, h2: { fontWeight: 700 }, h3: { fontWeight: 700 },
    h4: { fontWeight: 700 }, h5: { fontWeight: 700 }, h6: { fontWeight: 700 },
    button: { fontWeight: 600, textTransform: 'none' },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: { styleOverrides: { root: { borderRadius: 10 } } },
    MuiCard:   { styleOverrides: { root: { borderRadius: 14 } } },
    MuiPaper:  { styleOverrides: { rounded: { borderRadius: 14 } } },
  },
});
