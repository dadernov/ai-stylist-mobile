import unittest

import numpy as np
from PIL import Image, ImageDraw

from tryon_composite import build_keep_mask, compose, head_box, person_alpha, silhouette_bbox


def person(size=(400, 800), top=0.08, height=0.84, centre=0.5, head=0.055, body=0.16):
    """Synthetic silhouette: a head circle over a wider torso and legs."""
    width, frame_height = size
    cutout = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(cutout)
    y0 = frame_height * top
    y1 = y0 + frame_height * height
    cx = width * centre
    head_r = width * head
    draw.ellipse((cx - head_r, y0, cx + head_r, y0 + head_r * 2.3), fill=(220, 180, 160, 255))
    shoulders = y0 + head_r * 2.3
    draw.rectangle((cx - width * body, shoulders, cx + width * body, y1), fill=(80, 90, 120, 255))
    return cutout, (y0, shoulders, y1)


class HeadDetection(unittest.TestCase):
    def test_head_stops_at_the_shoulders(self):
        cutout, (y0, shoulders, _) = person()
        box = head_box(cutout.getchannel("A"))
        self.assertIsNotNone(box)
        self.assertLess(abs(box[1] - y0), 6)
        # The lock must end at the shoulder line, otherwise the original collar
        # is pasted back over the freshly generated garment.
        self.assertLess(abs(box[3] - shoulders), 12)

    def test_head_follows_an_off_centre_person(self):
        cutout, _ = person(centre=0.25, top=0.2, height=0.5)
        box = head_box(cutout.getchannel("A"))
        self.assertIsNotNone(box)
        centre_x = (box[0] + box[2]) / 2
        self.assertLess(abs(centre_x - 400 * 0.25), 12)
        self.assertGreater(box[1], 800 * 0.15)

    def test_unusable_silhouette_is_rejected(self):
        self.assertIsNone(person_alpha((40, 40), Image.new("RGBA", (40, 40), (1, 1, 1, 255))))
        self.assertIsNone(person_alpha((40, 40), Image.new("RGBA", (40, 40), (0, 0, 0, 0))))

    def test_bbox_tracks_the_silhouette(self):
        cutout, _ = person(centre=0.7)
        box = silhouette_bbox(cutout.getchannel("A"))
        self.assertGreater(box[0], 400 * 0.5)


class KeepMask(unittest.TestCase):
    def setUp(self):
        self.cutout, (self.y0, self.shoulders, self.y1) = person()
        self.alpha = self.cutout.getchannel("A")

    def mask(self, slots):
        return np.asarray(build_keep_mask((400, 800), self.alpha, self.alpha, slots))

    def test_background_is_restored_and_torso_is_not(self):
        mask = self.mask(["top"])
        self.assertGreater(mask[400, 10], 200)
        torso_y = int(self.shoulders + (self.y1 - self.shoulders) * 0.15)
        self.assertLess(mask[torso_y, 200], 40)

    def test_head_is_restored(self):
        mask = self.mask(["top"])
        self.assertGreater(mask[int(self.y0 + 20), 200], 200)

    def test_legs_are_frozen_when_only_the_top_changes(self):
        mask = self.mask(["top"])
        person_height = self.y1 - self.y0
        ankle_y = int(self.y0 + person_height * 0.95)
        self.assertGreater(mask[ankle_y, 200], 200)

    def test_torso_is_frozen_when_only_shoes_change(self):
        mask = self.mask(["shoes"])
        chest_y = int(self.shoulders + (self.y1 - self.shoulders) * 0.1)
        self.assertGreater(mask[chest_y, 200], 200)

    def test_a_full_look_frees_the_whole_body(self):
        mask = self.mask(["top", "bottom", "shoes"])
        person_height = self.y1 - self.y0
        for fraction in (0.35, 0.6, 0.95):
            y = int(self.y0 + person_height * fraction)
            self.assertLess(mask[y, 200], 60, f"body frozen at {fraction}")

    def test_unknown_slot_freezes_nothing_below_the_head(self):
        mask = self.mask(["hat"])
        person_height = self.y1 - self.y0
        self.assertLess(mask[int(self.y0 + person_height * 0.95), 200], 60)


