"""
Build the two interviewer portraits the call stage renders.

The stage frames them at 4:5 with `resizeMode="cover"` (MeetingScreen.tsx), so
the source must already BE 4:5 — anything else gets centre-cropped by the
renderer and the crop is invisible until it eats someone's chin on a narrow
handset.

The supplied art is a cut-out figure on a flat backdrop, which is the wrong
thing to hand a dark video-call UI: a white rectangle in the seat where a
person should be reads as a broken image. So the backdrop is removed by
flood-filling inward from the corners — NOT by thresholding on brightness,
which would punch holes through a white shirt collar — and the figure is
recomposited over the persona's own colour, the same value
`interviewerPersona.ts` uses for the ring so the two cannot disagree.

    python scripts/make-interviewer-portraits.py
"""
from PIL import Image, ImageDraw, ImageFilter
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'mobile', 'assets', 'interviewers')

W, H = 900, 1125          # 4:5, the ratio the stage frames a person in
FILL_W = 1.02             # max figure width as a fraction of the canvas
HEADROOM = 40             # px of backdrop kept above the hair
BLEED = 36                # px the torso may run past the bottom edge

SUBJECTS = [
    # src, out, ring colour (must match PERSONA[...].color), strip-backdrop
    ('logo/woman.webp', 'sara.png',  '#3A4A78', False),  # already has alpha
    ('logo/man.jpg',    'ahmed.png', '#2E4E80', True),   # flat white backdrop
]


def hex_rgb(value):
    value = value.lstrip('#')
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def strip_backdrop(img):
    """Alpha out the connected background, reached from the corners.

    Flood fill rather than a brightness threshold: the shirt and collar are
    near-white too, and a threshold would make the interviewer's chest
    transparent.
    """
    rgb = img.convert('RGB')
    key = (255, 0, 255)
    w, h = rgb.size
    for corner in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        ImageDraw.floodfill(rgb, corner, key, thresh=60)

    px = rgb.load()
    alpha = Image.new('L', (w, h), 255)
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            if px[x, y] == key:
                ap[x, y] = 0
    # Pull the edge in by a pixel before softening it. The source is anti-aliased
    # against white, so the outermost ring of figure pixels is part backdrop —
    # keeping them leaves a bright fringe that reads as dirt on a dark stage.
    alpha = alpha.filter(ImageFilter.MinFilter(3))
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.8))

    out = img.convert('RGBA')
    out.putalpha(alpha)
    return out


def backdrop(colour):
    """A vertical wash, lighter behind the head, with a soft glow around it."""
    r, g, b = hex_rgb(colour)
    top = (min(255, int(r * 1.30)), min(255, int(g * 1.30)), min(255, int(b * 1.30)))
    bottom = (int(r * 0.44), int(g * 0.44), int(b * 0.50))

    base = Image.new('RGB', (W, H))
    draw = ImageDraw.Draw(base)
    for y in range(H):
        t = y / (H - 1)
        draw.line(
            [(0, y), (W, y)],
            fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)),
        )

    glow = Image.new('L', (W, H), 0)
    gd = ImageDraw.Draw(glow)
    gd.ellipse([W * 0.10, -H * 0.10, W * 0.90, H * 0.62], fill=90)
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    light = Image.new('RGB', (W, H), tuple(min(255, c + 40) for c in top))
    return Image.composite(light, base, glow).convert('RGBA')


def build(src, out_name, colour, needs_strip):
    img = Image.open(os.path.join(ROOT, src))
    img = strip_backdrop(img) if needs_strip else img.convert('RGBA')

    box = img.getbbox()          # tight around the figure, backdrop now alpha 0
    if box:
        img = img.crop(box)

    # Fit, do not fill. Scaling on width alone works for a figure that is wider
    # than it is tall and silently decapitates one that is not: the bottom is
    # anchored, so every pixel of excess height leaves through the top of the
    # frame. Whichever axis runs out first decides the scale.
    scale = min(
        (W * FILL_W) / img.width,
        (H + BLEED - HEADROOM) / img.height,
    )
    img = img.resize(
        (max(1, int(img.width * scale)), max(1, int(img.height * scale))),
        Image.LANCZOS,
    )

    canvas = backdrop(colour)
    canvas.alpha_composite(img, ((W - img.width) // 2, H + BLEED - img.height))

    path = os.path.join(OUT_DIR, out_name)
    canvas.convert('RGB').save(path, 'PNG', optimize=True)
    print(f'  {out_name:12} {canvas.size[0]}x{canvas.size[1]}  {os.path.getsize(path) // 1024} KB')


os.makedirs(OUT_DIR, exist_ok=True)
print('interviewer portraits ->', OUT_DIR)
for src, out_name, colour, needs_strip in SUBJECTS:
    build(src, out_name, colour, needs_strip)
