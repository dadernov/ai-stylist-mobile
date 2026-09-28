"""Local face landmarks used only to protect the source photograph."""
import os
from pathlib import Path
import threading
from typing import NamedTuple

import cv2
import numpy as np
from PIL import Image, ImageDraw

_lock = threading.Lock()
_detector = None


class Face(NamedTuple):
    box: tuple[float, float, float, float]
    landmarks: np.ndarray


class AlignmentError(ValueError):
    pass


def detect_faces(image: Image.Image, region=None):
    global _detector
    scan = image.crop(region) if region else image
    offset = np.array(region[:2] if region else (0, 0))
    size = scan.size
    # A full-height photo makes a face very small at 960px. Retry the head crop
    # at its own resolution instead of mistaking a missed detection for movement.
    scale = min(3., max(1., 320 / max(size))) if region else min(1., 960 / max(size))
    small = scan.convert('RGB').resize((max(1, round(size[0] * scale)), max(1, round(size[1] * scale))))
    scales = np.array(small.size) / size
    pixels = cv2.cvtColor(np.asarray(small), cv2.COLOR_RGB2BGR)
    with _lock:
        if _detector is None:
            path = os.getenv('AI_FACE_MODEL', str(Path(__file__).parent / 'models/face/yunet.onnx'))
            if not Path(path).is_file():
                raise RuntimeError('Face protection model is not installed')
            cv2.setNumThreads(1)
            _detector = cv2.FaceDetectorYN.create(path, '', small.size, 0.8, 0.3, 5000)
        _detector.setInputSize(small.size)
        _, found = _detector.detect(pixels)
    if found is None:
        return []
    return [Face(tuple(np.concatenate((face[:2] / scales + offset, face[2:4] / scales))),
                 face[4:14].reshape(5, 2) / scales + offset) for face in found]


def protected_head(face, size):
    x, y, w, h = face.box
    return (max(0, int(x - .45 * w)), max(0, int(y - .65 * h)),
            min(size[0], int(x + 1.45 * w)), min(size[1], int(y + 1.18 * h)))


def protected_head_mask(face, size, source_labels=None, generated_labels=None):
    """Protect the head, tapering at the jaw instead of pasting back a collar."""
    x, y, w, h = face.box
    mask = Image.new('L', size, 0)
    ImageDraw.Draw(mask).polygon([
        (x - .45 * w, y - .65 * h), (x + 1.45 * w, y - .65 * h),
        (x + 1.45 * w, y + .45 * h), (x + 1.02 * w, y + .82 * h),
        (x + w, y + h), (x, y + h),
        (x - .02 * w, y + .82 * h), (x - .45 * w, y + .45 * h),
    ], fill=255)
    if source_labels is not None:
        # Follow the real jaw/neck/hair contour. The old detector polygon ended
        # in a straight line across the neck and looked like a pasted rectangle.
        yy, xx = np.ogrid[:size[1], :size[0]]
        # Clothing parsing can call bare torso/legs "face". Semantic labels
        # only protect anatomy near the detected head, never the whole frame.
        head_extent = ((xx >= x - .65*w) & (xx <= x + 1.65*w)
                       & (yy >= y - .9*h) & (yy <= y + h))
        neck_extent = ((xx >= x - .15*w) & (xx <= x + 1.15*w)
                       & (yy > y + h) & (yy <= y + 1.6*h))
        head = np.isin(source_labels, [1, 2, 3, 11]) & (head_extent | neck_extent)
        if generated_labels is not None:
            below_chin = np.arange(size[1])[:, None] > y + h
            head &= ~(below_chin & np.isin(generated_labels, [4, 5, 6, 7]))
        mask = Image.fromarray(head.astype(np.uint8) * 255)
        # Segmentation is fallible. Keep the facial features themselves even
        # when a few pixels are classified as clothing; stop at the lips.
        points = np.vstack((face.landmarks, [[x + .2*w, y], [x + .8*w, y]]))
        hull = cv2.convexHull(points.astype(np.float32)).reshape(-1, 2)
        ImageDraw.Draw(mask).polygon([tuple(point) for point in hull], fill=255)
    # Garments cannot replace the upper head. Keep the whole upper frame, so
    # tall/wide hair and detector box jitter cannot expose it to generation.
    upper_head = min(y + .35 * h, float(np.min(face.landmarks[:2, 1])) - .08 * h)
    if upper_head >= 0:
        ImageDraw.Draw(mask).rectangle((0, 0, size[0], upper_head), fill=255)
    return mask


