#!/usr/bin/env python3
"""Frame a raw screenshot into a polished 1280x800 Chrome Web Store image.

Netio-blue canvas, bold white headline + light subtitle at the top, and the
screenshot centered below with rounded corners and a soft shadow so it floats.

  python3 scripts/make-screenshot.py INPUT OUTPUT \
      --headline "..." --subtitle "..."

Reusable for the whole screenshot set — same framing, different art/copy.
"""
import argparse
from PIL import Image, ImageDraw, ImageFont, ImageFilter

CANVAS = (1280, 800)
BG = (0x2D, 0x32, 0x77)        # Netio deep blue
HEADLINE_FILL = (255, 255, 255)
SUBTITLE_FILL = (0xCD, 0xD0, 0xEE)  # light lavender
ACCENT = (0x00, 0xA6, 0x50)    # profit green

MARGIN_X = 70
TOP_PAD = 46
RADIUS = 18

FONT_CANDIDATES_BOLD = [
    "DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]
FONT_CANDIDATES_REG = [
    "DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def font(bold: bool, size: int) -> ImageFont.FreeTypeFont:
    for name in (FONT_CANDIDATES_BOLD if bold else FONT_CANDIDATES_REG):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def wrap(draw, text, fnt, max_w):
    """Greedy word-wrap to lines that fit max_w."""
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if draw.textlength(trial, font=fnt) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def fit_lines(draw, text, bold, max_size, min_size, max_w):
    """Largest size (down to min) where the text wraps to <= 2 lines."""
    for size in range(max_size, min_size - 1, -1):
        fnt = font(bold, size)
        lines = wrap(draw, text, fnt, max_w)
        if len(lines) <= 2:
            return fnt, lines, size
    fnt = font(bold, min_size)
    return fnt, wrap(draw, text, fnt, max_w), min_size


def draw_centered(draw, lines, fnt, fill, top, line_gap):
    y = top
    for line in lines:
        w = draw.textlength(line, font=fnt)
        draw.text(((CANVAS[0] - w) / 2, y), line, font=fnt, fill=fill)
        ascent, descent = fnt.getmetrics()
        y += ascent + descent + line_gap
    return y


def rounded(img, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, img.size[0] - 1, img.size[1] - 1], radius=radius, fill=255
    )
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def make(input_path, output_path, headline, subtitle):
    base = Image.new("RGBA", CANVAS, (*BG, 255))
    draw = ImageDraw.Draw(base)
    max_text_w = CANVAS[0] - 2 * MARGIN_X

    # --- headline + subtitle ---
    h_font, h_lines, _ = fit_lines(draw, headline, True, 52, 34, max_text_w)
    y = draw_centered(draw, h_lines, h_font, HEADLINE_FILL, TOP_PAD, 4)

    # small green accent rule between headline and subtitle
    rule_w = 90
    draw.rounded_rectangle(
        [(CANVAS[0] - rule_w) / 2, y + 6, (CANVAS[0] + rule_w) / 2, y + 11],
        radius=3, fill=ACCENT,
    )
    y += 24

    if subtitle:
        s_font, s_lines, _ = fit_lines(draw, subtitle, False, 27, 18, max_text_w)
        y = draw_centered(draw, s_lines, s_font, SUBTITLE_FILL, y, 2)

    # --- screenshot, scaled to the remaining area, rounded + shadowed ---
    art = Image.open(input_path).convert("RGBA")
    area_top = int(y) + 22
    area_bottom = CANVAS[1] - 40
    max_h = area_bottom - area_top
    max_w = CANVAS[0] - 2 * MARGIN_X
    scale = min(max_w / art.width, max_h / art.height)
    new_size = (max(1, int(art.width * scale)), max(1, int(art.height * scale)))
    art = rounded(art.resize(new_size, Image.LANCZOS), RADIUS)

    ax = (CANVAS[0] - art.width) // 2
    ay = area_top + (max_h - art.height) // 2

    # soft shadow
    shadow = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    sil = Image.new("RGBA", art.size, (0, 0, 0, 0))
    ImageDraw.Draw(sil).rounded_rectangle(
        [0, 0, art.width - 1, art.height - 1], radius=RADIUS, fill=(0, 0, 0, 130)
    )
    shadow.paste(sil, (ax, ay + 16), sil)
    shadow = shadow.filter(ImageFilter.GaussianBlur(24))
    base = Image.alpha_composite(base, shadow)

    base.paste(art, (ax, ay), art)
    base.convert("RGB").save(output_path)
    print(f"wrote {output_path} ({CANVAS[0]}x{CANVAS[1]})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--headline", required=True)
    ap.add_argument("--subtitle", default="")
    args = ap.parse_args()
    make(args.input, args.output, args.headline, args.subtitle)


if __name__ == "__main__":
    main()
