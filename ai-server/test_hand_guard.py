import unittest

import numpy as np
from PIL import Image

import hand_guard

H, W = 400, 200


def scene(hand_at, hand_colour, extra_finger=False):
    """A person 360 rows tall; one arm hanging beside the body ends in a hand at `hand_at` (x)."""
    image = np.full((H, W, 3), 230, np.uint8)
    labels = np.zeros((H, W), np.uint8)
    labels[20:380, 80:120] = 4  # the body
    image[20:380, 80:120] = (40, 40, 40)
    labels[60:200, hand_at:hand_at + 12] = 14  # the arm and its hand
    image[60:200, hand_at:hand_at + 12] = hand_colour
    if extra_finger:  # the editor's second thumb, past the hand
        labels[185:200, hand_at - 6:hand_at] = 14
        image[185:200, hand_at - 6:hand_at] = hand_colour
    return Image.fromarray(image), labels


class Hands(unittest.TestCase):
    def test_the_photos_hand_replaces_the_editors_and_its_second_thumb(self):
        photo, photo_labels = scene(40, (200, 150, 120))
        frame, frame_labels = scene(43, (170, 120, 100), extra_finger=True)
        out = np.asarray(hand_guard.restore(photo, frame, photo_labels, frame_labels)).astype(int)
        self.assertLess(abs(out[192, 48] - np.array([200, 150, 120])).max(), 20, f'the photo\'s hand, got {out[192, 48]}')
        self.assertGreater(out[192, 39].min(), 200, f'the second thumb is gone, got {out[192, 39]}')
        np.testing.assert_array_equal(out[300, 100], [40, 40, 40], 'the body is untouched')

    def test_a_hand_that_moved_or_lies_on_the_body_stays_the_editors(self):
        photo, photo_labels = scene(40, (200, 150, 120))
        frame, frame_labels = scene(150, (170, 120, 100))
        self.assertTrue((np.asarray(hand_guard.restore(photo, frame, photo_labels, frame_labels)) == np.asarray(frame)).all())
        on_body, body_labels = scene(100, (200, 150, 120))
        self.assertEqual(hand_guard._hands(body_labels, 360), [], 'a hand over the body is not taken')


if __name__ == '__main__':
    unittest.main()