def alignment_transform(source_face: Face, generated_face: Face, size):
    source = np.asarray(source_face.landmarks, dtype=np.float64)
    generated = np.asarray(generated_face.landmarks, dtype=np.float64)
    if source.shape != (5, 2) or generated.shape != (5, 2) or not np.isfinite([source, generated]).all():
        raise AlignmentError('invalid-landmarks')
    _, _, width, height = source_face.box
    if min(width, height) <= 0 or min(np.ptp(source, axis=0)) < 2 or min(np.ptp(generated, axis=0)) < 2:
        raise AlignmentError('degenerate-landmarks')
    displacement = np.abs(source.mean(axis=0) - generated.mean(axis=0))
    limits = np.minimum(np.array(size) * .04, np.maximum(4, np.array([width, height]) * .5))
    if np.any(displacement > limits):
        raise AlignmentError('large-displacement')
    # Eyes, nose and mouth locate the face; a bounding box also changes with
    # collars, contrast and hair, even when the head has not moved at all.
    # All five detected landmarks are required and checked below. LMEDS can
    # overfit a three-point subset, turning ordinary detector jitter into an
    # apparent zoom. Fit one similarity transform to all five instead.
    a, b = generated - generated.mean(axis=0), source - source.mean(axis=0)
    denominator = np.sum(a*a)
    if denominator < 1e-8:
        raise AlignmentError('degenerate-landmarks')
    real = np.sum(a*b) / denominator
    imaginary = np.sum(a[:, 0]*b[:, 1] - a[:, 1]*b[:, 0]) / denominator
    rotation = np.array([[real, -imaginary], [imaginary, real]])
    translation = source.mean(axis=0) - rotation @ generated.mean(axis=0)
    matrix = np.column_stack((rotation, translation))
    if not np.isfinite(matrix).all():
        raise AlignmentError('no-transform')
    scale = np.hypot(matrix[0, 0], matrix[1, 0])
    angle = abs(np.degrees(np.arctan2(matrix[1, 0], matrix[0, 0])))
    # On a regenerated face the detector places nose and mouth a few percent
    # of the face width away from where it found them in the photo, while the
    # eyes stay put. Fitted to five points that bias reads as a 5-6 degree
    # roll and a small zoom. Those are not a moved head; 8 degrees and 12% are.
    if not .88 <= scale <= 1.14 or angle > 8:
        raise AlignmentError('large-scale-or-rotation')
    mapped = generated @ matrix[:, :2].T + matrix[:, 2]
    if np.linalg.norm(mapped - source, axis=1).max() > max(2, width * .1):
        raise AlignmentError('inconsistent-landmarks')
    return matrix


def head_agreement(source_face: Face, mapped_landmarks, size):
    """Confirm the scene-registered head is the same head in the same place.

    The scene transform already fixes scale and rotation from many background
    anchors. Here only the head itself is judged, with the two eyes as the
    stable ruler: a head that moved, grew or turned is rejected; detector
    jitter on a repainted nose and mouth is not.
    """
    source = np.asarray(source_face.landmarks, dtype=np.float64)
    mapped = np.asarray(mapped_landmarks, dtype=np.float64)
    if source.shape != (5, 2) or mapped.shape != (5, 2) or not np.isfinite([source, mapped]).all():
        raise AlignmentError('invalid-landmarks')
    _, _, width, height = source_face.box
    if min(width, height) <= 0 or min(np.ptp(source, axis=0)) < 2 or min(np.ptp(mapped, axis=0)) < 2:
        raise AlignmentError('degenerate-landmarks')
    delta = mapped - source
    displacement = np.abs(delta.mean(axis=0))
    limits = np.minimum(np.array(size) * .04, np.maximum(4, np.array([width, height]) * .5))
    if np.any(displacement > limits):
        raise AlignmentError('large-displacement')
    source_eyes, mapped_eyes = source[1] - source[0], mapped[1] - mapped[0]
    source_span, mapped_span = np.linalg.norm(source_eyes), np.linalg.norm(mapped_eyes)
    if source_span < 2 or mapped_span < 2:
        raise AlignmentError('degenerate-landmarks')
    ratio = mapped_span / source_span
    roll = abs(np.degrees(np.arctan2(mapped_eyes[1], mapped_eyes[0]) - np.arctan2(source_eyes[1], source_eyes[0])))
    roll = min(roll, 360 - roll)
    if (np.linalg.norm(delta.mean(axis=0)) > max(4., width * .1)
            or np.linalg.norm(delta, axis=1).max() > max(6., width * .15)
            or not .85 <= ratio <= 1.18 or roll > 8):
        raise AlignmentError('face-scene-disagreement')


