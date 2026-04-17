# Mobile assets

Expo expects the following PNG assets at the paths referenced in `app.json`:

- `icon.png`         — 1024x1024 app icon
- `adaptive-icon.png` — 1024x1024 Android foreground layer
- `splash.png`       — 1242x2436 (or similar) splash image

## Logo source

The authoritative logo is `logo.svg` (vector). Generate the PNG exports from it:

```bash
# Requires rsvg-convert (librsvg) or Inkscape
rsvg-convert logo.svg -w 1024 -h 1024 -o icon.png
rsvg-convert logo.svg -w 1024 -h 1024 -o adaptive-icon.png
rsvg-convert logo.svg -w 1242 -h 2436 -b "#0F5AA8" -o splash.png
```

Until those PNGs exist, `expo start` will warn but still bundle; the in-app
`<Logo />` component renders the SVG directly so the splash screen fallback
is cosmetic only.
