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
    def test_semantic_head_follows_neck_past_box_without_restoring_old_collar(self):
        labels = np.zeros((800, 400), dtype=np.uint8)
        labels[64:114, 180:220] = 11
        labels[114:140, 191:209] = 11
        labels[114:140, 209:235] = 4
        generated = labels.copy()
        generated[114:140, 209:235] = 11
        mask = np.asarray(face_guard.protected_head_mask(face(), (400, 800), labels, generated))
        self.assertEqual(mask[130, 200], 255, 'original neck is kept below the detector box')
        self.assertEqual(mask[130, 220], 0, 'old collar must not cover newly exposed neck')
        generated[130:140, 191:209] = 4
        mask = np.asarray(face_guard.protected_head_mask(face(), (400, 800), labels, generated))
        self.assertEqual(mask[135, 200], 0, 'new high neckline can cover the old bare neck')

    def test_head_mask_preserves_face_but_excludes_old_collar(self):
        mask = np.asarray(face_guard.protected_head_mask(face(), (400, 800)))
        self.assertTrue((mask[64:114, 180:220] == 255).all())
        for x, y in face().landmarks:
            self.assertEqual(mask[int(y), int(x)], 255)
        self.assertEqual(mask[120, 200], 0, 'neckline is not part of the protected face')
        self.assertEqual(mask[108, 230], 0, 'collar points beside the jaw must not be pasted back')
        self.assertEqual(mask[50, 200], 255, 'hair above forehead remains protected')

    def test_false_head_labels_on_body_and_background_do_not_protect_them(self):
        for label in (1, 2, 3, 11):
            with self.subTest(label=label):
                source = np.zeros((800, 400), dtype=np.uint8)
                source[64:114, 180:220] = 11
                source[160:250, 165:235] = label
                source[410:700, 175:195] = label
                source[90:120, 20:60] = label
                mask = np.asarray(face_guard.protected_head_mask(face(), (400, 800), source, source))
                self.assertTrue((mask[160:250, 165:235] == 0).all())
                self.assertTrue((mask[410:700, 175:195] == 0).all())
                self.assertTrue((mask[90:120, 20:60] == 0).all())
                self.assertTrue((mask[64:114, 180:220] == 255).all())

    def test_face_label_connected_to_torso_stops_after_neck(self):
        source = np.zeros((800, 400), dtype=np.uint8)
        source[64:350, 180:220] = 11
        mask = np.asarray(face_guard.protected_head_mask(face(), (400, 800), source, source))
        self.assertTrue((mask[64:114, 180:220] == 255).all())
        self.assertEqual(mask[130, 200], 255)
        self.assertTrue((mask[150:350, 180:220] == 0).all())

    def test_bounded_head_keeps_face_features_and_tall_wide_hair(self):
        labels = np.zeros((800, 400), dtype=np.uint8)
        labels[:75, 80:320] = 2
        labels[64:114, 180:220] = 11
        # A parser mistake inside the real face must not expose the features.
        labels[75:107, 185:215] = 4
        mask = np.asarray(face_guard.protected_head_mask(face(), (400, 800), labels, labels))
        self.assertTrue((mask[:75, :] == 255).all())
        for x, y in face().landmarks:
            self.assertEqual(mask[int(y), int(x)], 255)

    def test_box_noise_does_not_reject_a_stationary_face(self):
        source = face()
        # The old width/height and centre checks rejected this unchanged head.
        noisy = face(box=(174, 58, 56, 70))
        matrix = face_guard.alignment_transform(source, noisy, (400, 800))
        np.testing.assert_allclose(matrix, [[1, 0, 0], [0, 1, 0]], atol=1e-5)

    def test_entire_upper_frame_is_locked_even_outside_hair_polygon(self):
        for box in [(180., 64., 40., 50.), (185., 68., 32., 44.)]:
            mask = np.asarray(face_guard.protected_head_mask(face(box=box), (400, 800)))
            self.assertTrue((mask[:76, :] == 255).all())
            self.assertEqual(mask[120, 200], 0)

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

    def test_detector_jitter_cannot_overfit_three_landmarks_into_false_zoom(self):
        source = face()
        noise = np.array([[1.57361, -1.38067], [-.52488, .88329], [.84911, .75179],
                          [-1.109, -.02499], [-2.90571, -.48299]])
        points = (source.landmarks-source.landmarks.mean(axis=0))/.93 + source.landmarks.mean(axis=0) + noise
        matrix = face_guard.alignment_transform(source, face_guard.Face(source.box, points), (400, 800))
        self.assertTrue(.9 <= np.hypot(matrix[0, 0], matrix[1, 0]) <= 1.1)
        self.assertLess(np.linalg.norm(points @ matrix[:, :2].T + matrix[:, 2]-source.landmarks, axis=1).max(), 2)

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

    def test_warp_never_restores_source_limbs_in_missing_edges(self):
        original = Image.new('RGB', (400, 800), (30, 40, 50))
        generated = Image.new('RGB', original.size, (10, 200, 20))
        generated.putpixel((210, 408), (240, 80, 70))
        with patch.object(face_guard, 'detect_faces', return_value=[face(offset=(10, 8))]):
            result, coverage = face_guard.align_to_source(original, generated, face(), return_coverage=True)
        np.testing.assert_array_equal(original, Image.new('RGB', original.size, (30, 40, 50)))
        self.assertEqual(result.getpixel((200, 400)), (240, 80, 70))
        self.assertEqual(coverage.getpixel((200, 400)), 255)
        self.assertEqual(coverage.getpixel((399, 799)), 0)
        self.assertNotEqual(result.getpixel((399, 799)), original.getpixel((399, 799)))

    def test_stationary_scene_does_not_shrink_body_for_noisy_face_landmarks(self):
        original = Image.new('RGB', (400, 800), (30, 40, 50))
        generated = Image.new('RGB', original.size, (10, 200, 20))
        source = face()
        points = (source.landmarks-source.landmarks.mean(axis=0))/.93 + source.landmarks.mean(axis=0)
        enlarged = face_guard.Face(source.box, points)
        identity = np.array([[1., 0., 0.], [0., 1., 0.]])
        with patch.object(face_guard, 'detect_faces', return_value=[enlarged]), \
                patch.object(face_guard, 'background_transform', return_value=identity):
            result, coverage = face_guard.align_to_source(original, generated, source, return_coverage=True)
        np.testing.assert_array_equal(result, generated)
        self.assertTrue((np.asarray(coverage) == 255).all())

    def test_scene_alignment_does_not_skip_face_compatibility(self):
        original = Image.new('RGB', (400, 800))
        identity = np.array([[1., 0., 0.], [0., 1., 0.]])
        with patch.object(face_guard, 'detect_faces', return_value=[face(offset=(45, 0))]), \
                patch.object(face_guard, 'background_transform', return_value=identity), \
                self.assertRaisesRegex(face_guard.AlignmentError, 'large-displacement'):
            face_guard.align_to_source(original, original, face())

    def test_stationary_room_with_independently_moved_head_is_rejected(self):
        original = Image.new('RGB', (400, 800))
        identity = np.array([[1., 0., 0.], [0., 1., 0.]])
        with patch.object(face_guard, 'detect_faces', return_value=[face(offset=(10, 8))]), \
                patch.object(face_guard, 'background_transform', return_value=identity), \
                self.assertRaisesRegex(face_guard.AlignmentError, 'face-scene-disagreement'):
            face_guard.align_to_source(original, original, face())

    def test_subpixel_scene_correction_keeps_cropped_body_covered(self):
        original = Image.new('RGB', (400, 800), 'red')
        generated = Image.new('RGB', original.size, 'green')
        matrix = np.array([[1., 0., .3], [0., 1., -.6]])
        with patch.object(face_guard, 'detect_faces', return_value=[face()]), \
                patch.object(face_guard, 'background_transform', return_value=matrix):
            result, coverage = face_guard.align_to_source(original, generated, face(), return_coverage=True)
        np.testing.assert_array_equal(result, generated)
        self.assertTrue((np.asarray(coverage) == 255).all())

    def test_horizontal_shift_keeps_genuine_samples_on_bottom_row(self):
        original = Image.new('RGB', (400, 800), 'red')
        generated = Image.new('RGB', original.size, 'green')
        with patch.object(face_guard, 'detect_faces', return_value=[face(offset=(5, 0))]):
            _, coverage = face_guard.align_to_source(original, generated, face(), return_coverage=True)
        self.assertEqual(coverage.getpixel((200, 799)), 255)
        self.assertEqual(coverage.getpixel((399, 799)), 0)

    def test_face_jitter_does_not_rotate_body_into_uncovered_edges(self):
        original = Image.new('RGB', (400, 800), 'red')
        generated = Image.new('RGB', original.size, 'green')
        source = face()
        noise = np.array([[.2, -.3], [-.3, .5], [.6, -.4], [-.4, -.3], [.1, .2]])
        detected = face_guard.Face(source.box, source.landmarks+noise)
        with patch.object(face_guard, 'detect_faces', return_value=[detected]):
            result, coverage = face_guard.align_to_source(original, generated, source, return_coverage=True)
        np.testing.assert_array_equal(result, generated)
        self.assertTrue((np.asarray(coverage) == 255).all())

    def test_face_only_fallback_cannot_scale_or_rotate_body(self):
        source = face()
        centre = source.landmarks.mean(axis=0)
        points = (source.landmarks-centre)/.93 + centre + [5, 4]
        matrix = face_guard.fallback_alignment(source, face_guard.Face(source.box, points), (400, 800))
        np.testing.assert_array_equal(matrix[:, :2], np.eye(2))
        np.testing.assert_allclose(matrix[:, 2], [-5, -4])

    def test_face_only_fallback_rejects_uncertain_geometry(self):
        source = face(box=(160., 55., 80., 100.))
        source = face_guard.Face(source.box, (source.landmarks-[200, 90])*3+[200, 90])
        centre = source.landmarks.mean(axis=0)
        points = (source.landmarks-centre)/.91 + centre
        with self.assertRaisesRegex(face_guard.AlignmentError, 'uncertain-scene-registration'):
            face_guard.fallback_alignment(source, face_guard.Face(source.box, points), (400, 800))