def scene_alignment(source_points, generated_points, size):
    """Require background anchors across the frame, not one patch of texture."""
    source = np.asarray(source_points, dtype=np.float64).reshape(-1, 2)
    generated = np.asarray(generated_points, dtype=np.float64).reshape(-1, 2)
    if len(source) < 12 or source.shape != generated.shape or not np.isfinite([source, generated]).all():
        return None
    tolerance = max(1.5, max(size) * .0015)
    matrix, inliers = cv2.estimateAffinePartial2D(
        generated, source, method=cv2.RANSAC, ransacReprojThreshold=tolerance,
        maxIters=2000, confidence=.995, refineIters=10,
    )
    if matrix is None or inliers is None or not np.isfinite(matrix).all():
        return None
    selected = inliers.ravel().astype(bool)
    if selected.sum() < max(12, len(source) * .3):
        return None
    anchors = source[selected]
    span = np.ptp(anchors, axis=0) / size
    hull_area = cv2.contourArea(cv2.convexHull(anchors.astype(np.float32)))
    quadrants = (anchors[:, 0] >= size[0]/2).astype(int) + 2*(anchors[:, 1] >= size[1]/2)
    if np.any(span < [.35, .4]) or hull_area < size[0]*size[1]*.06 or len(np.unique(quadrants)) < 3:
        return None
    scale = np.hypot(matrix[0, 0], matrix[1, 0])
    angle = abs(np.degrees(np.arctan2(matrix[1, 0], matrix[0, 0])))
    if not .9 <= scale <= 1.1 or angle > 5:
        raise AlignmentError('large-scene-scale-or-rotation')
    return matrix


