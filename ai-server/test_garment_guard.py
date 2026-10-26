import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

import app
import face_guard
import footwear_guard
import garment_guard
import image_color
from test_footwear_guard import labels
from test_tryon_quality import photo_bytes
from test_face_guard import face


class GarmentRegions(unittest.TestCase):
    def test_small_exposed_hand_is_protected_even_when_generated_coat_covers_it(self):
        source = np.zeros((800, 400), dtype=np.uint8)
        source[380:420, 260:280] = 15
        mask = np.asarray(garment_guard.hand_keep_mask(source, [face()]))
        self.assertTrue((mask[380:420, 260:280] == 255).all())

    def test_large_bare_arm_is_not_pasted_over_new_long_sleeves(self):
        source = np.zeros((800, 400), dtype=np.uint8)
        source[180:420, 260:290] = 15
        mask = np.asarray(garment_guard.hand_keep_mask(source, [face()]))
        self.assertFalse(mask.any())

    def test_skin_neck_shoes_and_background_keep_original_pixels(self):
        source = labels()
        source[55:80, 95:105] = 11
        source[100:200, 55:65] = 14
        generated = source.copy()
        mask = np.asarray(garment_guard.keep_mask(source, generated, ['top', 'bottom', 'long_outer']))
        self.assertTrue((mask[np.isin(source, [11, 14, 9, 10])] == 255).all())
        self.assertTrue((mask[:, :40] == 255).all())
        self.assertEqual(mask[150, 100], 0)
        self.assertEqual(mask[300, 80], 0)

    def test_old_collar_and_sleeve_can_be_removed_to_reveal_skin(self):
        source = labels()
        generated = source.copy()
        generated[65:80, 90:110] = 11
        generated[160:230, 60:70] = 14
        mask = np.asarray(garment_guard.keep_mask(source, generated, ['top']))
        self.assertEqual(mask[72, 100], 0)
        self.assertEqual(mask[200, 65], 0)

    def test_existing_skin_can_be_covered_by_new_fabric(self):
        source = labels()
        source[80:200, 60:70] = 14
        generated = source.copy()
        generated[80:200, 60:70] = 4
        mask = np.asarray(garment_guard.keep_mask(source, generated, ['outer']))
        self.assertEqual(mask[100, 65], 0)

    def test_top_does_not_repaint_unchanged_trousers(self):
        source = labels()
        generated = source.copy()
        mask = np.asarray(garment_guard.keep_mask(source, generated, ['top']))
        self.assertTrue((mask[source == 6] == 255).all())

    def test_belt_changes_with_trousers_but_not_with_shoes(self):
        source = labels()
        source[220:228, 70:135] = 8
        shoes = np.asarray(garment_guard.keep_mask(source, source, ['shoes']))
        bottom = np.asarray(garment_guard.keep_mask(source, source, ['bottom']))
        self.assertTrue((shoes[source == 8] == 255).all())
        self.assertTrue((bottom[source == 8] == 0).all())

    def test_both_original_and_shifted_shoe_footprints_are_restored(self):
        source = labels()
        generated = source.copy()
        generated[350:380, 65:98] = 0
        generated[350:380, 82:115] = 9
        mask = np.asarray(garment_guard.keep_mask(source, generated, ['bottom']))
        shoes = np.asarray(footwear_guard.keep_mask(source, generated, ['bottom']))
        self.assertTrue((np.maximum(mask, shoes)[360:380, 65:115] == 255).all())

    def test_shoe_pixels_at_trouser_edge_are_not_exposed_by_dilation(self):
        source = labels()
        mask = np.asarray(footwear_guard.keep_mask(source, source, ['bottom']))
        self.assertEqual(mask[350, 80], 255)

    def test_floor_length_hem_can_occlude_shoe_without_changing_other_foot(self):
        source = labels()
        generated = source.copy()
        generated[230:399, 70:95] = 4
        mask = np.asarray(garment_guard.keep_mask(source, generated, ['long_outer']))
        self.assertEqual(mask[375, 80], 0)
        self.assertEqual(mask[375, 125], 255)

    def test_empty_or_unknown_garment_region_fails_closed(self):
        for slots in [[], ['bag'], ['top']]:
            with self.subTest(slots=slots), self.assertRaises(ValueError):
                garment_guard.keep_mask(labels(), np.zeros_like(labels()), slots)


