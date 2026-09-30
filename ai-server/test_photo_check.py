import unittest
from io import BytesIO
from unittest.mock import patch

import numpy as np
from fastapi import HTTPException, UploadFile
from PIL import Image

import app
import face_guard
import photo_check

W, H = 60, 100
FACE_BOX = (25, 12, 10, 12)  # x, y, w, h: the chin at row 24


def figure(top=8, bottom=92, arm_top=35, shoes=True):
    """ATR labels of one standing person: hair, face, top, arms, trousers, shoes."""
    labels = np.zeros((H, W), dtype=np.uint8)
    labels[top:top + 4, 24:36] = 2
    labels[top + 4:24, 25:35] = 11
    labels[24:55, 18:42] = 4
    labels[arm_top:60, 12:18] = 14
    labels[35:60, 42:48] = 15
    labels[55:bottom, 20:40] = 6
    if shoes:
        labels[bottom - 4:bottom, 20:40] = 9
    return labels


def face(box=FACE_BOX):
    return face_guard.Face(box, np.zeros((5, 2)))


class Rules(unittest.TestCase):
    def check(self, labels, faces=(face(),)):
        with patch.object(photo_check.footwear_guard, 'parse', return_value=labels), \
                patch.object(photo_check.face_guard, 'detect_faces', return_value=list(faces)):
            return photo_check.issues(Image.new('RGB', (W, H)))

    def test_a_good_photo_has_nothing_to_say(self):
        self.assertEqual(self.check(figure()), [])

    def test_a_hand_raised_to_the_hair_is_noticed(self):
        # A hand at the hair spoiled the jacket in every run of the photo test.
        self.assertEqual(self.check(figure(arm_top=14)), ['arms'])

    def test_feet_cut_off_at_the_bottom_are_noticed(self):
        self.assertEqual(self.check(figure(bottom=H, shoes=False)), ['feet'])

    def test_shoes_that_touch_the_edge_but_show_are_fine(self):
        self.assertEqual(self.check(figure(bottom=H)), [])

    def test_a_cut_off_head_is_noticed(self):
        self.assertEqual(self.check(figure(top=0)), ['head'])
        self.assertEqual(self.check(figure(top=0), faces=()), ['face'], 'without a face, one request only')

    def test_several_people_are_noticed(self):
        self.assertEqual(self.check(figure(), faces=(face(), face((5, 12, 10, 12)))), ['people'])

    def test_a_far_away_figure_is_noticed(self):
        labels = np.zeros((H, W), dtype=np.uint8)
        labels[40:82] = figure()[8:92:2]
        self.assertIn('small', self.check(labels, faces=(face((25, 42, 5, 6)),)))

    def test_an_empty_photo_has_no_person(self):
        self.assertEqual(self.check(np.zeros((H, W), dtype=np.uint8), faces=()), ['person'])

    def test_without_a_face_only_the_face_is_asked_for(self):
        # Clothes on a hanger or a turned-away person: nothing else can be judged.
        labels = np.zeros((H, W), dtype=np.uint8)
        labels[20:70, 10:50] = 4
        self.assertEqual(self.check(labels, faces=()), ['face'])
        self.assertEqual(self.check(figure(bottom=H, shoes=False, arm_top=14), faces=()), ['face'])

    def test_a_small_face_is_looked_at_again_at_the_heads_scale(self):
        found = []
        def detect(image, region=None):
            found.append(region)
            return [face()] if region else []
        with patch.object(photo_check.footwear_guard, 'parse', return_value=figure()), \
                patch.object(photo_check.face_guard, 'detect_faces', side_effect=detect):
            self.assertEqual(photo_check.issues(Image.new('RGB', (W, H))), [])
        self.assertIsNone(found[0])
        self.assertIsNotNone(found[1], 'the second look is at the face region')

    def test_a_bare_torso_labelled_as_face_is_not_a_raised_arm(self):
        # The chin comes from the face box, not from the parser's face label.
        labels = figure()
        labels[24:50, 18:42] = 11
        self.assertEqual(self.check(labels), [])


def upload(image=True):
    data = BytesIO()
    if image:
        Image.new('RGB', (40, 80), 'white').save(data, format='JPEG')
    else:
        data.write(b'not an image')
    data.seek(0)
    return UploadFile(file=data, filename='person.jpg')


class Endpoint(unittest.TestCase):
    def test_the_endpoint_returns_the_issues_and_keeps_nothing(self):
        with patch.object(app.access, 'throttle') as throttle, \
                patch.object(app.photo_check, 'issues', return_value=['arms']) as issues:
            self.assertEqual(app.tryon_photo_check(upload(), device='masha'), {'issues': ['arms']})
        throttle.assert_called_once_with('masha', 'photo-check', 10)
        self.assertLessEqual(max(issues.call_args.args[0].size), photo_check.MAX_SIDE)

    def test_a_file_that_is_no_photo_is_refused(self):
        with patch.object(app.access, 'throttle'), self.assertRaises(HTTPException) as refused:
            app.tryon_photo_check(upload(image=False), device='masha')
        self.assertEqual(refused.exception.status_code, 422)


if __name__ == '__main__':
    unittest.main()
