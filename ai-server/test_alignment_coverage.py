"""Missing warped pixels must never be repaired with original body fragments."""
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

import app
import face_guard
import garment_guard
import tryon_matte
from test_footwear_guard import labels
from test_tryon_quality import photo_bytes


class Coverage(unittest.TestCase):
    def setUp(self):
        self.keep = Image.new('L', (80, 100), 255)
        self.keep.paste(0, (25, 30, 55, 95))
        self.coverage = Image.new('L', self.keep.size, 255)

    def test_uncovered_body_is_rejected_instead_of_pasting_source(self):
        self.coverage.paste(0, (0, 90, 80, 100))
        with self.assertRaisesRegex(ValueError, 'совместить примерку'):
            tryon_matte.require_coverage(self.coverage, self.keep)

    def test_partially_covered_body_pixel_is_not_silently_accepted(self):
        self.coverage.putpixel((40, 90), 254)
        with self.assertRaises(ValueError):
            tryon_matte.require_coverage(self.coverage, self.keep)

    def test_missing_source_only_background_is_safe(self):
        self.coverage.paste(0, (0, 0, 15, 100))
        result = tryon_matte.require_coverage(self.coverage, self.keep)
        np.testing.assert_array_equal(result, self.keep)

    def test_missing_protected_head_pixels_are_safe(self):
        self.coverage.paste(0, (25, 5, 55, 25))
        result = tryon_matte.require_coverage(self.coverage, self.keep)
        np.testing.assert_array_equal(result, self.keep)

    def test_uncovered_scenery_feather_uses_source_without_body_blending(self):
        self.keep.putpixel((24, 50), 100)
        self.keep.putpixel((24, 60), 200)
        self.coverage.putpixel((24, 50), 254)
        result = tryon_matte.require_coverage(self.coverage, self.keep)
        self.assertEqual(result.getpixel((24, 50)), 255)
        self.assertEqual(result.getpixel((24, 60)), 200)
        self.assertEqual(self.keep.getpixel((24, 50)), 100)
        self.assertEqual(result.getpixel((25, 50)), 0)

    def test_mismatched_coverage_fails_closed(self):
        with self.assertRaises(ValueError):
            tryon_matte.require_coverage(Image.new('L', (10, 10), 255), self.keep)


class IntegratedCoverage(unittest.TestCase):
    def setUp(self):
        self.labels = labels()
        self.original = Image.new('RGB', (200, 400), (100, 120, 140))
        self.generated = Image.new('RGB', self.original.size, (60, 70, 80))
        self.face = face_guard.Face(
            (85, 25, 30, 40),
            np.array([[92, 37], [108, 37], [100, 45], [94, 54], [106, 54]], float),
        )
        self.prepared = (self.original, garment_guard.silhouette(self.original, self.labels),
                         [self.face], self.labels)

    def apply(self, coverage):
        with patch.object(face_guard, 'align_to_source', return_value=(self.generated, coverage)) as align, \
             patch.object(app.footwear_guard, 'parse', return_value=self.labels), \
             patch.object(app.image_color, 'match_source_lighting', side_effect=lambda source, generated, *_: generated):
            result = app._apply_identity_lock(photo_bytes(self.original), self.generated,
                                              ['top', 'bottom'], self.prepared)
        self.assertTrue(align.call_args.kwargs['return_coverage'])
        self.assertIs(align.call_args.kwargs['source_labels'], self.labels)
        return result

    def test_missing_generated_feet_never_reach_final_composition(self):
        coverage = Image.new('L', self.original.size, 255)
        coverage.paste(0, (0, 350, 200, 400))
        with patch.object(app.tryon_composite, 'compose') as compose, \
             self.assertRaisesRegex(ValueError, 'совместить примерку'):
            self.apply(coverage)
        compose.assert_not_called()

    def test_uncovered_far_background_still_composes_from_original(self):
        coverage = Image.new('L', self.original.size, 255)
        coverage.paste(0, (0, 0, 20, 400))
        result, status = self.apply(coverage)
        self.assertEqual(status, 'composed')
        np.testing.assert_array_equal(np.asarray(result)[:, :20], np.asarray(self.original)[:, :20])
        self.assertEqual(result.getpixel((80, 365)), self.generated.getpixel((80, 365)))