class BackgroundAlignment(unittest.TestCase):
    def anchors(self):
        xx, yy = np.meshgrid([20, 60, 340, 380], [30, 200, 450, 650, 770])
        return np.column_stack((xx.ravel(), yy.ravel())).astype(float)

    def test_distributed_background_matches_recover_similarity_despite_outliers(self):
        source = self.anchors()
        transform = cv2.getRotationMatrix2D((200, 400), .4, 1.002)
        transform[:, 2] += [2, -3]
        generated = source @ transform[:, :2].T + transform[:, 2]
        generated[::5] += [90, 75]
        matrix = face_guard.scene_alignment(source, generated, (400, 800))
        np.testing.assert_allclose(matrix, cv2.invertAffineTransform(transform), atol=1e-4)

    def test_small_texture_patch_is_not_a_scene_anchor(self):
        points = self.anchors()/10 + [50, 600]
        self.assertIsNone(face_guard.scene_alignment(points, points, (400, 800)))

    def test_one_side_or_collinear_matches_are_not_enough(self):
        points = self.anchors()
        points[:, 0] /= 5
        self.assertIsNone(face_guard.scene_alignment(points, points, (400, 800)))
        points[:, 0] = points[:, 1]/2
        self.assertIsNone(face_guard.scene_alignment(points, points, (400, 800)))

    def test_insufficient_or_invalid_matches_fall_back(self):
        for points in [self.anchors()[:8], np.full((20, 2), np.nan)]:
            self.assertIsNone(face_guard.scene_alignment(points, points, (400, 800)))

    def test_confident_scene_geometry_outside_limits_is_rejected(self):
        source = self.anchors()
        for scale, angle in [(1.3, 0), (1, 12)]:
            transform = cv2.getRotationMatrix2D((200, 400), angle, scale)
            generated = source @ transform[:, :2].T + transform[:, 2]
            with self.assertRaisesRegex(face_guard.AlignmentError, 'large-scene-scale-or-rotation'):
                face_guard.scene_alignment(source, generated, (400, 800))

    def test_featureless_background_falls_back(self):
        original = Image.new('RGB', (400, 800), 'white')
        labels = np.zeros((800, 400), dtype=np.uint8)
        labels[60:780, 150:250] = 4
        self.assertIsNone(face_guard.background_transform(original, original, face(), labels))

    def test_real_features_exclude_person_and_align_scene(self):
        rng = np.random.default_rng(7)
        pixels = np.full((800, 400, 3), 140, dtype=np.uint8)
        for x, y in rng.integers([5, 5], [395, 795], size=(220, 2)):
            cv2.circle(pixels, (int(x), int(y)), int(rng.integers(2, 8)),
                       tuple(int(v) for v in rng.integers(0, 255, 3)), -1)
        labels = np.zeros((800, 400), dtype=np.uint8)
        labels[60:760, 150:250] = 4
        generated = cv2.warpAffine(pixels, np.array([[1., 0., 3.], [0., 1., 4.]]), (400, 800))
        generated[100:750, 155:255] = [20, 30, 40]
        matrix = face_guard.background_transform(Image.fromarray(pixels), Image.fromarray(generated), face(), labels)
        self.assertIsNotNone(matrix)
        np.testing.assert_allclose(matrix, [[1, 0, -3], [0, 1, -4]], atol=.15)


