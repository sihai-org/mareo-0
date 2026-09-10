#!/usr/bin/env python3
"""Builds assets/installer-loading.gif for the Squirrel installer window.

Squirrel shows this animation while extracting the application. Requires
Pillow (pip install Pillow). Run from the repository root:

    python3 scripts/generate-installer-gif.py
"""

from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
LOGO = PROJECT_ROOT / "assets" / "logo.png"
TARGET = PROJECT_ROOT / "assets" / "installer-loading.gif"

CANVAS = 200
LOGO_SIZE = 104
DOT_RADIUS = 6
DOT_Y = 168
DOT_XS = (76, 100, 124)
FRAMES = 12
FRAME_MS = 110


def build_frame(logo: Image.Image, active: int) -> Image.Image:
    canvas = Image.new("RGB", (CANVAS, CANVAS), "white")
    offset = ((CANVAS - LOGO_SIZE) // 2, 46)
    canvas.paste(logo, offset, logo)
    draw = ImageDraw.Draw(canvas)
    for index, x in enumerate(DOT_XS):
        # The active dot grows and darkens, fading smoothly around the loop.
        distance = min((index - active) % len(DOT_XS), (active - index) % len(DOT_XS))
        strength = 1.0 - (distance / len(DOT_XS))
        radius = DOT_RADIUS + round(2 * strength)
        shade = round(60 + 150 * (1 - strength))
        draw.ellipse(
            (x - radius, DOT_Y - radius, x + radius, DOT_Y + radius),
            fill=(shade, shade + 20, min(255, shade + 60)),
        )
    return canvas


def main() -> None:
    logo = Image.open(LOGO).convert("RGBA").resize((LOGO_SIZE, LOGO_SIZE), Image.LANCZOS)
    frames = [build_frame(logo, index % len(DOT_XS)) for index in range(FRAMES)]
    frames[0].save(
        TARGET,
        save_all=True,
        append_images=frames[1:],
        duration=FRAME_MS,
        loop=0,
        disposal=2,
    )
    print(f"Wrote {TARGET}")


if __name__ == "__main__":
    main()
