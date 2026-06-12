#!/usr/bin/env python3
"""Generate extension icon artwork (pure stdlib, reproducible).

Flat Andes-blue rounded square with a white percent motif (two rings + a
diagonal bar). Rendered with 4x supersampling for clean edges; readable at
16px. No text. Sizes: 16/48/128 RGBA PNG.
"""
import math
import struct
import zlib
from pathlib import Path

BLUE = (0x34, 0x83, 0xFA)
WHITE = (0xFF, 0xFF, 0xFF)
OUT_DIR = Path(__file__).resolve().parent.parent / "src" / "assets" / "icons"
SS = 4  # supersampling factor

# Geometry in unit space [0,1]. Small sizes get thicker strokes and wider
# ring spacing so the % stays readable at 16px.
def geometry(size: int) -> dict:
    if size <= 16:
        return {
            "ring1": (0.31, 0.31),
            "ring2": (0.69, 0.69),
            "ring_outer": 0.181,
            "ring_inner": 0.054,
            "bar_half_width": 0.0725
        }
    return {
        "ring1": (0.33, 0.33),
        "ring2": (0.67, 0.67),
        "ring_outer": 0.145,
        "ring_inner": 0.068,
        "bar_half_width": 0.058
    }


CORNER_RADIUS = 0.22
INSET = 0.02
BAR_A = (0.685, 0.27)
BAR_B = (0.315, 0.73)


def in_rounded_square(x: float, y: float) -> bool:
    half = 0.5 - INSET
    dx = max(abs(x - 0.5) - (half - CORNER_RADIUS), 0.0)
    dy = max(abs(y - 0.5) - (half - CORNER_RADIUS), 0.0)
    return math.hypot(dx, dy) <= CORNER_RADIUS


def in_ring(x: float, y: float, cx: float, cy: float, geo: dict) -> bool:
    d = math.hypot(x - cx, y - cy)
    return geo["ring_inner"] <= d <= geo["ring_outer"]


def in_bar(x: float, y: float, geo: dict) -> bool:
    (ax, ay), (bx, by) = BAR_A, BAR_B
    vx, vy = bx - ax, by - ay
    t = ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)
    t = max(0.0, min(1.0, t))
    return math.hypot(x - (ax + t * vx), y - (ay + t * vy)) <= geo["bar_half_width"]


def sample(x: float, y: float, geo: dict):
    if not in_rounded_square(x, y):
        return (0, 0, 0, 0)
    if (
        in_ring(x, y, *geo["ring1"], geo)
        or in_ring(x, y, *geo["ring2"], geo)
        or in_bar(x, y, geo)
    ):
        return (*WHITE, 255)
    return (*BLUE, 255)


def render(size: int) -> bytes:
    geo = geometry(size)
    rows = bytearray()
    n = size * SS
    for py in range(size):
        rows.append(0)  # PNG filter type 0
        for px in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    sr, sg, sb, sa = sample(
                        (px * SS + sx + 0.5) / n, (py * SS + sy + 0.5) / n, geo
                    )
                    r += sr * sa
                    g += sg * sa
                    b += sb * sa
                    a += sa
            if a == 0:
                rows += b"\x00\x00\x00\x00"
            else:
                rows += bytes((r // a, g // a, b // a, a // (SS * SS)))
    return bytes(rows)


def chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def make_png(size: int) -> bytes:
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # RGBA
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(render(size), 9))
        + chunk(b"IEND", b"")
    )


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in (16, 48, 128):
        path = OUT_DIR / f"icon{size}.png"
        path.write_bytes(make_png(size))
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
