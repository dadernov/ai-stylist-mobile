import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

import face_guard
import tryon_matte
import tryon_policy
import tryon_reference
from test_footwear_guard import labels


class Matte(unittest.TestCase):
    def setUp(self):
        self.face = face_guard.Face((85, 25, 30, 40), np.array([[92, 37], [108, 37], [100, 45], [94, 54], [106, 54]], float))

    def test_shoe_selection_does_not_restore_original_shoes(self):
        image = Image.new('RGB', (200, 400), (100, 100, 100))
        _, keep, _ = tryon_matte.prepare(image, image, labels(), labels(), [self.face], ['shoes'])
        keep = np.asarray(keep)
        self.assertTrue((keep[np.isin(labels(), [9, 10])] == 0).all())
        self.assertTrue((keep[labels() == 4] == 0).all())
        self.assertTrue((keep[labels() == 11] == 255).all())

    def test_long_hem_may_cover_source_shoes(self):
        source, generated = labels(), labels()
        generated[180:, 60:150] = 4
        image = Image.new('RGB', (200, 400), (100, 100, 100))
        _, keep, _ = tryon_matte.prepare(image, image, source, generated, [self.face], ['long_outer'])
        self.assertEqual(keep.getpixel((80, 375)), 0)

    def test_other_person_at_photo_edge_is_unchanged(self):
        source, generated = labels(), labels()
        source[150:220, :15] = 4
        image = Image.new('RGB', (200, 400), (100, 100, 100))
        before = source.copy()
        _, keep, _ = tryon_matte.prepare(image, image, source, generated, [self.face], ['top', 'bottom'])
        self.assertTrue((np.asarray(keep)[150:220, :15] == 255).all())
        np.testing.assert_array_equal(source, before)

    def test_unknown_slots_fail_without_guessing_a_mask(self):
        with self.assertRaises(ValueError):
            tryon_matte.prepare(None, None, None, None, [], ['bag'])

    def test_old_white_cuff_is_not_reinserted_around_generated_hand(self):
        source_labels = labels()
        source_labels[200:225, 140:153] = 15
        generated_labels = source_labels.copy()
        generated_labels[190:205, 140:153] = 4
        generated_labels[205:230, 140:153] = 15
        source = Image.new('RGB', (200, 400), (120, 130, 140))
        source.paste((245, 245, 245), (140, 190, 153, 200))
        source.paste((170, 130, 100), (140, 200, 153, 225))
        generated = Image.new('RGB', source.size, (30, 40, 50))
        generated.paste((175, 140, 115), (140, 205, 153, 230))
        with patch.object(tryon_matte.image_color, 'match_source_lighting',
                          side_effect=lambda source, generated, *_: generated):
            layer, keep, _ = tryon_matte.prepare(source, generated, source_labels,
                                                generated_labels, [self.face], ['top'])
        result = np.asarray(Image.composite(source, layer, keep))
        np.testing.assert_array_equal(result[190:230, 140:153], np.asarray(generated)[190:230, 140:153])


class References(unittest.TestCase):
    def test_three_item_board_keeps_full_long_coat_and_print(self):
        images = {'top': Image.new('RGB', (300, 400), 'red'), 'bottom': Image.new('RGB', (200, 500), 'blue'),
                  'outer': Image.new('RGB', (300, 600), 'green')}
        board, positions = tryon_reference.build(images)
        self.assertEqual(board.size, (2048, 2048))
        self.assertEqual(positions, {'top': 'upper left', 'bottom': 'lower left', 'outer': 'right'})
        self.assertEqual(board.getpixel((512, 512)), (255, 0, 0))
        self.assertEqual(board.getpixel((512, 1536)), (0, 0, 255))
        self.assertEqual(board.getpixel((1536, 2000)), (0, 128, 0))

    def test_two_and_four_items_have_distinct_positions(self):
        for slots in [('outer', 'shoes'), ('top', 'bottom', 'outer', 'shoes')]:
            _, positions = tryon_reference.build({slot: Image.new('RGB', (40, 80)) for slot in slots})
            self.assertEqual(set(positions), set(slots))
            self.assertEqual(len(set(positions.values())), len(slots))

    def test_prompt_respects_tuck_open_coat_and_selected_shoes(self):
        for tuck, expected in [('tucked', 'Fully tuck'), ('untucked', 'completely untucked')]:
            prompt = tryon_reference.prompt({'top': 'left', 'outer': 'right'}, 'Футболка', 'Плащ', tuck)
            self.assertIn(expected, prompt)
            self.assertIn('fully open and unfastened', prompt)
            self.assertIn(tryon_policy.FOOTWEAR, prompt)
            self.assertIn('Keep bare feet bare.', prompt)
            self.assertIn('Shoes or slippers lying on the floor are background', prompt)
        self.assertNotIn(tryon_policy.FOOTWEAR, tryon_reference.prompt({'top': 'left', 'shoes': 'right'}))

    def test_transparent_references_use_white_not_black(self):
        board, _ = tryon_reference.build({'top': Image.new('RGBA', (40, 80), (0, 0, 0, 0)), 'bottom': Image.new('RGB', (40, 80), 'blue')})
        self.assertEqual(board.getpixel((512, 1024)), (255, 255, 255))
