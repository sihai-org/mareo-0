"""Composite the original logo over white without resizing or redrawing it.

Run with Python 3 and Pillow when assets/logo.png changes.
"""

from pathlib import Path

from PIL import Image

assets = Path(__file__).resolve().parent.parent / "assets"
with Image.open(assets / "logo.png") as source:
    foreground = source.convert("RGBA")
    background = Image.new("RGBA", foreground.size, "white")
    Image.alpha_composite(background, foreground).convert("RGB").save(assets / "logo-white.png")
