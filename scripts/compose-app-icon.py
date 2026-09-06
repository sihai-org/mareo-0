"""Build the Dock icon from the original logo using Pillow, without redrawing it."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps

assets = Path(__file__).resolve().parent.parent / "assets"
# Work at 2x for smooth rounded corners and a soft shadow at small Dock sizes.
canvas_size = 2048
plate_bounds = (200, 200, 1848, 1848)
plate_radius = 370

shadow_mask = Image.new("L", (canvas_size, canvas_size))
ImageDraw.Draw(shadow_mask).rounded_rectangle(
    (200, 222, 1848, 1870), radius=plate_radius, fill=40
)
icon = Image.new("RGBA", shadow_mask.size, (0, 0, 0, 0))
icon.putalpha(shadow_mask.filter(ImageFilter.GaussianBlur(22)))

plate = Image.new("RGBA", icon.size)
ImageDraw.Draw(plate).rounded_rectangle(
    plate_bounds, radius=plate_radius, fill="white", outline=(230, 230, 232, 255), width=2
)
icon = Image.alpha_composite(icon, plate)
with Image.open(assets / "logo.png") as source:
    logo = ImageOps.contain(source.convert("RGBA"), (1720, 1720), Image.Resampling.LANCZOS)
    icon.alpha_composite(logo, ((canvas_size - logo.width) // 2, (canvas_size - logo.height) // 2))

icon.resize((1024, 1024), Image.Resampling.LANCZOS).save(assets / "app-icon.png")
