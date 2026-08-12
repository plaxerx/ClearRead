#!/usr/bin/env python3
"""Regenerate the Clear Read icons.

Run from the repo root: python icons/generate.py

Not part of any build. The PNGs are committed; this exists so the shapes can be
adjusted without redrawing them by hand.

The mark is a magnifier over three text lines — read closely, which is the whole
product. Each size is drawn with its own geometry rather than downscaling one
master, because at 16px the glass lines turn to mush unless they get thicker and
lose one row.
"""

from PIL import Image, ImageDraw
import os

# Brand palette, same values as styles.css.
NAVY_TOP = (13, 33, 58)
NAVY_BOT = (26, 71, 122)
BRAND = (30, 95, 168)
LENS = (168, 209, 246)
GLASS_INK = (232, 242, 253)

SS = 8  # supersample factor; downscaled with LANCZOS for clean edges


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius, fill=255)
    return m


def draw_icon(px, enabled=True):
    """Draw one icon at px pixels square."""
    S = px * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Vertical gradient tile. Flat fills read as dead at 128px.
    for y in range(S):
        d.line([(0, y), (S, y)], fill=lerp(NAVY_TOP, NAVY_BOT, y / S))

    # A soft brand bloom behind the lens so the tile has some depth.
    bloom = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bloom)
    cx, cy = S * 0.46, S * 0.43
    for i in range(14, 0, -1):
        r = S * 0.40 * i / 14
        bd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BRAND + (7,))
    img = Image.alpha_composite(img, bloom)
    d = ImageDraw.Draw(img)

    # Geometry. 16px gets a bigger, blunter mark: at that size the glass lines
    # collapse into grey mush and the handle crowds the ring, so the lines are
    # dropped entirely and the lens carries the shape on its own.
    tiny = px <= 16
    ring_r = S * (0.325 if tiny else 0.265)
    ring_w = S * (0.115 if tiny else 0.075)
    handle_w = S * (0.135 if tiny else 0.092)
    line_w = S * 0.040
    rows = 0 if tiny else 3

    # Handle first, so the ring sits on top of its inner end.
    hx, hy = cx + ring_r * 0.72, cy + ring_r * 0.72
    ex, ey = (S * 0.80, S * 0.80) if tiny else (S * 0.845, S * 0.845)
    d.line([(hx, hy), (ex, ey)], fill=LENS, width=round(handle_w))
    for p in ((hx, hy), (ex, ey)):  # round the caps
        d.ellipse([p[0] - handle_w / 2, p[1] - handle_w / 2,
                   p[0] + handle_w / 2, p[1] + handle_w / 2], fill=LENS)

    # Glass, then the text lines, then the ring over the top.
    d.ellipse([cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r],
              fill=BRAND + (190 if tiny else 110,))

    inner = ring_r - ring_w * 0.62
    gap = inner * 0.62
    widths = [0.72, 0.86, 0.58]
    start = cy - gap * (rows - 1) / 2
    for i in range(rows):
        y = start + gap * i
        half = inner * widths[i] * 0.5
        d.line([(cx - half, y), (cx + half, y)], fill=GLASS_INK, width=round(line_w))
        for xp in (cx - half, cx + half):  # rounded ends
            d.ellipse([xp - line_w / 2, y - line_w / 2,
                       xp + line_w / 2, y + line_w / 2], fill=GLASS_INK)

    d.ellipse([cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r],
              outline=LENS, width=round(ring_w))

    img = img.resize((px, px), Image.LANCZOS)
    img.putalpha(rounded_mask(px * SS, round(px * SS * 0.22)).resize((px, px), Image.LANCZOS))

    if not enabled:
        # Disabled state: drained of colour and dimmed, silhouette intact so the
        # toolbar button still reads as the same extension.
        grey = img.convert("LA").convert("RGBA")
        r, g, b, a = grey.split()
        # 16px is already thin on pixels; fading it as hard as the large sizes
        # left nothing legible in the toolbar.
        fade = 0.72 if px <= 16 else 0.58
        img = Image.merge("RGBA", (r, g, b, a.point(lambda v: round(v * fade))))

    return img


def main():
    out = os.path.dirname(os.path.abspath(__file__))
    for px in (16, 48, 128):
        for enabled in (True, False):
            name = f"icon{px}{'' if enabled else '_off'}.png"
            draw_icon(px, enabled).save(os.path.join(out, name))
            print("wrote", name)


if __name__ == "__main__":
    main()
