import { createTheme } from '@mui/material/styles';
import { arEG } from '@mui/material/locale';
import { arSD } from '@mui/x-data-grid/locales';
import { buildPalette } from './palette';
import { typography } from './typography';
import { shadows } from './shadows';
import { motion } from './motion';
import { components } from './components';
import { radius } from './tokens';

export const theme = createTheme(
  {
    direction: 'rtl',
    cssVariables: { colorSchemeSelector: 'data' }, // -> [data-mui-color-scheme="dark"]
    colorSchemes: {
      light: { palette: buildPalette('light') },
      dark: { palette: buildPalette('dark') },
    },
    typography,
    shape: { borderRadius: radius.lg },
    spacing: 8,
    shadows,
    transitions: { duration: motion.duration, easing: motion.easing },
    components,
  },
  arEG, // MUI core Arabic (Egypt) — pagination, dialogs, autocomplete
  arSD, // DataGrid Arabic — localizes every grid in one line
);

export * from './tokens';
export { motion, motionSafe, staggerDelay } from './motion';
