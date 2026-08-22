#!/usr/bin/env python3
"""
Generate every raster brand asset for Interprova from the supplied logo art.

Source of truth is `logo/` — the designed PNGs — rather than shapes drawn in
code, so the app icon, splash, favicon and social card are the *same* mark the
brand uses everywhere. Re-run after any logo change:

    python scripts/generate-assets.py

Requires Pillow and mobile/assets/fonts/Cairo-Bold.ttf.
"""

import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# Pillow draws raw codepoints left-to-right using each glyph's ISOLATED form,
# so Arabic came out both disconnected and mirrored — "ثقتي" rendered as
# "يتقث". Correct rendering needs two passes Pillow does not do: contextual
# shaping (initial/medial/final forms) and the Unicode bidi algorithm.
import arabic_reshaper
from bidi.algorithm import get_display


def ar(text):
    """Shape + reorder Arabic so Pillow renders it correctly."""
    return get_display(arabic_reshaper.reshape(text))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO = os.path.join(ROOT, "logo")
ASSETS = os.path.join(ROOT, "mobile", "assets")
LANDING = os.path.join(ROOT, "landing")
STORE = os.path.join(ROOT, "store-assets")
FONT_BOLD = os.path.join(ASSETS, "fonts", "Cairo-Bold.ttf")

# Source art — the Interprova set: two overlapping speech bubbles, the back one
# a gold outline (the rehearsal), the front one solid blue (the real interview).
SRC_ICON = os.path.join(LOGO, "95638c0f-2714-4c67-928c-8aa920c41b00.png")   # app icon, white mark on blue
SRC_MARK = os.path.join(LOGO, "4349a99f-df1a-4177-93a7-b561d6ba2e9d.png")   # mark only, on near-white
SRC_HORIZ = os.path.join(LOGO, "a5d70e5d-d6f5-4261-bb2d-51dea8fcac0c.png")  # horizontal lockup
# There is no stacked lockup in the supplied set, so it is composed from the
# horizontal one: see make_stacked().
SRC_STACK = SRC_HORIZ

# Brand colours sampled from the artwork itself.
BRAND_DEEP = (7, 54, 168)     # #0736A8 wordmark / bubble outline
BRAND_MID = (45, 115, 253)    # #2D73FD icon background, first bar
GOLD = (254, 175, 4)          # #FEAF04 tallest bar
NAVY = (10, 26, 74)
WHITE = (255, 255, 255)


def load(path):
    return Image.open(path).convert("RGBA")