class SourceLighting(unittest.TestCase):
    def test_pink_cast_is_removed_without_using_new_garment_colors(self):
        rng = np.random.default_rng(12)
        pixels = rng.integers(50, 180, (400, 200, 3), dtype=np.uint8)
        source = Image.fromarray(pixels)
        expected = pixels.copy()
        expected[labels() == 4] = [30, 50, 90]
        generated = Image.fromarray((expected.astype(int) + [12, -8, 9]).astype(np.uint8))
        result = image_color.match_source_lighting(source, generated, labels(), labels())
        np.testing.assert_array_equal(result, expected)

    def test_no_cast_does_not_regrade_a_new_colorful_garment(self):
        source = Image.new('RGB', (200, 400), (130, 140, 150))
        generated = np.asarray(source).copy()
        generated[labels() == 4] = [220, 20, 70]
        generated = Image.fromarray(generated)
        result = image_color.match_source_lighting(source, generated, labels(), labels())
        np.testing.assert_array_equal(result, generated)

    def test_newly_exposed_neck_matches_original_skin_not_generated_face(self):
        source = Image.new('RGB', (200, 400), (120, 130, 140))
        pixels = np.asarray(source).copy()
        pixels[labels() == 11] = [170, 135, 110]
        source = Image.fromarray(pixels)
        generated_labels = labels()
        generated_labels[65:80, 90:110] = 11
        generated = pixels.copy()
        generated[generated_labels == 11] = [190, 125, 123]
        result = image_color.match_source_lighting(source, Image.fromarray(generated), labels(), generated_labels)
        self.assertEqual(result.getpixel((100, 70)), (170, 135, 110))