class Compose(unittest.TestCase):
    def test_only_the_changed_zone_takes_generated_pixels(self):
        cutout, (y0, shoulders, y1) = person()
        original = Image.new("RGB", (400, 800), (30, 30, 30))
        original.paste((200, 30, 30), (0, 0, 400, 800), cutout.getchannel("A"))
        generated = Image.new("RGB", (400, 800), (0, 200, 0))
        result, status = compose(original, generated, cutout, cutout, ["top"])
        self.assertEqual(status, "composed")
        pixels = np.asarray(result)
        # Background and legs keep the original, the torso takes the new garment.
        self.assertGreater(pixels[400, 5][0], 20)
        self.assertLess(pixels[400, 5][1], 60)
        torso_y = int(shoulders + (y1 - shoulders) * 0.15)
        self.assertGreater(pixels[torso_y, 200][1], 150)
        self.assertGreater(pixels[int(y0 + (y1 - y0) * 0.95), 200][0], 120)

    def test_reframed_output_is_left_alone(self):
        cutout, _ = person()
        original = Image.new("RGB", (400, 800), (30, 30, 30))
        generated = Image.new("RGB", (400, 400), (0, 200, 0))
        result, status = compose(original, generated, cutout, None, ["top"])
        self.assertEqual(status, "aspect-mismatch")
        self.assertEqual(result.size, (400, 400))

    def test_missing_silhouettes_fall_back_to_the_generated_image(self):
        original = Image.new("RGB", (400, 800), (30, 30, 30))
        generated = Image.new("RGB", (400, 800), (0, 200, 0))
        result, status = compose(original, generated, None, None, ["top"])
        self.assertEqual(status, "no-silhouette")
        self.assertEqual(np.asarray(result)[10, 10][1], 200)


if __name__ == "__main__":
    unittest.main()


class FramingGuard(unittest.TestCase):
    """Zone freezing only makes sense when the whole body is in frame."""

    def test_waist_up_shot_freezes_nothing_below_the_head(self):
        # Head takes a third of the silhouette: this is a half-length portrait,
        # so "the lower 28% of the body" is really the middle of the garment.
        cutout, (y0, shoulders, y1) = person(head=0.13, body=0.30, height=0.6)
        alpha = cutout.getchannel("A")
        head = head_box(alpha)
        self.assertIsNotNone(head)
        self.assertGreater((head[3] - head[1]) / (y1 - y0), 0.22)
        mask = np.asarray(build_keep_mask((400, 800), alpha, alpha, ["top"]))
        self.assertLess(mask[int(y1) - 14, 200], 60)

    def test_full_body_shot_still_freezes_the_legs(self):
        cutout, (y0, shoulders, y1) = person()
        alpha = cutout.getchannel("A")
        head = head_box(alpha)
        self.assertLessEqual((head[3] - head[1]) / (y1 - y0), 0.22)
        mask = np.asarray(build_keep_mask((400, 800), alpha, alpha, ["top"]))
        self.assertGreater(mask[int(y0 + (y1 - y0) * 0.95), 200], 200)

    def test_undetectable_head_freezes_nothing(self):
        # A tight crop gives no shoulder step, so the scale is unknown.
        cutout = Image.new("RGBA", (400, 800), (0, 0, 0, 0))
        ImageDraw.Draw(cutout).rectangle((40, 40, 360, 760), fill=(90, 90, 90, 255))
        alpha = cutout.getchannel("A")
        self.assertIsNone(head_box(alpha))
        mask = np.asarray(build_keep_mask((400, 800), alpha, alpha, ["top"]))
        self.assertLess(mask[700, 200], 60)
        self.assertGreater(mask[10, 10], 200)