def trim_white(img, tol=248):
    """
    Crop the flat near-white margin the exported art carries.

    Uses a luminance threshold rather than `getbbox()` on alpha, because these
    PNGs are opaque — every pixel has alpha 255, so `getbbox()` would return
    the whole canvas and the mark would stay swimming in whitespace.
    """
    rgb = img.convert("RGB")
    w, h = rgb.size
    px = rgb.load()

    def row_is_blank(y):
        return all(min(px[x, y]) >= tol for x in range(0, w, max(1, w // 220)))

    def col_is_blank(x):
        return all(min(px[x, y]) >= tol for y in range(0, h, max(1, h // 220)))

    top = 0
    while top < h - 1 and row_is_blank(top):
        top += 1
    bottom = h - 1
    while bottom > top and row_is_blank(bottom):
        bottom -= 1
    left = 0
    while left < w - 1 and col_is_blank(left):
        left += 1
    right = w - 1
    while right > left and col_is_blank(right):
        right -= 1

    return img.crop((left, top, right + 1, bottom + 1))


def whites_to_alpha(img, keep_below=214, drop_above=240):
    """
    Knock out the flat background, keeping the coloured mark.

    A hard threshold is not enough here. The supplied art sits on a very light
    grey (#F5F7FB) that carries a faint texture, so a single cutoff either left
    a field of speckles behind the mark — visible as a noisy square once the
    result was recoloured white for the feature graphic — or ate the mark's
    antialiased edges and left it jagged.

    So: a RAMP on the pixel's own brightness. Fully opaque below `keep_below`,
    fully clear above `drop_above`, linear between. The band spans the mark's
    edge pixels, which is exactly where partial alpha belongs, and the textured
    background is comfortably above it.
    """
    img = img.convert("RGBA")
    grey = img.convert("L")
    span = max(1, drop_above - keep_below)
    alpha = grey.point(lambda v: 255 if v <= keep_below
                       else (0 if v >= drop_above
                             else int(255 * (drop_above - v) / span)))
    img.putalpha(alpha)
    return img


def mark_on_dark(img):
    """
    The mark as it must appear on the brand blue.

    Flattening the whole thing to white — which is what `filter: brightness(0)
    invert(1)` in the CSS renderer did — merges the two bubbles into one blob
    and throws away the idea the mark is *about*: the gold outline behind is
    the rehearsal, the solid one in front is the real interview. So only the
    blue is recoloured, and the gold is left alone.

    "Blue" is decided by channel order rather than a hex distance, because the
    front bubble is a gradient from #2D73FD to #0736A8 and no single colour
    matches it.
    """
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a and b > r + 24 and b > g + 12:
                px[x, y] = (255, 255, 255, a)
    return img


def fit(img, box, pad=0.0):
    """Scale `img` to fit inside a square `box`, preserving aspect ratio."""
    target = int(box * (1 - pad))
    w, h = img.size
    scale = min(target / w, target / h)
    return img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)


def centre_on(canvas, img, dy=0):
    x = (canvas.width - img.width) // 2
    y = (canvas.height - img.height) // 2 + dy
    canvas.alpha_composite(img, (x, y))
    return canvas


def vertical_gradient(size, top, bottom):
    w, h = size
    strip = Image.new("RGB", (1, h))
    px = strip.load()
    for y in range(h):
        t = y / max(1, h - 1)
        px[0, y] = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return strip.resize((w, h), Image.BICUBIC)


def diagonal_gradient(size, c1, c2):
    w, h = size
    big = int((w ** 2 + h ** 2) ** 0.5) + 2
    g = vertical_gradient((big, big), c1, c2).rotate(-45, resample=Image.BICUBIC)
    left, top = (big - w) // 2, (big - h) // 2
    return g.crop((left, top, left + w, top + h))


def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([(0, 0), (size[0] - 1, size[1] - 1)], radius=radius, fill=255)
    return m


# ---------------------------------------------------------------- outputs

def make_icon(size=1024, squircle=True):
    """
    Square app icon: the designed icon art, re-rendered crisply at `size`.

    The source art draws a rounded square on a white page, so the four corners
    arrive opaque white. Launchers that do not mask the icon would render those
    corners as visible white notches, so they are cut to transparent here.
    """
    art = trim_white(load(SRC_ICON)).resize((size, size), Image.LANCZOS)
    if squircle:
        art.putalpha(rounded_mask((size, size), int(size * 0.235)))
    return art


def make_adaptive_foreground(size=1024):
    """
    Android adaptive icon foreground.

    Android masks these to arbitrary shapes and only guarantees the centre 66%
    is visible, so the mark is drawn small on a transparent field — otherwise
    a circular mask would clip the speech-bubble tail.
    """
    mark = whites_to_alpha(trim_white(load(SRC_MARK)))
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    return centre_on(canvas, fit(mark, size * 0.52))


def make_monochrome_foreground(size=1024):
    """Android 13+ themed icon — a single-colour silhouette."""
    mark = whites_to_alpha(trim_white(load(SRC_MARK)))
    solid = Image.new("RGBA", mark.size, WHITE + (255,))
    solid.putalpha(mark.getchannel("A"))
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    return centre_on(canvas, fit(solid, size * 0.52))


def make_splash(w=1242, h=2688):
    img = diagonal_gradient((w, h), BRAND_MID, NAVY).convert("RGBA")
    mark = whites_to_alpha(trim_white(load(SRC_MARK)))
    # Recolour the mark to white so it reads on the blue field.
    white_mark = Image.new("RGBA", mark.size, WHITE + (255,))
    white_mark.putalpha(mark.getchannel("A"))
    img = centre_on(img, fit(white_mark, w * 0.42), dy=-int(h * 0.06))

    try:
        d = ImageDraw.Draw(img)
        f_ar = ImageFont.truetype(FONT_BOLD, int(w * 0.105))
        f_la = ImageFont.truetype(FONT_BOLD, int(w * 0.052))
        for raw, font, dy, alpha in (("Interprova", f_ar, 0.10, 255),
                                     ("تدريب مقابلات العمل", f_la, 0.185, 200)):
            text = ar(raw) if any("؀" <= c <= "ۿ" for c in raw) else raw
            bb = d.textbbox((0, 0), text, font=font)
            d.text(((w - (bb[2] - bb[0])) // 2 - bb[0], int(h * (0.5 + dy))),
                   text, font=font, fill=WHITE + (alpha,))
    except OSError:
        pass
    return img


def make_og(w=1200, h=630):
    img = diagonal_gradient((w, h), BRAND_MID, NAVY).convert("RGBA")

    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([(w - 400, -240), (w + 200, 360)], fill=GOLD + (60,))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(95)))

    mark = whites_to_alpha(trim_white(load(SRC_MARK)))
    white_mark = Image.new("RGBA", mark.size, WHITE + (255,))
    white_mark.putalpha(mark.getchannel("A"))
    scaled = fit(white_mark, h * 0.52)
    img.alpha_composite(scaled, (int(w * 0.80) - scaled.width // 2, (h - scaled.height) // 2))

    try:
        d = ImageDraw.Draw(img)
        f_big = ImageFont.truetype(FONT_BOLD, 68)
        f_sm = ImageFont.truetype(FONT_BOLD, 32)
        right = int(w * 0.66)
        for i, raw in enumerate(("Interprova", "تدريب مقابلات العمل بالذكاء الاصطناعي")):
            line = ar(raw) if any("؀" <= c <= "ۿ" for c in raw) else raw
            bb = d.textbbox((0, 0), line, font=f_big)
            d.text((right - (bb[2] - bb[0]), 200 + i * 92), line, font=f_big, fill=WHITE)
        sub = ar("بالعربية والإنجليزية")
        bb = d.textbbox((0, 0), sub, font=f_sm)
        d.text((right - (bb[2] - bb[0]), 400), sub, font=f_sm, fill=(191, 215, 254, 255))
    except OSError:
        pass
    return img


def make_stacked(width=1024):
    """
    A stacked lockup, composed rather than supplied.

    The horizontal art is one flat image, so the two halves are separated by
    finding the widest run of blank columns — the gap the designer left between
    the mark and the wordmark. Splitting on that is stable against the exact
    pixel positions changing in a re-export.
    """
    art = whites_to_alpha(trim_white(load(SRC_HORIZ)))
    alpha = art.getchannel("A")
    w, h = art.size
    cols = [alpha.crop((x, 0, x + 1, h)).getbbox() is None for x in range(w)]

    best = (0, 0)
    run = 0
    for x, blank in enumerate(cols):
        run = run + 1 if blank else 0
        if run > best[1]:
            best = (x - run + 1, run)
    split = best[0] + best[1] // 2 if best[1] else w // 4

    mark = art.crop((0, 0, split, h))
    word = art.crop((split, 0, w, h))
    mark = mark.crop(mark.getbbox())
    word = word.crop(word.getbbox())

    mark = fit(mark, width * 0.42)
    word = fit(word, width * 0.86)
    gap = int(width * 0.07)
    canvas = Image.new("RGBA", (width, mark.height + gap + word.height), (0, 0, 0, 0))
    canvas.alpha_composite(mark, ((width - mark.width) // 2, 0))
    canvas.alpha_composite(word, ((width - word.width) // 2, mark.height + gap))
    return canvas


def save(img, path, **kw):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, **kw)
    print(f"  {os.path.relpath(path, ROOT):<46} {img.size[0]}x{img.size[1]}  {os.path.getsize(path)//1024}KB")


def main():
    missing = [p for p in (SRC_ICON, SRC_MARK, SRC_STACK, SRC_HORIZ) if not os.path.exists(p)]
    if missing:
        raise SystemExit("missing logo source art:\n  " + "\n  ".join(missing))

    print("mobile/assets:")
    save(make_icon(1024), os.path.join(ASSETS, "icon.png"))
    save(make_adaptive_foreground(1024), os.path.join(ASSETS, "adaptive-icon.png"))
    save(make_monochrome_foreground(1024), os.path.join(ASSETS, "monochrome-icon.png"))
    save(make_splash(), os.path.join(ASSETS, "splash.png"))
    save(make_icon(196), os.path.join(ASSETS, "favicon.png"))
    # Play Store listing icon: exactly 512x512, opaque, corners included.
    play = Image.new("RGBA", (512, 512), BRAND_MID + (255,))
    play.alpha_composite(make_icon(512, squircle=False))
    save(play.convert("RGB"), os.path.join(ASSETS, "play-store-icon.png"))

    print("landing:")
    save(make_og(), os.path.join(LANDING, "og-image.png"))
    save(make_icon(180), os.path.join(LANDING, "apple-touch-icon.png"))
    save(make_icon(64), os.path.join(LANDING, "favicon.png"))
    # Wordmark for the landing header, transparent so it sits on any surface.
    save(fit(whites_to_alpha(trim_white(load(SRC_HORIZ))), 640), os.path.join(LANDING, "logo-horizontal.png"))
    save(fit(whites_to_alpha(trim_white(load(SRC_MARK))), 256), os.path.join(LANDING, "logo-mark.png"))
    # The same mark for dark grounds: blue becomes white, gold stays gold.
    save(fit(mark_on_dark(whites_to_alpha(trim_white(load(SRC_MARK)))), 256),
         os.path.join(LANDING, "logo-mark-ondark.png"))

    print("store-assets:")
    save(make_og(1024, 500), os.path.join(STORE, "feature-graphic.png"))
    save(make_stacked(1024), os.path.join(STORE, "logo-stacked.png"))

    print("done")


if __name__ == "__main__":
    main()
