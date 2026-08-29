# Mobile assets

None of these are drawn by hand. They are generated from the brand source art
by `scripts/generate-assets.py`, so the app icon, the launch screen, the
favicon and the store listing are provably the same mark:

```bash
python scripts/generate-assets.py        # icons, splash icon, favicons, lockups
node scripts/render-text-assets.mjs      # anything with ARABIC TEXT in it
```

The split between those two is not stylistic. Pillow on this machine has no
OpenType shaper, so it draws Arabic unjoined and in logical order; anything
carrying Arabic text is rendered in a headless browser instead, which has
HarfBuzz and the real font. `generate-assets.py` deliberately does not write
the text-bearing files, because it used to, and it silently replaced the
correct ones.

| file | size | used by |
| --- | --- | --- |
| `icon.png` | 1024² | `expo.icon` — iOS and the web manifest |
| `adaptive-icon.png` | 1024² | Android launcher foreground layer |
| `monochrome-icon.png` | 1024² | Android themed icons, and the notification icon |
| `splash-icon.png` | 1024² | the launch screen — see below |
| `favicon.png` | 196² | web tab |
| `play-store-icon.png` | 512², opaque | uploaded by hand to the Play Console listing |
| `splash.png` | 1242×2688 | **nothing.** Kept as the brand's full-screen composition |

## The launch screen is an ICON, not a screen

From Android 12 the system owns the splash: it paints a solid background and
centres one drawable on a 288dp canvas, with content expected to stay inside
the middle 192dp. There is no way to show a full-screen design there.

`splash.png` was pointed at that slot for a long time, and the result looked
broken in a way that is hard to name — a 1242×2688 portrait card scaled down to
a third of the canvas width, centred, on an otherwise empty blue screen. It is
kept on disk because it is a good piece of artwork and because Android 11 and
below could still use one, but `app.json` points at `splash-icon.png`: the mark
alone, on a transparent square, sized so it survives a circular mask.

The dp size lives in the `expo-splash-screen` entry in `app.json`
(`imageWidth`), not in the image.

## Source art

`logo.svg` is the OLD InterviewAI mark and is kept only as history — it is not
the Interprova brand and nothing generates from it. The real sources are the
supplied logo exports referenced at the top of `scripts/generate-assets.py`.
