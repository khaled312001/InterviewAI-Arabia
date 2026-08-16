import React from 'react';
import ReactDOM from 'react-dom/client';
import { CacheProvider } from '@emotion/react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ConfirmProvider } from './components/common/ConfirmDialog';
import { ToastProvider } from './components/common/ToastProvider';
import { queryClient } from './lib/queryClient';
import { theme } from './theme';
import { cacheRtl } from './theme/rtlCache';

// CacheProvider must be an ancestor of ThemeProvider so CssBaseline's own
// emitted styles pass through the RTL plugin too. ThemeProvider auto-delegates
// to CssVarsProvider because the theme declares colorSchemes.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CacheProvider value={cacheRtl}>
      <ThemeProvider theme={theme} defaultMode="system">
        <CssBaseline enableColorScheme />
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <ConfirmProvider>
              <BrowserRouter basename="/admin">
                <App />
              </BrowserRouter>
            </ConfirmProvider>
          </ToastProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </CacheProvider>
  </React.StrictMode>,
);
