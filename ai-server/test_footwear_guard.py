import unittest
from unittest.mock import Mock, patch

import cv2
import numpy as np
from PIL import Image

import footwear_guard
from tryon_composite import compose


def labels():
    result = np.zeros((400, 200), dtype=np.uint8)
    result[25:65, 85:115] = 11
    result[65:230, 60:140] = 4
    result[230:355, 70:95] = 6
    result[230:355, 110:135] = 6
    result[350:380, 65:98] = 9
    result[350:380, 108:145] = 10
    return result


class FootwearProtection(unittest.TestCase):
    def test_shoes_and_both_shifted_footprints_are_exact(self):
        source = labels()
        generated = source.copy()
        generated[350:380, 65:98] = 0
        generated[350:380, 73:106] = 9
        mask = np.asarray(footwear_guard.keep_mask(source, generated, ['long_outer']))
        self.assertTrue((mask[350:380, 65:106] == 255).all())
        self.assertTrue((mask[383:, :] == 255).all())
        self.assertEqual(mask[160, 100], 0)

    def test_coat_hem_can_cover_shoes_and_reach_the_floor(self):
        source = labels()
        generated = source.copy()
        generated[180:, 60:103] = 4
        mask = np.asarray(footwear_guard.keep_mask(source, generated, ['long_outer']))
        self.assertEqual(mask[375, 80], 0)
        self.assertEqual(mask[399, 80], 0)
        self.assertEqual(mask[370, 125], 255)
        self.assertEqual(mask[399, 180], 255)

    def test_dress_and_trouser_hems_are_allowed(self):
        for slot, garment in [('one_piece', 7), ('one_piece', 6), ('bottom', 6)]:
            with self.subTest(slot=slot, garment=garment):
                source = labels()
                generated = source.copy()
                generated[230:365, 70:95] = garment
                mask = np.asarray(footwear_guard.keep_mask(source, generated, [slot]))
                self.assertEqual(mask[357, 80], 0)
                self.assertEqual(mask[375, 80], 255)

    def test_shoes_selected_or_unknown_slot_do_not_restore_old_shoes(self):
        for slots in [[], ['shoes'], ['long_outer', 'shoes'], ['bag']]:
            with self.subTest(slots=slots):
                self.assertIsNone(footwear_guard.keep_mask(labels(), labels(), slots))
                with patch.object(footwear_guard, 'parse') as parse:
                    self.assertIsNone(footwear_guard.protect(None, None, slots))
                parse.assert_not_called()

    def test_cropped_photo_has_no_fixed_bottom_cutoff(self):
        portrait = labels()[:250]
        self.assertIsNone(footwear_guard.keep_mask(portrait, portrait, ['long_outer']))

    def test_isolated_label_noise_does_not_lock_a_portrait(self):
        portrait = labels()[:250].copy()
        portrait[200, 100] = 9
        self.assertIsNone(footwear_guard.keep_mask(portrait, portrait, ['long_outer']))

    def test_off_centre_shoes_are_preserved(self):
        source = np.pad(labels(), ((0, 0), (200, 0)))
        mask = np.asarray(footwear_guard.keep_mask(source, source, ['outer']))
        self.assertEqual(mask[370, 325], 255)
        self.assertEqual(mask[150, 300], 0)

    def test_missing_model_keeps_existing_protection_without_logging_private_data(self):
        with patch.object(footwear_guard, 'parse', side_effect=RuntimeError('private-photo-url')), patch('builtins.print') as log:
            self.assertIsNone(footwear_guard.protect(None, None, ['outer']))
        self.assertIn('RuntimeError', log.call_args.args[0])
        self.assertNotIn('private', log.call_args.args[0])

    def test_composed_pixels_keep_shoes_floor_face_and_new_coat(self):
        source_labels = labels()
        generated_labels = source_labels.copy()
        generated_labels[160:399, 55:101] = 4
        generated_labels[350:380, 115:153] = 10
        rng = np.random.default_rng(23)
        original = Image.fromarray(rng.integers(0, 255, (400, 200, 3), dtype=np.uint8))
        generated = Image.new('RGB', original.size, 'green')
        source_cutout = original.convert('RGBA')
        source_cutout.putalpha(Image.fromarray((source_labels > 0).astype(np.uint8) * 255))
        generated_cutout = generated.convert('RGBA')
        generated_cutout.putalpha(Image.fromarray((generated_labels > 0).astype(np.uint8) * 255))
        keep = footwear_guard.keep_mask(source_labels, generated_labels, ['long_outer'])
        result, status = compose(original, generated, source_cutout, generated_cutout, ['long_outer'], [(80, 20, 120, 65)], keep)
        self.assertEqual(status, 'composed')
        pixels = np.asarray(result)
        np.testing.assert_array_equal(pixels[352:378, 112:155], np.asarray(original)[352:378, 112:155])
        np.testing.assert_array_equal(pixels[385:, 110:], np.asarray(original)[385:, 110:])
        np.testing.assert_array_equal(pixels[25:65, 85:115], np.asarray(original)[25:65, 85:115])
        self.assertEqual(result.getpixel((75, 389)), generated.getpixel((75, 389)))


class Parsing(unittest.TestCase):
    def test_preprocessing_and_full_resolution_logit_interpolation(self):
        logits = np.full((1, 18, 2, 2), -10, dtype=np.float32)
        logits[0, 0] = 0
        logits[0, 9, 1, 1] = 20
        session = Mock()
        session.run.return_value = [logits]
        image = Image.new('RGB', (100, 200), (255, 0, 0))
        with patch.object(footwear_guard, '_get_session', return_value=session):
            result = footwear_guard.parse(image)
        pixels = session.run.call_args.args[1]['pixel_values']
        self.assertEqual(pixels.shape, (1, 3, 512, 512))
        np.testing.assert_allclose(pixels[0, :, 0, 0], [(1 - .485) / .229, -.456 / .224, -.406 / .225], rtol=1e-6)
        reference = np.stack([cv2.resize(scores, image.size, interpolation=cv2.INTER_LINEAR) for scores in logits[0]]).argmax(axis=0)
        np.testing.assert_array_equal(result, reference)
        self.assertEqual(result.dtype, np.uint8)


if __name__ == '__main__':
    unittest.main()
