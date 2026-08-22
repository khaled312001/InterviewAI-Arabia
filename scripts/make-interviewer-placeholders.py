#!/usr/bin/env python3
"""
Placeholder portraits for the two interviewer personas.

These exist so the app never ships without a face, and so the *shape* of the
asset (square, 768px, opaque JPEG-quality PNG) is fixed before the real art
arrives. They are meant to be REPLACED by generated photographic portraits —
see brand/INTERVIEWER-PORTRAITS.md for the prompts and the acceptance rules.

Deliberately not a cartoon. The previous avatars were DiceBear "personas"
line art fetched from api.dicebear.com at call time, which had three problems
beyond looking wrong on a video-call stage: it was a third-party request on a
paid screen, it failed closed with no network, and it put a vendor into the
privacy disclosure for nothing. A studio-backdrop silhouette reads as "portrait
pending" rather than "badly drawn person", and it is local.

    python scripts/make-interviewer-placeholders.py
"""

import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "mobile", "assets", "interviewers")
SIZE = 768

# Backdrop tones per persona. Muted on purpose: the stage composites call
# chrome over this, and a saturated field (the old #E85D75 pink) fights the
# white captions layered on top of it.
PERSONAS = {
    "sara":  {"top": (58, 74, 120), "bottom": (24, 32, 58), "figure": (150, 170, 210)},
    "ahmed": {"top": (46, 78, 128), "bottom": (18, 30, 56), "figure": (140, 168, 215)},
}


def gradient(size, top, bottom):
    w, h = size
    img = Image.new("RGB", (1, h))
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        px[0, y] = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return img.resize((w, h), Image.BICUBIC)


def portrait(spec):
    img = gradient((SIZE, SIZE), spec["top"], spec["bottom"]).convert("RGBA")

    # Key light: an off-centre soft glow, so the backdrop is lit rather than flat.
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse(
        [SIZE * 0.10, -SIZE * 0.25, SIZE * 0.95, SIZE * 0.70],
        fill=(255, 255, 255, 46),
    )
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(SIZE * 0.11)))

    # Head and shoulders, drawn on their own layer so the whole figure can be
    # blurred once — a hard-edged silhouette looks like an icon, a soft one
    # looks like a person out of focus.
    fig = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(fig)
    ink = spec["figure"] + (255,)

    head_r = SIZE * 0.155
    head_cx, head_cy = SIZE * 0.5, SIZE * 0.40
    d.ellipse([head_cx - head_r, head_cy - head_r, head_cx + head_r, head_cy + head_r], fill=ink)

    # Shoulders: a wide ellipse clipped by the frame bottom.
    sh_w, sh_h = SIZE * 0.62, SIZE * 0.52
    d.ellipse(
        [head_cx - sh_w / 2, head_cy + head_r * 0.55,
         head_cx + sh_w / 2, head_cy + head_r * 0.55 + sh_h * 2],
        fill=ink,
    )

    img.alpha_composite(fig.filter(ImageFilter.GaussianBlur(SIZE * 0.012)))

    # Vignette, so the tile has a centre when the stage crops it.
    vig = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(vig).ellipse(
        [-SIZE * 0.18, -SIZE * 0.18, SIZE * 1.18, SIZE * 1.18], fill=255
    )
    vig = vig.filter(ImageFilter.GaussianBlur(SIZE * 0.16))
    dark = Image.new("RGBA", (SIZE, SIZE), (6, 12, 28, 255))
    dark.putalpha(Image.eval(vig, lambda v: 255 - v))
    img.alpha_composite(dark)

    return img.convert("RGB")


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, spec in PERSONAS.items():
        path = os.path.join(OUT, f"{name}.png")
        portrait(spec).save(path, optimize=True)
        print(f"  {os.path.relpath(path, ROOT)}  {SIZE}x{SIZE}  {os.path.getsize(path)//1024}KB")


if __name__ == "__main__":
    main()
