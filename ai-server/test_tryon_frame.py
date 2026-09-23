import unittest

import numpy as np
from PIL import Image, ImageDraw

import tryon_frame


class ProviderFrame(unittest.TestCase):
    def test_narrow_photo_is_padded_to_provider_canvas_without_touching_pixels(self):
        photo = Image.new('RGB', (1061, 2048), (90, 120, 150))
        ImageDraw.Draw(photo).rectangle((400, 300, 660, 1900), fill=(200, 40, 40))
        padded, box = tryon_frame.pad(photo)
        self.assertEqual(padded.size, (1143, 2048))
        self.assertEqual(box, (41, 0, 1102, 2048))
        self.assertAlmostEqual(padded.width / padded.height, tryon_frame.PROVIDER_RATIO, places=3)
        np.testing.assert_array_equal(np.asarray(padded)[:, 41:1102], np.asarray(photo))

    def test_margins_are_soft_scenery_not_mirrored_content(self):
        photo = Image.new('RGB', (400, 800), (90, 120, 150))
        ImageDraw.Draw(photo).rectangle((0, 300, 60, 500), fill=(250, 250, 250))
        padded, (left, _, right, _) = tryon_frame.pad(photo)
        margin = np.asarray(padded)[:, :left].astype(int)
        # No hard copies of the bright block: the band is a blurred continuation.
        self.assertLess(margin[300:500].std(axis=(0, 1)).max(), 40)
        self.assertGreater(margin[400, 0, 0], 120)
        self.assertEqual(padded.size[0] - right, left + (padded.size[0] - photo.width) % 2)

    def test_wide_photo_is_sent_unchanged(self):
        photo = Image.new('RGB', (900, 1200), 'white')
        padded, box = tryon_frame.pad(photo)
        self.assertIs(padded, photo)
        self.assertEqual(box, (0, 0, 900, 1200))

    def test_provider_frame_with_padded_aspect_maps_back_as_a_known_crop(self):
        photo = Image.new('RGB', (1061, 2048), 'black')
        padded, box = tryon_frame.pad(photo)
        # The provider returned a larger canvas with the same aspect and a marker
        # where the photo's pixel (500, 1000) sits inside the padded frame.
        generated = Image.new('RGB', (1536, 2752), (10, 10, 10))
        scale = 2752 / 2048
        x, y = round((500 + box[0]) * scale), round(1000 * scale)
        ImageDraw.Draw(generated).rectangle((x - 6, y - 6, x + 6, y + 6), fill=(255, 0, 0))
        framed = tryon_frame.to_source_frame(generated, photo.size, padded.size, box)
        self.assertEqual(framed.size, photo.size)
        self.assertEqual(framed.getpixel((500, 1000)), (255, 0, 0))
        self.assertEqual(framed.getpixel((530, 1000)), (10, 10, 10))

    def test_other_aspects_are_fitted_by_uniform_scale_and_centre_crop(self):
        photo = Image.new('RGB', (400, 800), 'black')
        padded, box = tryon_frame.pad(photo)
        generated = Image.new('RGB', (600, 800), (0, 0, 200))
        ImageDraw.Draw(generated).rectangle((300, 0, 300, 799), fill=(255, 255, 0))
        framed = tryon_frame.to_source_frame(generated, photo.size, padded.size, box)
        self.assertEqual(framed.size, photo.size)
        self.assertEqual(framed.getpixel((200, 400)), (255, 255, 0))


if __name__ == '__main__':
    unittest.main()