def background_transform(original, generated, source_face, source_labels):
    if source_labels is None:
        return None
    labels = np.asarray(source_labels)
    if labels.shape != (original.height, original.width):
        raise AlignmentError('invalid-source-labels')
    # Exclude the person and a margin: regenerated fabric, skin and hair are
    # not registration anchors. No extra segmentation/model request is needed.
    radius = max(3, min(64, round(source_face.box[2] * .35)))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius*2+1, radius*2+1))
    excluded = cv2.dilate((labels > 0).astype(np.uint8), kernel).astype(bool)
    left, top, right, bottom = protected_head(source_face, original.size)
    excluded[top:bottom, left:right] = True
    mask = (~excluded).astype(np.uint8) * 255
    scale = min(1., 1600 / max(original.size))
    size = tuple(max(1, round(value * scale)) for value in original.size)
    source = cv2.cvtColor(np.asarray(original.convert('RGB')), cv2.COLOR_RGB2GRAY)
    target = cv2.cvtColor(np.asarray(generated.convert('RGB')), cv2.COLOR_RGB2GRAY)
    source = cv2.resize(source, size, interpolation=cv2.INTER_AREA)
    target = cv2.resize(target, size, interpolation=cv2.INTER_AREA)
    mask = cv2.resize(mask, size, interpolation=cv2.INTER_NEAREST)
    # Walls and floors often have low contrast. Weak candidates still need
    # reciprocal matching and distributed RANSAC inliers before use.
    sift = cv2.SIFT_create(nfeatures=2500, contrastThreshold=.005)
    points_a, features_a = sift.detectAndCompute(source, mask)
    points_b, features_b = sift.detectAndCompute(target, None)
    if features_a is None or features_b is None or min(len(features_a), len(features_b)) < 12:
        return None
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    pairs = matcher.knnMatch(features_a, features_b, k=2)
    reverse = {match.queryIdx: match.trainIdx for match in matcher.match(features_b, features_a)}
    candidates = [pair[0] for pair in pairs if len(pair) == 2 and pair[0].distance < .7 * pair[1].distance
                  and reverse.get(pair[0].trainIdx) == pair[0].queryIdx]
    # SIFT can describe the same corner at several orientations. Count spatial
    # anchors, not duplicate descriptors that would inflate confidence.
    matches, seen_a, seen_b = [], set(), set()
    for match in sorted(candidates, key=lambda item: item.distance):
        cell_a = tuple(int(value // 8) for value in points_a[match.queryIdx].pt)
        cell_b = tuple(int(value // 8) for value in points_b[match.trainIdx].pt)
        if cell_a not in seen_a and cell_b not in seen_b:
            matches.append(match)
            seen_a.add(cell_a)
            seen_b.add(cell_b)
    if len(matches) < 12:
        return None
    # Rounded thumbnail dimensions can have slightly different x/y ratios.
    ratios = np.array(original.size) / size
    a = np.array([points_a[match.queryIdx].pt for match in matches]) * ratios
    b = np.array([points_b[match.trainIdx].pt for match in matches]) * ratios
    return scene_alignment(a, b, original.size)


def fallback_alignment(source_face, generated_face, size):
    # Face-only evidence can establish a small translation, not a camera zoom.
    # Validate landmark geometry without applying its scale/rotation globally.
    alignment_transform(source_face, generated_face, size)
    source = np.asarray(source_face.landmarks, dtype=np.float64)
    generated = np.asarray(generated_face.landmarks, dtype=np.float64)
    delta = source - generated
    identity = np.array([[1., 0., 0.], [0., 1., 0.]])
    tolerance = max(1.5, min(3., source_face.box[2] * .04))
    if np.linalg.norm(delta, axis=1).max() <= tolerance:
        return identity
    # Without background anchors the eye distance is the only size evidence;
    # a translation may absorb detector jitter on the nose and mouth, never a zoom.
    ratio = np.linalg.norm(generated[1] - generated[0]) / max(1e-6, np.linalg.norm(source[1] - source[0]))
    translation = delta.mean(axis=0)
    if not .92 <= ratio <= 1.08 or np.linalg.norm(delta-translation, axis=1).max() > max(3., source_face.box[2] * .08):
        raise AlignmentError('uncertain-scene-registration')
    identity[:, 2] = translation
    return identity


def _similarity(source, target):
    """Least-squares rotation, uniform scale and shift taking `source` points onto `target`."""
    a, b = source - source.mean(axis=0), target - target.mean(axis=0)
    denominator = np.sum(a*a)
    if denominator < 1e-8:
        raise AlignmentError('degenerate-landmarks')
    real = np.sum(a*b) / denominator
    imaginary = np.sum(a[:, 0]*b[:, 1] - a[:, 1]*b[:, 0]) / denominator
    rotation = np.array([[real, -imaginary], [imaginary, real]])
    return np.column_stack((rotation, target.mean(axis=0) - rotation @ source.mean(axis=0)))


def transplant_face(original: Image.Image, generated: Image.Image, source_face: Face):
    """Put the photo's own face into a frame whose head moved or resized a little.

    A general image editor redraws the whole picture: the head comes back ~10%
    larger or a few pixels off, and the lock that restores face and background
    together must refuse such a frame. The face alone can still be restored:
    the photo's face is mapped onto the generated head by one similarity
    transform of the eyes, nose and mouth and blended over a soft ellipse; the
    hair, body and background stay the generator's. A head that turned or
    changed its expression is refused, because the old face would not fit it.
    """
    if generated.size != original.size:
        raise AlignmentError('size-mismatch')
    faces = detect_faces(generated)
    if not faces:
        x, y, w, h = source_face.box
        region = (max(0, int(x - 1.5 * w)), max(0, int(y - h)),
                  min(original.width, int(x + 2.5 * w)), min(original.height, int(y + 2 * h)))
        faces = detect_faces(generated, region=region)
    if len(faces) != 1:
        raise AlignmentError('face-not-found' if not faces else 'multiple-faces')
    source = np.asarray(source_face.landmarks, dtype=np.float64)
    target = np.asarray(faces[0].landmarks, dtype=np.float64)
    if source.shape != (5, 2) or target.shape != (5, 2) or not np.isfinite([source, target]).all():
        raise AlignmentError('invalid-landmarks')
    matrix = _similarity(source, target)
    scale = np.hypot(matrix[0, 0], matrix[1, 0])
    angle = abs(np.degrees(np.arctan2(matrix[1, 0], matrix[0, 0])))
    x, y, width, height = source_face.box
    residual = np.linalg.norm(source @ matrix[:, :2].T + matrix[:, 2] - target, axis=1).max()
    # Measured on Seedream frames: scale .87-1.10, residual under 3% of the face
    # width. A turned head or another expression moves the landmarks apart.
    if not .8 <= scale <= 1.25 or angle > 10 or residual > max(3., width * .05):
        raise AlignmentError('face-transplant-mismatch')
    mask = Image.new('L', original.size, 0)
    centre_x, centre_y = x + width / 2, y + height * .56
    ImageDraw.Draw(mask).ellipse((centre_x - width * .44, centre_y - height * .56,
                                  centre_x + width * .44, centre_y + height * .5), fill=255)
    alpha = cv2.GaussianBlur(np.asarray(mask, np.float32) / 255, (0, 0), max(2., width * .07))
    alpha = cv2.warpAffine(alpha, matrix, generated.size, flags=cv2.INTER_LINEAR)
    face = cv2.warpAffine(np.asarray(original.convert('RGB')), matrix, generated.size,
                          flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    frame = np.asarray(generated.convert('RGB'))
    core = alpha > .6
    if not core.any():
        raise AlignmentError('face-transplant-mismatch')
    # The generator relights the scene slightly; match the mean colour of the
    # face to its new surroundings so the ellipse does not read as a patch.
    face_lab = cv2.cvtColor(face, cv2.COLOR_RGB2LAB).astype(np.float32)
    frame_lab = cv2.cvtColor(frame, cv2.COLOR_RGB2LAB).astype(np.float32)
    face_lab += np.clip(frame_lab[core].mean(axis=0) - face_lab[core].mean(axis=0), -12, 12)
    face = cv2.cvtColor(face_lab.clip(0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.float32)
    blended = frame * (1 - alpha[..., None]) + face * alpha[..., None]
    return Image.fromarray(blended.clip(0, 255).round().astype(np.uint8))


def align_to_source(original: Image.Image, generated: Image.Image, source_face: Face,
                    source_labels=None, return_coverage=False):
    if generated.size != original.size:
        raise AlignmentError('size-mismatch')
    faces = detect_faces(generated)
    if not faces:
        x, y, w, h = source_face.box
        region = (max(0, int(x - 1.5 * w)), max(0, int(y - h)),
                  min(original.width, int(x + 2.5 * w)), min(original.height, int(y + 2 * h)))
        faces = detect_faces(generated, region=region)
    if len(faces) != 1:
        raise AlignmentError('face-not-found' if not faces else 'multiple-faces')
    matrix = background_transform(original, generated, source_face, source_labels)
    if matrix is None:
        matrix = fallback_alignment(source_face, faces[0], original.size)
    else:
        # Landmarks validate compatibility only. Scaling an already aligned
        # room to fit noisy face detections also shrinks hands, legs and feet.
        mapped = faces[0].landmarks @ matrix[:, :2].T + matrix[:, 2]
        head_agreement(source_face, mapped, original.size)
    corners = np.array([[0, 0], [original.width, 0], [0, original.height], original.size])
    if np.max(np.linalg.norm(corners @ matrix[:, :2].T + matrix[:, 2] - corners, axis=1)) <= 1.:
        return (generated, Image.new('L', original.size, 255)) if return_coverage else generated
    # A similarity transform cannot shear or reshape the body. Only the generated
    # layer moves; the source photo and its protected pixels are never transformed.
    aligned = cv2.warpAffine(np.asarray(generated.convert('RGB')), matrix, original.size,
                             flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    # Border interpolation is not generated content. Return explicit coverage
    # instead of filling missing regions with old limbs from the source photo.
    # Pixel centres inside the frame are genuine samples, including a clipped
    # toe on the last row. Replicating interpolation neighbours is harmless;
    # sampling beyond the frame is not, and must be rejected in the body matte.
    inverse = cv2.invertAffineTransform(matrix)
    yy, xx = np.ogrid[:original.height, :original.width]
    sample_x = inverse[0, 0]*xx + inverse[0, 1]*yy + inverse[0, 2]
    sample_y = inverse[1, 0]*xx + inverse[1, 1]*yy + inverse[1, 2]
    inside = ((sample_x >= -1e-6) & (sample_x <= original.width-1+1e-6)
              & (sample_y >= -1e-6) & (sample_y <= original.height-1+1e-6))
    coverage = inside.astype(np.uint8) * 255
    result = Image.fromarray(aligned)
    return (result, Image.fromarray(coverage)) if return_coverage else result
