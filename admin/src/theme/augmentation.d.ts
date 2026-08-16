import type {} from '@mui/material/styles';

interface SurfaceTokens {
  sunken: string;
  raised: string;
  overlay: string;
}

declare module '@mui/material/styles' {
  // Opts the Theme type into `vars` / `applyStyles`; the theme is created with
  // `cssVariables`, so mode branching must go through applyStyles, never
  // `palette.mode === 'dark' ? a : b` (compiled once, therefore stale).
  interface CssThemeVariables {
    enabled: true;
  }

  interface Palette {
    chart: readonly string[];
    surface: SurfaceTokens;
    brand: Record<number, string>;
    gold: Record<number, string>;
  }
  interface PaletteOptions {
    chart?: readonly string[];
    surface?: SurfaceTokens;
    brand?: Record<number, string>;
    gold?: Record<number, string>;
  }
}

export {};
