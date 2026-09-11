"""Validate the committed Squirrel splash asset without requiring fonts."""
import pathlib
import unittest

from PIL import Image, ImageChops, ImageSequence

ASSET = pathlib.Path(__file__).resolve().parents[1] / "assets" / "installer-loading.gif"


class InstallerGifTests(unittest.TestCase):
    def test_animation_and_transparent_corners(self):
        with Image.open(ASSET) as animation:
            self.assertEqual(animation.size, (320, 240))
            self.assertEqual(animation.n_frames, 36)
            self.assertEqual(animation.info["loop"], 0)
            frames = []
            for frame in ImageSequence.Iterator(animation):
                self.assertEqual(frame.info["duration"], 50)
                self.assertEqual(frame.disposal_method, 2)
                rgba = frame.convert("RGBA")
                for point in ((0, 0), (319, 0), (0, 239), (319, 239)):
                    self.assertEqual(rgba.getpixel(point)[3], 0)
                self.assertEqual(rgba.getpixel((160, 155))[3], 255)
                frames.append(rgba.copy())
            for frame in frames[1:]:
                self.assertEqual(frame.crop((0, 0, 320, 190)).tobytes(), frames[0].crop((0, 0, 320, 190)).tobytes())
            self.assertGreater(len({f.tobytes() for f in frames}), 20)
            # Loop boundary should be another small animation step, not a reset flash.
            seam = ImageChops.difference(frames[-1].convert("RGB"), frames[0].convert("RGB"))
            self.assertLess(max(high for low, high in seam.getextrema()), 30)


if __name__ == "__main__":
    unittest.main()
