#!/usr/bin/env python3
"""Generate placeholder extension icons (pure stdlib, no Pillow).

Solid Andes action-blue squares with a yellow accent stripe along the bottom.
Replace with real artwork before CWS submission; sizes must stay 16/48/128.
"""
import struct
import zlib
from pathlib import Path

ACTION_BLUE = (0x34, 0x83, 0xFA)
ACCENT_YELLOW = (0xFF, 0xE6, 0x00)
OUT_DIR = Path(__file__).resolve().parent.parent / "src" / "assets" / "icons"


def chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def make_png(size: int) -> bytes:
    stripe_start = size - max(2, size // 8)  # yellow stripe, bottom ~12%
    rows = b""
    for y in range(size):
        color = ACCENT_YELLOW if y >= stripe_start else ACTION_BLUE
        rows += b"\x00" + bytes(color) * size  # filter 0 + RGB row
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(rows, 9))
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