if __name__ == '__main__':
    unittest.main()


class RepaintedFaceTolerance(unittest.TestCase):
    """Measured on real provider frames: eyes stay, nose and mouth drift a few % of the face width."""

    def jittered(self, source, fraction=.06):
        points = source.landmarks.copy()
        points[2:] += [-fraction * source.box[2], -.015 * source.box[2]]
        return face_guard.Face(source.box, points)

    def test_scene_registered_head_accepts_nose_and_mouth_jitter(self):
        source = face(box=(160., 55., 150., 190.))
        source = face_guard.Face(source.box, (source.landmarks - [200, 90]) * 3.75 + [235, 150])
        identity = np.array([[1., 0., 0.], [0., 1., 0.]])
        original = Image.new('RGB', (1143, 2048))
        with patch.object(face_guard, 'detect_faces', return_value=[self.jittered(source)]), \
                patch.object(face_guard, 'background_transform', return_value=identity):
            result, coverage = face_guard.align_to_source(original, original, source, return_coverage=True)
        self.assertTrue((np.asarray(coverage) == 255).all())

    def test_five_point_fit_no_longer_rejects_the_apparent_roll_of_that_jitter(self):
        source = face(box=(160., 55., 150., 190.))
        source = face_guard.Face(source.box, (source.landmarks - [200, 90]) * 3.75 + [235, 150])
        matrix = face_guard.alignment_transform(source, self.jittered(source), (1143, 2048))
        self.assertLess(abs(np.degrees(np.arctan2(matrix[1, 0], matrix[0, 0]))), 8)

    def test_moved_or_resized_head_is_still_rejected_against_a_stationary_scene(self):
        source = face()
        for landmarks, reason in [
            (source.landmarks + [10, 8], 'face-scene-disagreement'),
            ((source.landmarks - [200, 90]) * 1.25 + [200, 90], 'face-scene-disagreement'),
            (source.landmarks @ cv2.getRotationMatrix2D((200, 90), 12, 1)[:, :2].T + cv2.getRotationMatrix2D((200, 90), 12, 1)[:, 2], 'face-scene-disagreement'),
            (source.landmarks + [45, 0], 'large-displacement'),
        ]:
            with self.subTest(reason=reason), self.assertRaisesRegex(face_guard.AlignmentError, reason):
                face_guard.head_agreement(source, landmarks, (400, 800))

    def test_face_only_fallback_absorbs_jitter_as_translation_but_not_zoom(self):
        source = face(box=(160., 55., 150., 190.))
        source = face_guard.Face(source.box, (source.landmarks - [200, 90]) * 3.75 + [235, 150])
        jittered = self.jittered(source)
        matrix = face_guard.fallback_alignment(source, jittered, (1143, 2048))
        np.testing.assert_array_equal(matrix[:, :2], np.eye(2))
        zoomed = face_guard.Face(source.box, (source.landmarks - source.landmarks.mean(axis=0)) * 1.1 + source.landmarks.mean(axis=0))
        with self.assertRaisesRegex(face_guard.AlignmentError, 'uncertain-scene-registration'):
            face_guard.fallback_alignment(source, zoomed, (1143, 2048))


