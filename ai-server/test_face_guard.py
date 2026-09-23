import unittest
from unittest.mock import Mock, patch

import cv2
import numpy as np
from PIL import Image

import face_guard


def face(box=(180., 64., 40., 50.), offset=(0, 0)):
    points = np.array([[187, 80], [213, 80], [200, 91], [190, 103], [210, 103]], dtype=float)
    return face_guard.Face(box, points + offset)


class LandmarkAlignment(unittest.TestCase):
    def test_box_noise_does_not_reject_a_stationary_face(self):
        source = face()
        # The old width/height and centre checks rejected this unchanged head.
        noisy = face(box=(174, 58, 56, 70))
        matrix = face_guard.alignment_transform(source, noisy, (400, 800))
        np.testing.assert_allclose(matrix, [[1, 0, 0], [0, 1, 0]], atol=1e-5)

    def test_small_shift_is_corrected_instead_of_rejected(self):
        source = face()
        generated = face(offset=(10, 8))
        matrix = face_guard.alignment_transform(source, generated, (400, 800))
        np.testing.assert_allclose(generated.landmarks @ matrix[:, :2].T + matrix[:, 2], source.landmarks, atol=1e-5)

    def test_small_uniform_zoom_is_corrected(self):
        source = face()
        points = (source.landmarks - [200, 90]) * 1.04 + [200, 90]
        matrix = face_guard.alignment_transform(source, face_guard.Face(source.box, points), (400, 800))
        np.testing.assert_allclose(points @ matrix[:, :2].T + matrix[:, 2], source.landmarks, atol=1e-4)

    def test_large_movement_still_fails(self):
        with self.assertRaisesRegex(face_guard.AlignmentError, 'large-displacement'):
            face_guard.alignment_transform(face(), face(offset=(45, 0)), (400, 800))

    def test_large_zoom_and_rotation_still_fail(self):
        source = face()
        for scale, angle in [(1.4, 0), (1, 20)]:
            matrix = cv2.getRotationMatrix2D((200, 90), angle, scale)
            points = source.landmarks @ matrix[:, :2].T + matrix[:, 2]
            with self.subTest(scale=scale, angle=angle), self.assertRaises(face_guard.AlignmentError):
                face_guard.alignment_transform(source, face_guard.Face(source.box, points), (400, 800))

    def test_invalid_landmarks_fail_closed(self):
        source = face()
        for points in [np.zeros((5, 2)), np.full((5, 2), np.nan), np.zeros((3, 2))]:
            with self.assertRaises(face_guard.AlignmentError):
                face_guard.alignment_transform(source, face_guard.Face(source.box, points), (400, 800))

    def test_nonrigid_landmarks_fail_closed(self):
        source = face()
        points = source.landmarks.copy()
        points[2] += [9, 0]
        with self.assertRaisesRegex(face_guard.AlignmentError, 'inconsistent-landmarks'):
            face_guard.alignment_transform(source, face_guard.Face(source.box, points), (400, 800))


class DetectionAndWarp(unittest.TestCase):
    def test_missed_face_is_retried_in_head_crop(self):
        original = Image.new('RGB', (400, 800), 'red')
        generated = Image.new('RGB', original.size, 'green')
        with patch.object(face_guard, 'detect_faces', side_effect=[[], [face()]]) as detect:
            result = face_guard.align_to_source(original, generated, face())
        self.assertEqual(detect.call_count, 2)
        self.assertIn('region', detect.call_args.kwargs)
        np.testing.assert_array_equal(result, generated)

    def test_missing_or_ambiguous_face_is_not_accepted(self):
        image = Image.new('RGB', (400, 800))
        for detections in [[], [face(), face(offset=(70, 0))]]:
            with patch.object(face_guard, 'detect_faces', return_value=detections), self.assertRaises(face_guard.AlignmentError):
                face_guard.align_to_source(image, image, face())

    def test_crop_detection_returns_full_frame_coordinates(self):
        row = np.array([20, 30, 50, 60, 25, 35, 60, 35, 45, 50, 30, 65, 55, 65, .99])
        detector = Mock()
        detector.detect.return_value = (None, np.array([row]))
        with patch.object(face_guard, '_detector', detector):
            detected = face_guard.detect_faces(Image.new('RGB', (400, 800)), region=(100, 50, 260, 290))[0]
        scale = np.array(detector.setInputSize.call_args.args[0]) / (160, 240)
        np.testing.assert_allclose(detected.landmarks, row[4:14].reshape(5, 2) / scale + (100, 50))
        np.testing.assert_allclose(detected.box[:2], row[:2] / scale + (100, 50))

    def test_warp_moves_only_generated_pixels_and_restores_missing_edges(self):
        original = Image.new('RGB', (400, 800), (30, 40, 50))
        generated = Image.new('RGB', original.size, (10, 200, 20))
        generated.putpixel((210, 408), (240, 80, 70))
        with patch.object(face_guard, 'detect_faces', return_value=[face(offset=(10, 8))]):
            result = face_guard.align_to_source(original, generated, face())
        np.testing.assert_array_equal(original, Image.new('RGB', original.size, (30, 40, 50)))
        self.assertEqual(result.getpixel((200, 400)), (240, 80, 70))
        self.assertEqual(result.getpixel((399, 799)), original.getpixel((399, 799)))


if __name__ == '__main__':
    unittest.main()
