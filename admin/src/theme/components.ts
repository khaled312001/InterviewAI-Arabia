import type { ThemeOptions } from '@mui/material/styles';
import type {} from '@mui/x-data-grid/themeAugmentation';
import { radius } from './tokens';
import { shadows } from './shadows';
import { fontFamily } from './typography';

const fontUrl = (file: string) => `${import.meta.env.BASE_URL}fonts/${file}`;

// Cairo ships as a variable font (400–800 on one axis) per unicode subset, so
// three files cover every weight the app uses.
const cairoFaces = [
  {
    fontFamily: 'Cairo',
    fontStyle: 'normal',
    fontDisplay: 'swap',
    fontWeight: '400 800',
    src: `url('${fontUrl('cairo-arabic.woff2')}') format('woff2')`,
    unicodeRange:
      'U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC',
  },
  {
    fontFamily: 'Cairo',
    fontStyle: 'normal',
    fontDisplay: 'swap',
    fontWeight: '400 800',
    src: `url('${fontUrl('cairo-latin-ext.woff2')}') format('woff2')`,
    unicodeRange:
      'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  },
  {
    fontFamily: 'Cairo',
    fontStyle: 'normal',
    fontDisplay: 'swap',
    fontWeight: '400 800',
    src: `url('${fontUrl('cairo-latin.woff2')}') format('woff2')`,
    unicodeRange:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  },
];

export const components: ThemeOptions['components'] = {
  MuiCssBaseline: {
    styleOverrides: (t) => ({
      '@font-face': cairoFaces,
      'html, body, #root': { height: '100%' },
      body: {
        backgroundColor: t.vars.palette.background.default,
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
        fontFamily,
      },
      // Latin/numeric runs inside Arabic get scrambled by the bidi algorithm
      // (a trailing '.' or '-' jumps sides). Num/Money/Mono isolate them.
      '.ltr-island': { direction: 'ltr', unicodeBidi: 'isolate', display: 'inline-block' },
      '.tabular': { fontVariantNumeric: 'tabular-nums' },
      '*:focus-visible': {
        outline: `2px solid ${t.vars.palette.primary.main}`,
        outlineOffset: 2,
      },
      '@media (prefers-reduced-motion: reduce)': {
        '*, *::before, *::after': {
          animationDuration: '.01ms !important',
          animationIterationCount: '1 !important',
          transitionDuration: '.01ms !important',
          scrollBehavior: 'auto !important',
        },
      },
      '::-webkit-scrollbar': { width: 10, height: 10 },
      '::-webkit-scrollbar-thumb': { background: t.vars.palette.divider, borderRadius: 8 },
      '::-webkit-scrollbar-track': { background: 'transparent' },
    }),
  },

  MuiButton: {
    defaultProps: { disableElevation: true, variant: 'contained' },
    styleOverrides: {
      root: { borderRadius: radius.md, fontWeight: 600, paddingInline: 16, gap: 8 },
      sizeSmall: { minHeight: 32, paddingInline: 12, fontSize: '0.8125rem' },
      sizeMedium: { minHeight: 38 },
      sizeLarge: { minHeight: 46, fontSize: '0.9375rem' },
      outlined: ({ theme: t }) => ({ borderColor: t.vars.palette.divider }),
      // Icon spacing comes from `gap`; MUI's own startIcon/endIcon margins are
      // physical and would double-flip under stylis-plugin-rtl.
      startIcon: { marginInlineEnd: 0, marginInlineStart: 0, marginRight: 0, marginLeft: 0 },
      endIcon: { marginInlineEnd: 0, marginInlineStart: 0, marginRight: 0, marginLeft: 0 },
    },
  },

  MuiIconButton: { styleOverrides: { root: { borderRadius: radius.md } } },

  MuiPaper: {
    defaultProps: { elevation: 0 },
    styleOverrides: {
      root: { backgroundImage: 'none' },
      rounded: { borderRadius: radius.xl },
      outlined: ({ theme: t }) => ({ borderColor: t.vars.palette.divider }),
    },
  },

  MuiCard: {
    defaultProps: { variant: 'outlined' },
    styleOverrides: {
      root: ({ theme: t }) => ({
        borderRadius: radius.xl,
        overflow: 'hidden',
        backgroundColor: t.vars.palette.surface.raised,
        transition: t.transitions.create(['border-color', 'box-shadow'], {
          duration: t.transitions.duration.shorter,
        }),
      }),
    },
  },
  MuiCardHeader: {
    defaultProps: {
      titleTypographyProps: { variant: 'h6' },
      subheaderTypographyProps: { variant: 'caption', color: 'text.secondary' },
    },
    styleOverrides: { root: { padding: '16px 20px 8px' } },
  },
  MuiCardContent: {
    styleOverrides: { root: { padding: 20, '&:last-child': { paddingBottom: 20 } } },
  },

  MuiDialog: {
    defaultProps: { maxWidth: 'sm', fullWidth: true },
    styleOverrides: { paper: { borderRadius: radius.xxl, boxShadow: shadows[4] } },
  },
  MuiDialogTitle: {
    styleOverrides: { root: { fontSize: '1.125rem', fontWeight: 700, padding: '20px 24px 8px' } },
  },
  MuiDialogContent: { styleOverrides: { root: { padding: '8px 24px' } } },
  MuiDialogActions: { styleOverrides: { root: { padding: '16px 24px 20px', gap: 8 } } },

  MuiTextField: { defaultProps: { size: 'small', variant: 'outlined', fullWidth: true } },
  MuiOutlinedInput: {
    styleOverrides: {
      root: ({ theme: t }) => ({
        borderRadius: radius.md,
        backgroundColor: t.vars.palette.background.paper,
        '& .MuiOutlinedInput-notchedOutline': { borderColor: t.vars.palette.divider },
        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: t.vars.palette.text.disabled },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderWidth: 2 },
      }),
      input: { '&::placeholder': { opacity: 0.6 } },
    },
  },
  MuiFormHelperText: { styleOverrides: { root: { marginInline: 2, marginTop: 6 } } },

  MuiDataGrid: {
    defaultProps: {
      density: 'standard',
      disableRowSelectionOnClick: true,
      disableColumnSelector: true,
      pageSizeOptions: [25, 50, 100],
      rowHeight: 52,
      columnHeaderHeight: 48,
      showCellVerticalBorder: false,
      showColumnVerticalBorder: false,
    },
    styleOverrides: {
      root: ({ theme: t }) => ({
        border: 0,
        borderRadius: radius.xl,
        fontSize: '0.875rem',
        '--DataGrid-rowBorderColor': t.vars.palette.divider,
        '--DataGrid-containerBackground': t.vars.palette.surface.sunken,
        '& .MuiDataGrid-columnHeaders': { fontWeight: 700 },
        '& .MuiDataGrid-columnHeaderTitle': {
          fontWeight: 700,
          fontSize: '0.8125rem',
          color: t.vars.palette.text.secondary,
        },
        '& .MuiDataGrid-cell': { display: 'flex', alignItems: 'center', paddingInline: 16 },
        '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within, & .MuiDataGrid-columnHeader:focus':
          { outline: 'none' },
        '& .MuiDataGrid-row:hover': { backgroundColor: t.vars.palette.action.hover },
        '& .MuiDataGrid-row.Mui-selected': { backgroundColor: t.vars.palette.action.selected },
        '& .MuiDataGrid-footerContainer': {
          borderTop: `1px solid ${t.vars.palette.divider}`,
          minHeight: 52,
        },
        '& .MuiDataGrid-overlayWrapperInner': { display: 'grid', placeItems: 'center' },
      }),
    },
  },

  MuiChip: {
    styleOverrides: {
      root: { borderRadius: radius.sm, fontWeight: 600 },
      sizeSmall: { height: 22, fontSize: '0.6875rem' },
      label: { paddingInline: 8 },
    },
  },
  MuiTooltip: {
    defaultProps: { arrow: true },
    styleOverrides: { tooltip: { fontSize: '0.75rem', borderRadius: radius.sm, padding: '6px 10px' } },
  },
  MuiMenu: {
    defaultProps: { elevation: 3 },
    styleOverrides: { paper: { borderRadius: radius.lg, minWidth: 200 } },
  },
  MuiMenuItem: {
    styleOverrides: { root: { borderRadius: radius.sm, marginInline: 6, gap: 10, minHeight: 40 } },
  },
  // Icon spacing via minWidth, never a margin — margins are physical.
  MuiListItemIcon: { styleOverrides: { root: { minWidth: 36, color: 'inherit' } } },
  MuiListItemButton: {
    styleOverrides: {
      root: ({ theme: t }) => ({
        borderRadius: radius.md,
        marginInline: 8,
        minHeight: 44,
        gap: 4,
        '&.Mui-selected': {
          backgroundColor: t.vars.palette.action.selected,
          fontWeight: 700,
          '& .MuiListItemIcon-root, & .MuiListItemText-primary': {
            color: t.vars.palette.primary.main,
            fontWeight: 700,
          },
          '&:hover': { backgroundColor: t.vars.palette.action.selected },
        },
      }),
    },
  },
  MuiAppBar: {
    defaultProps: { elevation: 0, color: 'inherit', position: 'sticky' },
    styleOverrides: {
      root: ({ theme: t }) => ({
        backgroundColor: `rgba(${t.vars.palette.background.paperChannel} / 0.86)`,
        backdropFilter: 'saturate(180%) blur(8px)',
        borderBottom: `1px solid ${t.vars.palette.divider}`,
      }),
    },
  },
  MuiDrawer: {
    styleOverrides: {
      paper: ({ theme: t }) => ({
        border: 0,
        borderInlineEnd: `1px solid ${t.vars.palette.divider}`,
        backgroundColor: t.vars.palette.background.paper,
      }),
    },
  },
  MuiAlert: {
    defaultProps: { variant: 'standard' },
    styleOverrides: { root: { borderRadius: radius.lg, alignItems: 'center' } },
  },
  MuiSkeleton: { defaultProps: { animation: 'wave' }, styleOverrides: { root: { borderRadius: radius.sm } } },
  MuiLinearProgress: { styleOverrides: { root: { height: 3, borderRadius: 3 } } },
  MuiTabs: {
    styleOverrides: { root: { minHeight: 44 }, indicator: { height: 3, borderRadius: '3px 3px 0 0' } },
  },
  MuiTab: { styleOverrides: { root: { minHeight: 44, fontWeight: 600 } } },
  MuiDivider: { styleOverrides: { root: ({ theme: t }) => ({ borderColor: t.vars.palette.divider }) } },
  MuiSnackbar: { defaultProps: { anchorOrigin: { vertical: 'bottom', horizontal: 'center' } } },
  MuiBackdrop: {
    styleOverrides: { root: ({ theme: t }) => ({ backgroundColor: t.vars.palette.surface.overlay }) },
  },
};
