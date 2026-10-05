import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

import app
import body_fit
import face_guard

W, H = 300, 400


def person(width, left=None):
    """Labels of a standing figure `width` columns wide: a head, a torso, legs."""
    labels = np.zeros((H, W), np.uint8)
    left = (W - width) // 2 if left is None else left
    labels[40:80, left + width // 3:left + 2 * width // 3] = 11
    labels[80:220, left:left + width] = 4
    labels[220:380, left + width // 6:left + 5 * width // 6] = 6
    return labels


class Measure(unittest.TestCase):
    def test_a_body_drawn_wider_is_brought_back_to_the_photos_width(self):
        factor, zone = body_fit.measure(person(60), person(66))
        self.assertAlmostEqual(factor, 60 / 66, places=2)
        self.assertLessEqual(zone[0], (W - 66) // 2 + 1)
        self.assertGreaterEqual(zone[1], (W + 66) // 2 - 2)

    def test_a_body_as_wide_as_the_photo_is_left_alone(self):
        self.assertEqual(body_fit.measure(person(60), person(60)), (1.0, None))
        self.assertEqual(body_fit.measure(person(60), person(56)), (1.0, None), 'never made wider')

    def test_the_correction_is_bounded(self):
        factor, _zone = body_fit.measure(person(50), person(80))
        self.assertAlmostEqual(factor, 1 - body_fit.MAX_SQUEEZE)

    def test_bulky_clothes_keep_some_volume(self):
        self.assertEqual(body_fit.allowance(['Футболка', 'Юбка']), 1.0)
        self.assertEqual(body_fit.allowance(['Свитер', '']), body_fit.BULKY_ALLOWANCE)
        self.assertEqual(body_fit.measure(person(60), person(62), body_fit.BULKY_ALLOWANCE), (1.0, None))

    def test_a_body_filling_the_frame_is_left_alone(self):
        self.assertEqual(body_fit.measure(person(230), person(250)), (1.0, None))

    def test_no_person_no_change(self):
        empty = np.zeros((H, W), np.uint8)
        self.assertEqual(body_fit.measure(empty, person(60)), (1.0, None))
        self.assertEqual(body_fit.measure(person(60), np.zeros((H, W + 2), np.uint8)), (1.0, None))


class Narrow(unittest.TestCase):
    def frame(self, labels):
        image = np.full((H, W, 3), 230, np.uint8)
        image[:, 20:24] = (40, 40, 200)  # a door frame on the left
        image[labels > 0] = (30, 30, 30)
        return Image.fromarray(image)

    def test_the_body_narrows_and_the_frame_keeps_its_size(self):
        labels = person(66)
        factor, zone = body_fit.measure(person(60), labels)
        image, narrowed = body_fit.narrow(self.frame(labels), labels, factor, zone)
        self.assertEqual(image.size, (W, H))
        torso = (np.asarray(image)[150] < 100).all(axis=1).sum()
        self.assertLess(abs(torso - 60), 3, f'torso {torso} columns, the photo has 60')
        self.assertLess(abs((narrowed[150] > 0).sum() - 60), 3, 'labels follow the frame')

    def test_vertical_lines_stay_straight(self):
        labels = person(66)
        factor, zone = body_fit.measure(person(60), labels)
        image = np.asarray(body_fit.narrow(self.frame(labels), labels, factor, zone)[0])
        columns = [tuple(np.where(image[row, :60, 2] > 150)[0]) for row in (5, 150, 395)]
        self.assertEqual(len(set(columns)), 1, 'the door frame is the same columns at every height')


    def test_the_head_keeps_its_width_and_the_shoulders_narrow(self):
        labels = person(66)
        factor, zone = body_fit.measure(person(60), labels)
        # The face box comes as floats, as face_guard returns it.
        image = np.asarray(body_fit.narrow(self.frame(labels), labels, factor, zone, chin=np.float64(80), neck=np.float64(30))[0])
        dark = lambda row: (image[row] < 100).all(axis=1).sum()
        self.assertEqual(dark(60), 22, 'the head as drawn')
        self.assertLess(abs(dark(150) - 60), 3, 'the torso at the photo\'s width')


class Walls(unittest.TestCase):
    def test_a_door_frame_stays_straight_however_the_body_narrows(self):
        # Narrowed only below the chin, the scene bent both door frames at the shoulders.
        labels = person(66)
        image = np.full((H, W, 3), 230, np.uint8)
        image[:, 100:104] = (40, 40, 200)  # a door frame close to the body
        image[:, 250:254] = (40, 40, 200)  # and one further out
        image[labels > 0] = (30, 30, 30)
        factor, zone = body_fit.measure(person(60), labels)
        out = np.asarray(body_fit.narrow(Image.fromarray(image), labels, factor, zone, chin=80, neck=30)[0])
        for start in (90, 240):
            columns = {tuple(np.where((out[row, start:start + 30, 2] > 150) & (out[row, start:start + 30, 0] < 100))[0]) for row in (10, 60, 150, 300, 395)}
            self.assertEqual(len(columns), 1, f'the frame near {start} keeps its columns at every height: {columns}')
        self.assertEqual((out[60] < 100).all(axis=1).sum(), 22, 'the head as drawn')
        self.assertLess(abs((out[150] < 100).all(axis=1).sum() - 60), 3, 'the torso at the photo\'s width')


class Restore(unittest.TestCase):
    def test_the_face_goes_onto_the_narrowed_frame(self):
        labels = person(60)
        prepared = (Image.new('RGB', (W, H)), None, [face_guard.Face((120, 40, 40, 40), np.zeros((5, 2)))], labels)
        seen = []

        def transplant(original, framed, face, source_labels, generated_labels, relaxed=False):
            seen.append((generated_labels[150] > 0).sum())
            return framed
        with patch.object(app.footwear_guard, 'parse', return_value=person(66)), \
                patch.object(app.face_guard, 'transplant_face', side_effect=transplant):
            self.assertTrue(app._face_restored_output_url(Image.new('RGB', (W, H)), prepared, 1.0))
            self.assertLess(abs(seen[-1] - 60), 3, 'the face is placed on the refitted body')
            app._face_restored_output_url(Image.new('RGB', (W, H)), prepared)
            self.assertEqual(seen[-1], 66, 'without an allowance (FASHN) the frame stays as made')
            with patch.dict('os.environ', {'TRYON_BODY_FIT': 'off'}):
                app._face_restored_output_url(Image.new('RGB', (W, H)), prepared, 1.0)
            self.assertEqual(seen[-1], 66, 'it can be switched off')


if __name__ == '__main__':
    unittest.main()
