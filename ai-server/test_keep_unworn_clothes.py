import unittest

import tryon_policy as p

KEEP_LOWER = 'lower-body garment the person wears in image 1'
KEEP_UPPER = 'upper-body garment the person wears in image 1'


class KeepUnwornClothesTest(unittest.TestCase):
    def test_top_only_keeps_photo_bottom(self):
        text = p.look_prompt(['top'], 'Футболка')
        self.assertIn(KEEP_LOWER, text)
        self.assertNotIn(KEEP_UPPER, text)

    def test_bottom_only_keeps_photo_top(self):
        text = p.look_prompt(['bottom'])
        self.assertIn(KEEP_UPPER, text)
        self.assertNotIn(KEEP_LOWER, text)

    def test_outerwear_only_keeps_both(self):
        text = p.look_prompt(['outer'], outer_category='Куртка')
        self.assertIn(KEEP_UPPER, text)
        self.assertIn(KEEP_LOWER, text)

    def test_one_piece_replaces_both(self):
        text = p.look_prompt(['top'], 'Платье')
        self.assertNotIn(KEEP_UPPER, text)
        self.assertNotIn(KEEP_LOWER, text)

    def test_full_look_keeps_nothing(self):
        text = p.look_prompt(['top', 'bottom', 'shoes'], 'Футболка')
        self.assertNotIn(KEEP_UPPER, text)
        self.assertNotIn(KEEP_LOWER, text)

    def test_unordered_bag_removed(self):
        self.assertIn('bag', p.look_prompt(['top'], 'Футболка').split('Remove')[-1].lower())


if __name__ == '__main__':
    unittest.main()