class FaceTransplant(unittest.TestCase):
    """The photo's own face on a generated frame whose head moved or resized a little."""

    def scene(self):
        original = np.full((800, 400, 3), 40, np.uint8)
        original[64:114, 180:220] = (200, 150, 120)  # the face box of face()
        return Image.fromarray(original), Image.new('RGB', (400, 800), (30, 160, 60))

    def moved(self, scale=1.1, shift=(12., 20.), points=None):
        source = face()
        points = source.landmarks if points is None else points
        centre = source.landmarks.mean(axis=0)
        return face_guard.Face(source.box, (points - centre) * scale + centre + shift)

    def test_the_face_follows_a_resized_and_shifted_head(self):
        original, generated = self.scene()
        target = self.moved()
        with patch.object(face_guard, 'detect_faces', return_value=[target]):
            result = np.asarray(face_guard.transplant_face(original, generated, face()))
        centre = target.landmarks.mean(axis=0).round().astype(int)
        pixel = result[centre[1], centre[0]].astype(int)
        self.assertGreater(pixel[0], 150, f'face colour expected at the new head position, got {pixel}')
        np.testing.assert_array_equal(result[700, 50], [30, 160, 60], 'hair, body and background stay the generator\'s')
        np.testing.assert_array_equal(result[20, 380], [30, 160, 60])

    def test_a_hood_around_the_jaw_stays_the_new_garment(self):
        # The photo's white wall beside the chin came back over a black hood.
        original = np.full((800, 400, 3), 250, np.uint8)
        original[64:114, 180:220] = (200, 150, 120)
        source_labels = np.zeros((800, 400), np.uint8)
        source_labels[64:114, 180:220] = 11
        generated = np.full((800, 400, 3), 250, np.uint8)
        generated[50:160, 160:240] = (10, 10, 10)
        generated[64:114, 180:220] = (190, 140, 110)
        generated_labels = np.zeros((800, 400), np.uint8)
        generated_labels[50:160, 160:240] = 4
        generated_labels[64:114, 180:220] = 11
        generated_labels[104:120, 168:180] = 0  # the dark inside of the hood, read as background
        with patch.object(face_guard, 'detect_faces', return_value=[face()]):
            result = np.asarray(face_guard.transplant_face(Image.fromarray(original), Image.fromarray(generated), face(),
                                                           source_labels, generated_labels)).astype(int)
        self.assertLess(result[119, 200].max(), 40, f'the hood under the chin, got {result[119, 200]}')
        self.assertLess(result[100, 176].max(), 40, f'the hood beside the jaw, got {result[100, 176]}')
        self.assertLess(result[112, 174].max(), 40, f'the inside of the hood below the mouth, got {result[112, 174]}')
        self.assertGreater(result[90, 200][0], 180, 'the face itself is still the photo\'s')

    def test_the_editors_ear_beside_the_head_is_covered_by_the_photo(self):
        # The editor drew an ear where the photo's hair hides it; faded, it showed as a second ear.
        original = np.full((800, 400, 3), 230, np.uint8)
        original[64:114, 180:220] = (200, 150, 120)
        source_labels = np.zeros((800, 400), np.uint8)
        source_labels[64:114, 180:220] = 11
        generated = original.copy()
        generated[84:100, 172:180] = (150, 100, 80)   # the editor's ear, read as face
        generated[96:103, 168:173] = (40, 30, 25)     # a tuft of beard the parser missed, under the ear
        generated_labels = source_labels.copy()
        generated_labels[84:100, 172:180] = 11
        with patch.object(face_guard, 'detect_faces', return_value=[face()]):
            result = np.asarray(face_guard.transplant_face(Image.fromarray(original), Image.fromarray(generated), face(),
                                                           source_labels, generated_labels)).astype(int)
        self.assertGreater(result[92, 176].min(), 215, f'the ear, got {result[92, 176]}')
        self.assertGreater(result[100, 170].min(), 215, f'the tuft, got {result[100, 170]}')

    def test_the_editors_jaw_beside_the_photos_is_covered_and_its_neck_kept(self):
        # A second jawline: the editor's ear lobe and jaw, a little wider than the photo's, were kept as "neck".
        original = np.full((800, 400, 3), 230, np.uint8)
        original[64:114, 180:220] = (200, 150, 120)
        original[114:160, 188:212] = (200, 150, 120)  # the photo's neck
        source_labels = np.zeros((800, 400), np.uint8)
        source_labels[64:160, 180:220] = 11
        source_labels[114:160, 180:188] = source_labels[114:160, 212:220] = 0
        generated = original.copy()
        generated[100:108, 172:180] = (120, 80, 60)   # the editor's jaw and lobe, between the mouth and the chin
        generated[114:160, 184:216] = (120, 80, 60)   # its neck, wider than the photo's
        generated_labels = source_labels.copy()
        generated_labels[100:108, 172:180] = 11
        generated_labels[114:160, 184:216] = 11
        with patch.object(face_guard, 'detect_faces', return_value=[face()]):
            result = np.asarray(face_guard.transplant_face(Image.fromarray(original), Image.fromarray(generated), face(),
                                                           source_labels, generated_labels)).astype(int)
        self.assertGreater(result[104, 175].min(), 215, f'the editor\'s jaw beside the photo\'s, got {result[104, 175]}')
        # The editor's neck edge stays skin, not the photo's wall.
        self.assertLess(result[140, 186].max(), 200, f'the editor\'s neck edge, got {result[140, 186]}')

    def test_the_editors_neck_takes_the_photos_colour_and_keeps_its_shape(self):
        # The photo's face sat on a brighter, sharper neck and looked pasted on.
        original = np.full((800, 400, 3), 230, np.uint8)
        original[64:114, 180:220] = (200, 150, 120)
        original[114:170, 190:210] = (150, 110, 90)   # the photo's own neck, in shade
        source_labels = np.zeros((800, 400), np.uint8)
        source_labels[64:114, 180:220] = 11
        source_labels[114:170, 190:210] = 11
        generated = original.copy()
        generated[114:170, 184:216] = (235, 190, 160)  # the editor's neck, wider and bright
        generated[150:170, 170:230] = (40, 60, 160)    # its collar over the neck
        generated_labels = np.zeros((800, 400), np.uint8)
        generated_labels[64:114, 180:220] = 11
        generated_labels[114:150, 184:216] = 11
        generated_labels[150:170, 170:230] = 4
        with patch.object(face_guard, 'detect_faces', return_value=[face()]):
            result = np.asarray(face_guard.transplant_face(Image.fromarray(original), Image.fromarray(generated), face(),
                                                           source_labels, generated_labels)).astype(int)
        # Towards the photo's shade: much darker than the editor's 235, the hue moved only a little.
        self.assertLess(result[135, 200][0], 215, f'the neck takes the photo\'s shade, got {result[135, 200]}')
        self.assertLess(result[135, 200].sum(), np.array([235, 190, 160]).sum() - 60, f'got {result[135, 200]}')
        self.assertLess(result[135, 187].min(), 200, f'the editor\'s outline stays: skin, not wall, got {result[135, 187]}')
        self.assertLess(abs(result[160, 200] - np.array([40, 60, 160])).max(), 25, f'the collar is untouched, got {result[160, 200]}')

    def long_hair(self, hair_left, hair_right, wall, strands):
        """A face with long hair down both sides to well below the chin."""
        image = np.full((800, 400, 3), wall, np.uint8)
        labels = np.zeros((800, 400), np.uint8)
        image[40:220, hair_left:hair_right] = strands
        labels[40:220, hair_left:hair_right] = 2
        image[64:114, 180:220] = (200, 150, 120)
        labels[64:114, 180:220] = 11
        image[114:220, 190:210] = (190, 140, 110)  # the neck
        labels[114:220, 190:210] = 11
        return image, labels

    def test_long_hair_runs_on_past_the_chin_without_a_break_across(self):
        # Cut at the chin, the photo's strands ended in a straight line over the editor's.
        original, source_labels = self.long_hair(164, 236, 230, (40, 30, 25))
        generated, generated_labels = self.long_hair(158, 242, 230, (70, 55, 45))  # drawn a little wider and lighter
        with patch.object(face_guard, 'detect_faces', return_value=[face()]):
            result = np.asarray(face_guard.transplant_face(Image.fromarray(original), Image.fromarray(generated), face(),
                                                           source_labels, generated_labels)).astype(float)
        hair = np.r_[150:178, 222:250]
        steps = np.abs(np.diff(result[100:215][:, hair].mean(axis=2), axis=0))
        self.assertLess(steps.max(), 60, f'a break across the hair below the chin: {steps.max():.0f} at row '
                                         f'{100 + np.unravel_index(steps.argmax(), steps.shape)[0]}')
        self.assertLess(result[130, 170].max(), 100, 'the hair beside the neck is hair')

    def test_the_wall_beside_the_head_has_the_frames_light(self):
        # The photo's wall, lit otherwise, came through beside the neck as a pale patch.
        original, source_labels = self.long_hair(170, 230, 200, (40, 30, 25))
        generated, generated_labels = self.long_hair(160, 240, 228, (40, 30, 25))  # the editor's hair wider, its wall lighter
        with patch.object(face_guard, 'detect_faces', return_value=[face()]):
            result = np.asarray(face_guard.transplant_face(Image.fromarray(original), Image.fromarray(generated), face(),
                                                           source_labels, generated_labels)).astype(int)
        for row in (60, 90, 130):
            for column in (150, 250):
                self.assertLess(abs(result[row, column] - 228).max(), 12, f'the wall at {row},{column}: {result[row, column]}')

    def test_a_turned_head_or_other_expression_is_refused(self):
        original, generated = self.scene()
        points = face().landmarks.copy()
        points[2] += (9, 0)  # the nose swings sideways: the head turned
        with patch.object(face_guard, 'detect_faces', return_value=[self.moved(1., (0, 0), points)]), \
                self.assertRaises(face_guard.AlignmentError):
            face_guard.transplant_face(original, generated, face())

    def test_a_slightly_different_expression_passes_only_the_relaxed_try(self):
        # Just over the strict limit the full lock relit the frame and turned black tights green.
        original, generated = self.scene()
        points = face().landmarks.copy()
        points[3] += (0, 6)  # a mouth corner lower: a residual of 3.5 px on a 40 px face
        with patch.object(face_guard, 'detect_faces', return_value=[self.moved(1., (0, 0), points)]):
            with self.assertRaisesRegex(face_guard.AlignmentError, 'face-transplant-mismatch'):
                face_guard.transplant_face(original, generated, face())
            face_guard.transplant_face(original, generated, face(), relaxed=True)
        turned = face().landmarks.copy()
        turned[2] += (9, 0)
        with patch.object(face_guard, 'detect_faces', return_value=[self.moved(1., (0, 0), turned)]), \
                self.assertRaises(face_guard.AlignmentError):
            face_guard.transplant_face(original, generated, face(), relaxed=True)

    def test_a_much_larger_head_is_refused(self):
        original, generated = self.scene()
        with patch.object(face_guard, 'detect_faces', return_value=[self.moved(1.5, (0, 0))]), \
                self.assertRaises(face_guard.AlignmentError):
            face_guard.transplant_face(original, generated, face())

    def test_no_face_or_two_faces_are_refused(self):
        original, generated = self.scene()
        for detections in ([], [face(), face(offset=(90, 0))]):
            with patch.object(face_guard, 'detect_faces', return_value=detections), self.assertRaises(face_guard.AlignmentError):
                face_guard.transplant_face(original, generated, face())
