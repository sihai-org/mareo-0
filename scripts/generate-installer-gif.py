#!/usr/bin/env python3
"""Builds assets/installer-loading.gif for the Squirrel installer window.

Squirrel shows this animation while extracting the application. Requires
Pillow (pip install Pillow). Run from the repository root:

    python3 scripts/generate-installer-gif.py --font /path/to/chinese-font.ttf

The font is only needed to regenerate the committed GIF, not during packaging.
"""

from __future__ import annotations

import argparse
import math
import pathlib

from PIL import Image, ImageDraw, ImageFont

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
LOGO = PROJECT_ROOT / "assets" / "logo.png"
TARGET = PROJECT_ROOT / "assets" / "installer-loading.gif"

CANVAS = (320, 240)
SCALE = 3
FRAMES = 36
FRAME_MS = 50
BACKGROUND = (250, 251, 255)
DOT_IDLE = (210, 210, 235)
DOT_ACTIVE = (87, 82, 217)


def build_card(font_path: str) -> Image.Image:
    canvas = Image.new("RGBA", tuple(size * SCALE for size in CANVAS))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle(
        (SCALE, SCALE, 319 * SCALE, 239 * SCALE), radius=22 * SCALE,
        fill=BACKGROUND, outline=(221, 225, 237), width=SCALE,
    )
    with Image.open(LOGO) as source:
        logo = source.convert("RGBA").resize((80 * SCALE, 80 * SCALE), Image.Resampling.LANCZOS)
    canvas.alpha_composite(logo, (120 * SCALE, 25 * SCALE))
    draw.text((160 * SCALE, 117 * SCALE), "Mareo", anchor="mm",
              font=ImageFont.truetype(font_path, 27 * SCALE), fill=(32, 34, 56))
    draw.text((160 * SCALE, 155 * SCALE), "正在安装，请稍候", anchor="mm",
              font=ImageFont.truetype(font_path, 14 * SCALE), fill=(103, 109, 130))
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--font", required=True, help="Font file with Chinese glyphs (TTF/OTF/TTC)")
    args = parser.parse_args()
    card = build_card(args.font)

    # One shared palette prevents static text/logo colors flickering. Reserve
    # 16 colors for the breathing dots and index 255 for binary transparency.
    palette = card.resize(CANVAS, Image.Resampling.LANCZOS).convert("RGB").quantize(colors=239)
    colors = palette.getpalette()[:239 * 3]
    for step in range(16):
        colors.extend(round(a + (b - a) * step / 15) for a, b in zip(DOT_IDLE, DOT_ACTIVE))
    palette.putpalette(colors + [255, 0, 255])

    frames = []
    for frame_number in range(FRAMES):
        frame = card.copy()
        draw = ImageDraw.Draw(frame)
        for index, x in enumerate((146, 160, 174)):
            strength = (1 + math.cos(2 * math.pi * (frame_number / FRAMES - index / 3))) / 2
            color = tuple(round(a + (b - a) * strength) for a, b in zip(DOT_IDLE, DOT_ACTIVE))
            draw.ellipse(((x - 3) * SCALE, 196 * SCALE, (x + 3) * SCALE, 202 * SCALE), fill=color)
        frame = frame.resize(CANVAS, Image.Resampling.LANCZOS)
        indexed = frame.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE)
        # GIF cannot carry a soft alpha shadow. Keep corners fully transparent
        # and the card opaque instead of baking in a desktop-colored matte.
        indexed.paste(255, mask=frame.getchannel("A").point(lambda alpha: 255 if alpha < 128 else 0))
        frames.append(indexed)
    frames[0].save(
        TARGET,
        save_all=True,
        append_images=frames[1:],
        duration=FRAME_MS,
        loop=0,
        disposal=2,
        transparency=255,
        background=255,
        optimize=False,
    )
    print(f"Wrote {TARGET}")


if __name__ == "__main__":
    main()