class IntegratedComposite(unittest.TestCase):
    def test_shifted_generated_hand_does_not_receive_a_second_source_hand(self):
        source_labels = labels()
        source_labels[200:225, 140:152] = 15
        generated_labels = source_labels.copy()
        generated_labels[200:225, 140:152] = 4
        generated_labels[203:228, 148:160] = 15
        source = Image.new('RGB', (200, 400), (160, 130, 110))
        generated = Image.new('RGB', source.size, (30, 35, 40))
        generated.paste((175, 140, 115), (148, 203, 160, 228))
        cutout = garment_guard.silhouette(source, source_labels)
        source_face = face_guard.Face((85, 25, 30, 40), np.array([[92, 37], [108, 37], [100, 45], [94, 54], [106, 54]], dtype=float))
        with patch.object(face_guard, 'detect_faces', return_value=[source_face]), \
             patch.object(footwear_guard, 'parse', return_value=generated_labels), \
             patch.object(image_color, 'match_source_lighting', side_effect=lambda source, generated, *_: generated):
            result, status = app._apply_identity_lock(photo_bytes(source), generated,
                ['long_outer'], (source, cutout, [source_face], source_labels))
        self.assertEqual(status, 'composed')
        np.testing.assert_array_equal(np.asarray(result)[200:228, 140:160], np.asarray(generated)[200:228, 140:160])

    def test_source_reuses_one_parsing_pass_and_does_not_run_rembg(self):
        source = Image.new('RGB', (200, 400), (120, 130, 140))
        with patch.object(face_guard, 'detect_faces', return_value=['face']), \
             patch.object(footwear_guard, 'parse', return_value=labels()) as parse, \
             patch.object(app, '_silhouette') as rembg:
            prepared = app._prepare_identity_source(photo_bytes(source))
        parse.assert_called_once()
        rembg.assert_not_called()
        self.assertEqual(len(prepared), 4)

    def test_a_photo_read_for_one_look_is_reused_for_the_next(self):
        app._IDENTITY_SOURCES.clear()
        source = Image.new('RGB', (200, 400), (90, 100, 110))
        try:
            with patch.object(face_guard, 'detect_faces', return_value=['face']), \
                 patch.object(footwear_guard, 'parse', side_effect=lambda image: labels()) as parse:
                first = app._prepare_identity_source(photo_bytes(source), cached=True)
                # What one look does to its copy never reaches the next look.
                first[3][:] = 0
                first[0].paste((0, 0, 0), (0, 0, 200, 400))
                second = app._prepare_identity_source(photo_bytes(source), cached=True)
                again = app._prepare_identity_source(photo_bytes(source), app._prepare_identity_source(photo_bytes(source), faces_only=True, cached=True),
                                                     cached=True)
            parse.assert_called_once()
            np.testing.assert_array_equal(second[3], labels())
            self.assertEqual(second[0].getpixel((5, 5)), (90, 100, 110))
            self.assertEqual(second[2], ['face'])
            self.assertEqual(second[1].size, (200, 400))
            np.testing.assert_array_equal(np.asarray(again[1]), np.asarray(second[1]))
        finally:
            app._IDENTITY_SOURCES.clear()

    def test_a_known_photos_face_check_hands_out_a_copy(self):
        app._IDENTITY_SOURCES.clear()
        source = photo_bytes(Image.new('RGB', (200, 400), (90, 100, 110)))
        try:
            with patch.object(face_guard, 'detect_faces', return_value=['face']), \
                 patch.object(footwear_guard, 'parse', side_effect=lambda image: labels()):
                app._prepare_identity_source(source, cached=True)
                photo, faces = app._prepare_identity_source(source, faces_only=True, cached=True)
                photo.paste((0, 0, 0), (0, 0, 200, 400))
                faces.append('another')
                again = app._prepare_identity_source(source, cached=True)
            self.assertEqual(again[0].getpixel((5, 5)), (90, 100, 110))
            self.assertEqual(again[2], ['face'])
        finally:
            app._IDENTITY_SOURCES.clear()

    def test_a_kept_photo_is_forgotten_after_its_time_and_with_its_account(self):
        app._IDENTITY_SOURCES.clear()
        source = photo_bytes(Image.new('RGB', (200, 400), (90, 100, 110)))
        other = photo_bytes(Image.new('RGB', (200, 400), (10, 100, 110)))
        clock = [1000.0]
        try:
            with patch.object(app, '_identity_now', side_effect=lambda: clock[0]), \
                 patch.object(face_guard, 'detect_faces', return_value=['face']), \
                 patch.object(footwear_guard, 'parse', side_effect=lambda image: labels()):
                app._prepare_identity_source(source, cached=True, owner='masha')
                app._prepare_identity_source(other, cached=True, owner='anna')
                self.assertTrue(app._identity_known(source))
                app._forget_identity_sources('masha')
                self.assertFalse(app._identity_known(source))
                self.assertTrue(app._identity_known(other))
                clock[0] += app._identity_sources_ttl() + 1
                self.assertFalse(app._identity_known(other))
                self.assertEqual(len(app._IDENTITY_SOURCES), 0)
        finally:
            app._IDENTITY_SOURCES.clear()

    def test_a_photo_is_read_only_when_asked_to_keep_it(self):
        app._IDENTITY_SOURCES.clear()
        with patch.object(face_guard, 'detect_faces', return_value=['face']), \
             patch.object(footwear_guard, 'parse', side_effect=lambda image: labels()) as parse:
            for _ in range(2):
                app._prepare_identity_source(photo_bytes(Image.new('RGB', (200, 400), (90, 100, 110))))
        self.assertEqual(parse.call_count, 2)
        self.assertEqual(len(app._IDENTITY_SOURCES), 0)

    def test_the_face_is_checked_first_and_the_parsing_done_later(self):
        source = photo_bytes(Image.new('RGB', (200, 400), (90, 100, 110)))
        with patch.object(face_guard, 'detect_faces', return_value=['face']) as detect, \
             patch.object(footwear_guard, 'parse', return_value=labels()) as parse:
            photo = app._prepare_identity_source(source, faces_only=True)
            parse.assert_not_called()
            prepared = app._prepare_identity_source(source, photo)
        detect.assert_called_once()
        parse.assert_called_once()
        self.assertEqual(len(prepared), 4)

    def test_a_photo_without_one_face_is_refused_at_the_face_check(self):
        with patch.object(face_guard, 'detect_faces', return_value=[]), patch.object(footwear_guard, 'parse') as parse:
            with self.assertRaisesRegex(ValueError, 'одного человека'):
                app._prepare_identity_source(photo_bytes(Image.new('RGB', (200, 400))), faces_only=True)
        parse.assert_not_called()

    def test_source_parser_failure_is_reported_to_the_caller(self):
        with patch.object(face_guard, 'detect_faces', return_value=['face']), \
             patch.object(footwear_guard, 'parse', side_effect=RuntimeError('model unavailable')):
            with self.assertRaisesRegex(ValueError, 'защиту лица и обуви'):
                app._prepare_identity_source(photo_bytes(Image.new('RGB', (200, 400))))

    def test_three_garments_keep_head_far_background_and_coherent_body_color(self):
        source_labels = labels()
        source_labels[55:85, 92:108] = 11
        pixels = np.random.default_rng(18).integers(70, 180, (400, 200, 3), dtype=np.uint8)
        source = Image.fromarray(pixels)
        expected = pixels.copy()
        expected[np.isin(source_labels, [4, 6])] = [35, 50, 65]
        expected[np.isin(source_labels, [9, 10])] = [55, 65, 75]
        generated = Image.fromarray((expected.astype(int) + [10, -6, 8]).astype(np.uint8))
        cutout = source.convert('RGBA')
        cutout.putalpha(Image.fromarray((source_labels > 0).astype(np.uint8) * 255))
        face = face_guard.Face((85, 25, 30, 40), np.array([[92, 37], [108, 37], [100, 45], [94, 54], [106, 54]], dtype=float))
        with patch.object(face_guard, 'detect_faces', return_value=[face]), \
             patch.object(footwear_guard, 'parse', return_value=source_labels), \
             patch.object(app, '_silhouette', return_value=cutout):
            result, status = app._apply_identity_lock(photo_bytes(source), generated,
                ['bottom', 'top', 'long_outer'], (source, cutout, [face], source_labels))
        self.assertEqual(status, 'composed')
        columns = np.arange(source.width)[None, :]
        preserved = (source_labels == 11) | (columns < 35) | (columns > 170)
        np.testing.assert_array_equal(np.asarray(result)[preserved], pixels[preserved])
        self.assertEqual(result.getpixel((100, 150)), (35, 50, 65))
        self.assertEqual(result.getpixel((80, 300)), (35, 50, 65))
        self.assertEqual(result.getpixel((80, 365)), (55, 65, 75))
