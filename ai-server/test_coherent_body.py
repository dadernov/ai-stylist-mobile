"""Copy one generated body, never splice source limbs into its new pose."""
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image

import face_guard
import tryon_matte


class CoherentBody(unittest.TestCase):
    def setUp(self):
        self.face = face_guard.Face(
            (82, 24, 32, 40),
            np.array([[89, 37], [106, 37], [98, 46], [91, 55], [105, 55]], float),
        )
        lighting = patch.object(tryon_matte.image_color, 'match_source_lighting',
                                side_effect=lambda source, generated, *_: generated)
        lighting.start()
        self.addCleanup(lighting.stop)

    def body(self):
        labels = np.zeros((400, 200), dtype=np.uint8)
        labels[24:70, 82:114] = 11
        labels[70:195, 66:132] = 4
        labels[95:236, 48:66] = 4
        labels[236:262, 45:65] = 14
        labels[95:236, 132:152] = 4
        labels[236:262, 134:153] = 15
        labels[185:345, 72:96] = 6
        labels[185:345, 106:130] = 6
        labels[345:375, 65:97] = 12
        labels[345:375, 106:144] = 13
        return labels

    def photo(self, labels, generated=False):
        pixels = np.full((*labels.shape, 3), (205, 215, 225) if generated else (225, 225, 225), dtype=np.uint8)
        pixels[labels > 0] = (30, 50, 75) if generated else (100, 100, 110)
        pixels[np.isin(labels, [11, 12, 13, 14, 15])] = (185, 145, 115) if generated else (165, 125, 100)
        return Image.fromarray(pixels)

    def prepare(self, source_labels, generated_labels, source=None, generated=None,
                face=None, slots=('top', 'bottom', 'long_outer')):
        source = source or self.photo(source_labels)
        generated = generated or self.photo(generated_labels, generated=True)
        layer, keep, _ = tryon_matte.prepare(
            source, generated, source_labels, generated_labels, [face or self.face], slots,
        )
        result = Image.composite(source, layer, keep)
        return np.asarray(keep), np.asarray(result), np.asarray(generated)

    def test_shifted_hand_replaces_both_source_and_generated_footprints(self):
        source, generated = self.body(), self.body()
        generated[236:262, 45:65] = 0
        generated[236:262, 59:79] = 14
        keep, result, raw = self.prepare(source, generated)
        self.assertTrue((keep[239:259, 47:63] == 0).all())
        self.assertTrue((keep[239:259, 67:76] == 0).all())
        np.testing.assert_array_equal(result[239:259, 47:76], raw[239:259, 47:76])
        self.assertEqual(tuple(result[250, 49]), (205, 215, 225), 'old hand must become generated scenery')

    def test_generated_hand_on_original_background_is_not_amputated(self):
        source, generated = self.body(), self.body()
        generated[236:262, 134:153] = 0
        generated[230:264, 151:175] = 15
        self.assertEqual(source[250, 167], 0)
        keep, result, raw = self.prepare(source, generated)
        self.assertEqual(keep[250, 167], 0)
        np.testing.assert_array_equal(result[234:260, 154:172], raw[234:260, 154:172])

    def test_original_bare_leg_outside_new_jeans_is_erased(self):
        source, generated = self.body(), self.body()
        source[205:345, 72:96] = 0
        source[205:345, 61:83] = 12
        keep, result, raw = self.prepare(source, generated)
        self.assertTrue((keep[215:335, 63:70] == 0).all())
        np.testing.assert_array_equal(result[215:335, 63:70], raw[215:335, 63:70])
        self.assertEqual(tuple(result[270, 65]), (205, 215, 225))

    def test_displaced_original_foot_is_replaced_by_generated_floor(self):
        source, generated = self.body(), self.body()
        source[345:375, 65:97] = 0
        source[345:375, 50:83] = 12
        generated[345:375, 65:97] = 0
        generated[345:375, 78:108] = 12
        keep, result, raw = self.prepare(source, generated)
        self.assertTrue((keep[350:370, 53:75] == 0).all())
        np.testing.assert_array_equal(result[350:370, 53:103], raw[350:370, 53:103])

    def test_unlabelled_hole_inside_body_envelope_does_not_reveal_source(self):
        source_labels, generated_labels = self.body(), self.body()
        source = self.photo(source_labels)
        generated = self.photo(generated_labels, generated=True)
        source_labels[110:165, 88:111] = 0
        generated_labels[110:165, 88:111] = 0
        keep, result, raw = self.prepare(source_labels, generated_labels, source, generated)
        self.assertTrue((keep[115:160, 92:107] == 0).all())
        np.testing.assert_array_equal(result[115:160, 92:107], raw[115:160, 92:107])

    def test_space_between_legs_uses_same_generated_scene_layer(self):
        source, generated = self.body(), self.body()
        self.assertEqual(source[300, 100], 0)
        self.assertEqual(generated[300, 100], 0)
        keep, result, raw = self.prepare(source, generated)
        self.assertEqual(keep[300, 100], 0)
        np.testing.assert_array_equal(result[265:330, 98:104], raw[265:330, 98:104])

    def test_head_and_far_background_remain_pixel_exact(self):
        source, generated = self.body(), self.body()
        keep, result, _ = self.prepare(source, generated)
        original = np.asarray(self.photo(source))
        self.assertTrue((keep[35:59, 86:110] == 255).all())
        np.testing.assert_array_equal(result[35:59, 86:110], original[35:59, 86:110])
        self.assertTrue((keep[90:350, :15] == 255).all())
        self.assertTrue((keep[90:350, 187:] == 255).all())
        np.testing.assert_array_equal(result[90:350, :15], original[90:350, :15])

    def test_off_center_person_does_not_expand_edit_across_empty_frame(self):
        source = np.pad(self.body(), ((0, 0), (160, 0)))
        generated = source.copy()
        generated[236:262, 205:225] = 0
        generated[236:262, 219:239] = 14
        x, y, w, h = self.face.box
        face = face_guard.Face((x+160, y, w, h), self.face.landmarks+[160, 0])
        keep, result, raw = self.prepare(source, generated, face=face)
        self.assertTrue((keep[90:350, :160] == 255).all())
        self.assertEqual(keep[250, 210], 0)
        np.testing.assert_array_equal(result[240:259, 208:236], raw[240:259, 208:236])

    def test_cropped_portrait_keeps_generated_body_to_bottom_edge(self):
        source, generated = self.body()[:210], self.body()[:210]
        keep, result, raw = self.prepare(source, generated, slots=('top',))
        self.assertTrue((keep[195:210, 75:125] == 0).all())
        np.testing.assert_array_equal(result[195:210, 75:125], raw[195:210, 75:125])
        self.assertTrue((keep[95:210, :15] == 255).all())

    def test_separate_bystander_does_not_join_primary_body_envelope(self):
        source, generated = self.body(), self.body()
        source[110:260, :14] = 4
        generated[110:260, :14] = 4
        keep, result, _ = self.prepare(source, generated)
        original = np.asarray(self.photo(source))
        self.assertTrue((keep[115:255, :14] == 255).all())
        np.testing.assert_array_equal(result[115:255, :14], original[115:255, :14])

    def test_no_body_warp_or_inpaint_is_used(self):
        with patch.object(cv2, 'remap', side_effect=AssertionError('body must not be warped')) as remap, \
             patch.object(cv2, 'inpaint', side_effect=AssertionError('anatomy must not be inpainted')) as inpaint:
            self.prepare(self.body(), self.body())
        remap.assert_not_called()
        inpaint.assert_not_called()

    def test_changed_slots_remain_validated(self):
        for slots in ((), ('unknown',), ('top', 'unknown')):
            with self.subTest(slots=slots), self.assertRaises(ValueError):
                self.prepare(self.body(), self.body(), slots=slots)


if __name__ == '__main__':
    unittest.main()
