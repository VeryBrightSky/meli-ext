#!/usr/bin/env python3
"""Generate Netio logo artwork (reproducible).

App icons (16/48/128 RGBA PNG): rounded-square, deep-blue (#2D3277)
background, a bold white "N" monogram with a profit-green (#00A650) upward
arrow cutting through it. Drawn geometrically with 4x supersampling — no
fonts, no thin lines — so it stays crisp and legible at 16px.

Store promo tile (440x280): same blue, the mark on the left, "Netio"
wordmark + Spanish tagline on the right. Uses Pillow for text (skipped with a
warning if Pillow is unavailable; the app icons never need it).

  python3 scripts/gen-icons.py
"""
import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "src" / "assets" / "icons"
STORE_DIR = ROOT / "store"

# Logo palette (store/branding only — the in-page card keeps Andes blue).
BLUE = (0x2D, 0x32, 0x77)        # deep blue background
BLUE_TILE = (0x3A, 0x41, 0xA8)   # lighter tile face, promo only (lifts the mark)
GREEN = (0x00, 0xA6, 0x50)       # profit green accent
WHITE = (0xFF, 0xFF, 0xFF)

SS = 4  # supersampling factor

CORNER_RADIUS = 0.22
INSET = 0.02

# "N" monogram geometry (unit space). Two verticals + the top-left→bottom-right
# diagonal.
N_LV = ((0.33, 0.285), (0.33, 0.715))
N_RV = ((0.67, 0.285), (0.67, 0.715))
N_DIAG = ((0.33, 0.285), (0.67, 0.715))

# Green upward arrow (bottom-left → top-right), drawn over the N.
ARROW_A = (0.285, 0.705)
ARROW_TIP = (0.745, 0.300)


def stroke_widths(size: int) -> dict:
    # Thicker strokes + a wider knockout gap at 16px for legibility.
    if size <= 16:
        return {"n": 0.078, "arrow": 0.050, "head_len": 0.19, "head_hw": 0.130,
                "halo": 0.050}
    return {"n": 0.066, "arrow": 0.046, "head_len": 0.17, "head_hw": 0.110,
            "halo": 0.024}


def _unit(vx: float, vy: float):
    d = math.hypot(vx, vy) or 1.0
    return vx / d, vy / d


def in_rounded_square(x: float, y: float) -> bool:
    half = 0.5 - INSET
    dx = max(abs(x - 0.5) - (half - CORNER_RADIUS), 0.0)
    dy = max(abs(y - 0.5) - (half - CORNER_RADIUS), 0.0)
    return math.hypot(dx, dy) <= CORNER_RADIUS


def in_capsule(x, y, ax, ay, bx, by, hw) -> bool:
    vx, vy = bx - ax, by - ay
    denom = vx * vx + vy * vy
    t = 0.0 if denom == 0 else ((x - ax) * vx + (y - ay) * vy) / denom
    t = max(0.0, min(1.0, t))
    return math.hypot(x - (ax + t * vx), y - (ay + t * vy)) <= hw


def in_triangle(x, y, p1, p2, p3) -> bool:
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    d1 = cross(p1, p2, (x, y))
    d2 = cross(p2, p3, (x, y))
    d3 = cross(p3, p1, (x, y))
    has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (has_neg and has_pos)


def in_n(x, y, w) -> bool:
    hw = w["n"]
    return (
        in_capsule(x, y, *N_LV[0], *N_LV[1], hw)
        or in_capsule(x, y, *N_RV[0], *N_RV[1], hw)
        or in_capsule(x, y, *N_DIAG[0], *N_DIAG[1], hw)
    )


def in_arrow(x, y, w) -> bool:
    ux, uy = _unit(ARROW_TIP[0] - ARROW_A[0], ARROW_TIP[1] - ARROW_A[1])
    px, py = -uy, ux
    base_x = ARROW_TIP[0] - ux * w["head_len"]
    base_y = ARROW_TIP[1] - uy * w["head_len"]
    # shaft up to the arrowhead base, then the triangular head
    if in_capsule(x, y, ARROW_A[0], ARROW_A[1], base_x, base_y, w["arrow"]):
        return True
    c1 = (base_x + px * w["head_hw"], base_y + py * w["head_hw"])
    c2 = (base_x - px * w["head_hw"], base_y - py * w["head_hw"])
    return in_triangle(x, y, ARROW_TIP, c1, c2)


