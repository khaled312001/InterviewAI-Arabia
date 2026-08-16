#!/usr/bin/env python3
"""
Generate every raster brand asset for Thiqty (ثقتي) from the supplied logo art.

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

# Source art
SRC_ICON = os.path.join(LOGO, "2889bf33-9e42-4545-8cb5-f677b94855d6.png")  # icon, white mark on blue
SRC_MARK = os.path.join(LOGO, "f2286abe-97a7-4f18-8d1b-ca60a395cabb.png")  # mark only, blue on white
SRC_STACK = os.path.join(LOGO, "1405c6e7-f287-4e07-9a9c-924438d55c12.png")  # stacked lockup
SRC_HORIZ = os.path.join(LOGO, "ed93488b-5479-4ce0-a8df-2a5809db7ce4.png")  # horizontal lockup

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


def whites_to_alpha(img, tol=245):
    """Make the near-white background transparent, keeping the coloured mark."""
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r >= tol and g >= tol and b >= tol:
                px[x, y] = (r, g, b, 0)
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
        for raw, font, dy, alpha in (("ثقتي", f_ar, 0.10, 255), ("Thiqty", f_la, 0.175, 200)):
            text = ar(raw)
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
        for i, raw in enumerate(("ثقتي — أول مدرّب مقابلات", "عربي بالذكاء الاصطناعي")):
            line = ar(raw)
            bb = d.textbbox((0, 0), line, font=f_big)
            d.text((right - (bb[2] - bb[0]), 200 + i * 92), line, font=f_big, fill=WHITE)
        sub = ar("تدرّب · اتقيّم · اتوظّف")
        bb = d.textbbox((0, 0), sub, font=f_sm)
        d.text((right - (bb[2] - bb[0]), 400), sub, font=f_sm, fill=(191, 215, 254, 255))
    except OSError:
        pass
    return img


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

    print("store-assets:")
    save(make_og(1024, 500), os.path.join(STORE, "feature-graphic.png"))
    save(fit(whites_to_alpha(trim_white(load(SRC_STACK))), 1024), os.path.join(STORE, "logo-stacked.png"))

    print("done")


if __name__ == "__main__":
    main()