def sample(x, y, w, bg):
    if not in_rounded_square(x, y):
        return (0, 0, 0, 0)
    if in_arrow(x, y, w):          # green over white ("cutting through")
        return (*GREEN, 255)
    n = in_n(x, y, w)
    if n:
        # Knockout: a blue separator ring around the arrow keeps green and
        # white from blending into mush at 16px. On the background the halo is
        # already blue, so it is invisible there.
        halo = {**w, "arrow": w["arrow"] + w["halo"],
                "head_len": w["head_len"] + w["halo"],
                "head_hw": w["head_hw"] + w["halo"]}
        if in_arrow(x, y, halo):
            return (*bg, 255)
        return (*WHITE, 255)
    return (*bg, 255)


def raster(size: int, bg=BLUE) -> bytes:
    """Flat RGBA buffer (size*size*4), supersampled — no PNG filter bytes."""
    w = stroke_widths(size)
    out = bytearray()
    n = size * SS
    for py in range(size):
        for px in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    sr, sg, sb, sa = sample(
                        (px * SS + sx + 0.5) / n, (py * SS + sy + 0.5) / n, w, bg
                    )
                    r += sr * sa
                    g += sg * sa
                    b += sb * sa
                    a += sa
            if a == 0:
                out += b"\x00\x00\x00\x00"
            else:
                out += bytes((r // a, g // a, b // a, a // (SS * SS)))
    return bytes(out)


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def make_png(size: int) -> bytes:
    flat = raster(size)
    stride = size * 4
    rows = bytearray()
    for py in range(size):
        rows.append(0)  # filter type 0
        rows += flat[py * stride : (py + 1) * stride]
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # RGBA
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + _chunk(b"IEND", b"")
    )


def make_promo() -> bool:
    try:
        from PIL import Image, ImageDraw, ImageFont, ImageFilter
    except ImportError:
        print("warning: Pillow not available — skipped promo tile (icons OK)")
        return False

    W, H = 440, 280
    base = Image.new("RGBA", (W, H), (*BLUE, 255))

    # Mark on a slightly lighter tile with a soft shadow.
    mark_px = 150
    mark = Image.frombytes("RGBA", (mark_px, mark_px), raster(mark_px, bg=BLUE_TILE))
    mx, my = 30, (H - mark_px) // 2

    silhouette = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    silhouette.paste((0, 0, 0, 110), (mx, my), mark)
    base = Image.alpha_composite(base, silhouette.filter(ImageFilter.GaussianBlur(7)))
    base.paste(mark, (mx, my), mark)

    draw = ImageDraw.Draw(base)

    def font(sz):
        for name in (
            "DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ):
            try:
                return ImageFont.truetype(name, sz)
            except OSError:
                continue
        return ImageFont.load_default()

    text_x = mx + mark_px + 26
    avail = W - text_x - 18

    def fit(text, max_size):
        for sz in range(max_size, 8, -1):
            f = font(sz)
            if draw.textlength(text, font=f) <= avail:
                return f, sz
        return font(9), 9

    word_f, word_sz = fit("Netio", 60)
    # One tagline size that fits the longer of the two lines.
    tag_lines = ["Calculadora de ganancias", "para Mercado Libre"]
    tag_sz = min(fit(line, 22)[1] for line in tag_lines)
    tag_f = font(tag_sz)

    # Vertically center the wordmark + 2 tagline lines as a block.
    line_gap = 6
    block_h = word_sz + line_gap + 2 * (tag_sz + 4)
    y = (H - block_h) // 2
    draw.text((text_x, y), "Netio", font=word_f, fill=(*WHITE, 255))
    y += word_sz + line_gap + 6
    draw.text((text_x, y), tag_lines[0], font=tag_f, fill=(*GREEN, 255))
    y += tag_sz + 4
    draw.text((text_x, y), tag_lines[1], font=tag_f, fill=(*WHITE, 255))

    STORE_DIR.mkdir(parents=True, exist_ok=True)
    out = STORE_DIR / "promo-tile-440x280.png"
    base.convert("RGBA").save(out)
    print(f"wrote {out} (wordmark {word_sz}px, tagline {tag_sz}px)")
    return True


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    for size in (16, 48, 128):
        path = ICON_DIR / f"icon{size}.png"
        path.write_bytes(make_png(size))
        print(f"wrote {path}")
    make_promo()


if __name__ == "__main__":
    main()
