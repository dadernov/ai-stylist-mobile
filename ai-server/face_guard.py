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


HEAD_LABELS = [1, 2, 3, 11]  # hat, hair, sunglasses, face in the clothes parsing
HAIR_LABELS = [1, 2, 3]  # the head's own labels that are not skin
CLOTHES_LABELS = [4, 5, 6, 7, 17]  # upper clothes, skirt, pants, dress, scarf
# How far the photo may reach below the chin, in face heights, and to either side of the face, in face widths.
HAIR_DEPTH, HAIR_SIDE = 1.2, 3.0
# The seam between the photo and the frame: what a step along it costs at the least, how
# much an edge of either picture makes it cheaper, and how hard a free pixel leans to one side.
SEAM_FLOOR, SEAM_EDGE, SEAM_LEAN = 4., 40., 8.
# Local spread of grey below which a wall counts as plain and can be painted in.
PLAIN_WALL = 9.
# Free pixels lean to the photo down to a fifth of a face above the chin and to the frame
# a fifth below it, passing over in between.
LEAN_START, LEAN_LENGTH = .2, .4
# The photo's hair is kept down to this many face heights below the chin, above the shoulders.
HAIR_KEEP = .6


def _long_hair(labels, box):
    """The hair that grows from the head, down to `HAIR_DEPTH` below the chin; not a dark coat read as hair.

    Whole, not cut at a column beside the face: hair cut there showed a straight edge down the side.
    """
    x, y, w, h = [float(v) for v in box]
    hair = np.asarray(labels) == 2
    yy, xx = np.ogrid[:hair.shape[0], :hair.shape[1]]
    hair &= (xx >= x - HAIR_SIDE * w) & (xx <= x + w + HAIR_SIDE * w) & (yy >= y - h) & (yy <= y + h + HAIR_DEPTH * h)
    count, parts = cv2.connectedComponents(hair.astype(np.uint8), connectivity=8)
    if count < 2:
        return np.zeros(hair.shape, bool)
    head = np.unique(parts[hair & (yy <= y + h) & (xx >= x - .65 * w) & (xx <= x + 1.65 * w)])
    return np.isin(parts, head[head > 0])


def _lean(rows, chin, height):
    """1 above the chin, 0 below it, a smooth step over `LEAN_LENGTH` face heights around it."""
    t = np.clip((rows - (chin - LEAN_START * height)) / (LEAN_LENGTH * height), 0, 1)
    return ((1 + np.cos(np.pi * t)) / 2).astype(np.float32)


def _min_cut(photo, frame, must_photo, must_frame, lean, scale=2):
    """Which pixels take the photo: a minimum cut between `must_photo` and `must_frame`.

    Crossing between neighbours costs how much the two pictures differ there,
    so the seam runs where they agree, and less along an edge of either one,
    where a hood's rim, a strand or a jaw line hides it. `lean` per pixel
    pulls a free pixel to the photo (positive) or to the frame (negative).
    Cut at half size, which is plenty for a seam and keeps it under a second.
    """
    from scipy.sparse import csr_matrix
    from scipy.sparse.csgraph import breadth_first_order, maximum_flow
    height, width = must_photo.shape
    h, w = max(2, height // scale), max(2, width // scale)
    small = lambda a: cv2.resize(np.asarray(a, np.float32), (w, h), interpolation=cv2.INTER_AREA)
    p, f, pull = small(photo), small(frame), small(lean)
    to_photo = small(must_photo) > .5
    to_frame = (small(must_frame) > .5) & ~to_photo
    differ = np.linalg.norm(p - f, axis=2)
    count = h * w
    index = np.arange(count).reshape(h, w)
    source, sink = count, count + 1
    starts, ends, costs = [], [], []
    # Eight directions, the diagonals weighed by their length: with four the
    # cheapest seam ran in straight steps along the rows and columns.
    for dy, dx, length in ((0, 1, 1.), (1, 0, 1.), (1, 1, .7071), (1, -1, .7071)):
        y0, y1 = slice(0, h - dy), slice(dy, h)
        x0, x1 = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
        edge = np.linalg.norm(f[y0, x0] - f[y1, x1], axis=2) + np.linalg.norm(p[y0, x0] - p[y1, x1], axis=2)
        cost = ((differ[y0, x0] + differ[y1, x1]) / 2 / (1 + edge / SEAM_EDGE) + SEAM_FLOOR) * length
        starts.append(index[y0, x0].ravel())
        ends.append(index[y1, x1].ravel())
        costs.append(cost.ravel())
    starts, ends, costs = np.concatenate(starts), np.concatenate(ends), np.concatenate(costs)
    fixed = 1e8
    photo_side = np.where(to_photo, fixed, np.maximum(pull, 0)).ravel()
    frame_side = np.where(to_frame, fixed, np.maximum(-pull, 0)).ravel()
    rows = np.concatenate([starts, ends, np.full(count, source), index.ravel()])
    cols = np.concatenate([ends, starts, index.ravel(), np.full(count, sink)])
    capacity = np.concatenate([costs, costs, photo_side, frame_side])
    used = capacity > 0
    graph = csr_matrix((np.round(capacity[used] * 4).astype(np.int32), (rows[used], cols[used])), shape=(count + 2, count + 2))
    residual = graph - maximum_flow(graph, source, sink, method='dinic').flow
    residual.data[residual.data <= 0] = 0
    residual.eliminate_zeros()
    side = np.zeros(count + 2, bool)
    side[breadth_first_order(residual, source, directed=True, return_predecessors=False)] = True
    taken = cv2.resize(side[:count].reshape(h, w).astype(np.float32), (width, height), interpolation=cv2.INTER_LINEAR)
    # Rounded off: at half size the seam has corners.
    taken = cv2.GaussianBlur(taken, (0, 0), 1.5 * scale) > .5
    return (taken | must_photo) & ~(must_frame & ~must_photo)


def _wall_in(frame, hole, labels, reach):
    """`frame` with `hole` painted from its own background only, never from skin, hair or clothes beside it."""
    ys, xs = np.where(hole)
    pad = 6 * reach
    top, bottom = max(0, ys.min() - pad), min(hole.shape[0], ys.max() + pad + 1)
    left, right = max(0, xs.min() - pad), min(hole.shape[1], xs.max() + pad + 1)
    crop = np.ascontiguousarray(frame[top:bottom, left:right].clip(0, 255).astype(np.uint8))
    grow = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * reach + 1,) * 2)
    unknown = cv2.dilate((hole[top:bottom, left:right] | (labels[top:bottom, left:right] != 0)).astype(np.uint8), grow)
    if unknown.all():
        return frame
    filled = cv2.GaussianBlur(cv2.inpaint(crop, unknown, 7, cv2.INPAINT_TELEA).astype(np.float32), (0, 0), max(2., reach * .6))
    weight = cv2.GaussianBlur(cv2.dilate(hole[top:bottom, left:right].astype(np.uint8), grow).astype(np.float32), (0, 0), 2.)[..., None]
    out = frame.copy()
    out[top:bottom, left:right] = crop * (1 - weight) + filled * weight
    return out


def _pull_push(values, weights):
    """A smooth field through `values` where `weights` > 0, filled in everywhere else."""
    levels = []
    value, weight = values * weights[..., None], weights.astype(np.float32)
    while min(weight.shape) > 8:
        levels.append((value, weight))
        value, weight = cv2.pyrDown(value), cv2.pyrDown(weight)
    field = np.where(weight[..., None] > 1e-6, value / np.maximum(weight[..., None], 1e-6), 0)
    for value, weight in reversed(levels):
        coarse = cv2.resize(field, (weight.shape[1], weight.shape[0]), interpolation=cv2.INTER_LINEAR)
        own = np.where(weight[..., None] > 1e-6, value / np.maximum(weight[..., None], 1e-6), 0)
        trust = np.clip(weight * 4, 0, 1)[..., None]
        field = trust * own + (1 - trust) * coarse
    return field


def _sharpness(image, box):
    x, y, w, h = [int(v) for v in box]
    patch = cv2.cvtColor(np.ascontiguousarray(image[max(0, y):y + h, max(0, x):x + w]).astype(np.uint8), cv2.COLOR_RGB2GRAY)
    return float(cv2.Laplacian(patch, cv2.CV_64F).var()) if patch.size else 0.


def _neck_rows(labels, top, bottom, centre, widest):
    """Per row from `top`: the unbroken run of skin around `centre`, until the neck widens into shoulders."""
    mask = np.zeros(labels.shape, bool)
    for row in range(max(0, int(top)), min(labels.shape[0], int(bottom))):
        skin = np.concatenate([[0], (labels[row] == 11).astype(np.int8), [0]])
        starts, ends = np.where(np.diff(skin) == 1)[0], np.where(np.diff(skin) == -1)[0]
        hit = [(a, b) for a, b in zip(starts, ends) if a <= centre < b]
        if not hit or hit[0][1] - hit[0][0] > widest:
            break
        mask[row, hit[0][0]:hit[0][1]] = True
    return mask


def _match_neck(frame, face, generated_labels, photo_labels, target: Face, photo_chin, photo, source_face: Face):
    """The editor's neck in the colour, light and softness of the photo's.

    The photo's face is put back on the editor's neck, which keeps its shape:
    it fits the new collar or hood. But it was brighter, warmer and sharper
    than the face above it, and the face looked pasted on. Its skin takes the
    photo's own neck's colour and, when the photo is softer, the same softness.
    Only the neck: each row's unbroken skin under the chin, until it widens
    into shoulders, and never a pixel off the skin.
    """
    gx, gy, gw, gh = [float(v) for v in target.box]
    centre = gx + gw / 2
    chin = gy + gh
    neck = _neck_rows(generated_labels, chin - .1 * gh, chin + 1.2 * gh, centre, 1.1 * gw)
    own = _neck_rows(photo_labels, photo_chin + .06 * gh, photo_chin + .9 * gh, centre, 1.1 * gw)
    if neck.sum() < .04 * gw * gh or own.sum() < .04 * gw * gh:
        return frame
    sample = neck & (np.arange(neck.shape[0])[:, None] > chin + .02 * gh)
    if sample.sum() < .03 * gw * gh:
        return frame
    frame_lab = cv2.cvtColor(frame.clip(0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    face_lab = cv2.cvtColor(face.clip(0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    # The parser counts a few pixels of a dark collar or a strand of hair as skin; recoloured and
    # blurred, they ran into the neck as smudges. Only what is skin-coloured is touched.
    centre_lab = np.median(frame_lab[sample], axis=0)
    spread_lab = np.median(np.abs(frame_lab[sample] - centre_lab), axis=0) * 1.4826 + 2
    skin_like = (np.abs(frame_lab - centre_lab) <= 3 * spread_lab).all(axis=2)
    neck &= skin_like
    sample &= skin_like
    if sample.sum() < .03 * gw * gh:
        return frame
    mu_g, sd_g = frame_lab[sample].mean(axis=0), frame_lab[sample].std(axis=0) + 1e-3
    mu_p, sd_p = face_lab[own].mean(axis=0), face_lab[own].std(axis=0) + 1e-3
    # A shade, not another person: the light may move, the skin's hue only a little.
    shift = np.clip(mu_p - mu_g, [-25, -8, -8], [25, 8, 8])
    matched = (frame_lab - mu_g) * np.clip(sd_p / sd_g, .7, 1.3) + mu_g + shift
    matched = cv2.cvtColor(matched.clip(0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.float32)
    # As soft as the photo: the editor draws every pore, a phone photo of the face does not.
    source_sharp = _sharpness(photo, source_face.box)
    if 0 < source_sharp < _sharpness(frame, target.box):
        for sigma in (.5, 1., 1.5, 2., 2.5, 3.):
            if _sharpness(cv2.GaussianBlur(frame, (0, 0), sigma), target.box) <= source_sharp:
                break
        # Blurred within the skin only: a collar, the wall or hair beside it must not run into the neck's edge.
        skin = ((generated_labels == 11) & skin_like).astype(np.float32)
        spread = cv2.GaussianBlur(skin, (0, 0), sigma)[..., None]
        matched = np.where(spread > 1e-3, cv2.GaussianBlur(matched * skin[..., None], (0, 0), sigma) / np.maximum(spread, 1e-3), matched)
    rows = np.arange(neck.shape[0])[:, None]
    last = np.where(neck.any(axis=1))[0].max()
    # The neck's own edge stays as drawn: there it meets the collar, and anything changed shows as a fringe.
    edge = max(2, round(gw * .04))
    inner = cv2.erode(neck.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (edge * 2 + 1, edge * 2 + 1)))
    weight = cv2.GaussianBlur(inner.astype(np.float32), (0, 0), max(1., gw * .03))
    weight *= neck * np.clip((rows - (chin - .1 * gh)) / (.15 * gh), 0, 1) * np.clip((last - rows) / (.25 * gh), 0, 1)
    return frame * (1 - weight[..., None]) + matched * weight[..., None]


def transplant_face(original: Image.Image, generated: Image.Image, source_face: Face, source_labels=None, generated_labels=None,
                    relaxed=False, keep=()):
    """Put the photo's own face into a frame whose head moved or resized a little.

    A general image editor redraws the whole picture: the head comes back ~10%
    larger or a few pixels off, and the lock that restores face and background
    together must refuse such a frame. The face alone can still be restored:
    the photo's head is mapped onto the generated one by one similarity
    transform of the eyes, nose and mouth and laid in along a seam (`_compose`);
    the body and the new clothes stay the generator's. A head that turned or
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
    # `relaxed` is the second try before the full lock, which relights the whole
    # frame: a residual of 5.3% sent a look there and turned black tights green.
    low, high, turn, spread = (.75, 1.33, 15, .09) if relaxed else (.8, 1.25, 10, .05)
    if not low <= scale <= high or angle > turn or residual > max(3., width * spread):
        raise AlignmentError(f'face-transplant-mismatch scale={scale:.2f} angle={angle:.1f} residual={residual / max(width, 1):.3f}')
    return _compose(original, generated, source_face, faces[0], matrix, source_labels, generated_labels, keep)


def _compose(original, generated, source_face: Face, target: Face, matrix, source_labels=None, generated_labels=None, keep=()):
    """The photo's head laid into the frame along a seam where the two agree.

    Every rule for where the photo ends and the frame begins (the photo's wall
    beside the head, the editor's hair painted out, the neck the editor's from
    the chin down) left a patch or a straight edge somewhere: a hood came out
    cut, long hair broke off across, a wall went grey beside the neck. So the
    border is not drawn but found: a minimum cut between what must be the
    photo's (its face) and what must be the frame's (the new clothes, and all
    beyond the head), through whatever lies between, where the two pictures
    agree most or an edge hides the step. Free pixels lean to the photo above
    the chin, where the head is, and to the frame below it, where the new
    clothes are; the editor's own head and hair lean hard to the photo, so no
    second ear or jaw is left beside it. The photo's wall takes the frame's
    light along the seam; where both have hair or both have skin, the two
    pass into each other over a longer way, as their strands and shadows do
    not line up.
    """
    x, y, width, height = [float(v) for v in source_face.box]
    gx, gy, gw, gh = [float(v) for v in target.box]
    size = generated.size
    photo = cv2.warpAffine(np.asarray(original.convert('RGB')), matrix, size, flags=cv2.INTER_CUBIC,
                           borderMode=cv2.BORDER_REPLICATE).astype(np.float32)
    frame = np.asarray(generated.convert('RGB')).astype(np.float32)
    rows_count, cols_count = frame.shape[:2]
    rows = np.arange(rows_count, dtype=np.float32)[:, None]
    yy, xx = np.ogrid[:rows_count, :cols_count]
    labelled = source_labels is not None and np.asarray(source_labels).shape == (original.height, original.width) \
        and generated_labels is not None and np.asarray(generated_labels).shape == (rows_count, cols_count)
    frame_labels = np.asarray(generated_labels) if labelled else np.zeros((rows_count, cols_count), np.uint8)
    photo_labels = cv2.warpAffine(np.asarray(source_labels).astype(np.uint8), matrix, size, flags=cv2.INTER_NEAREST) \
        if labelled else np.zeros((rows_count, cols_count), np.uint8)
    photo_chin = float(matrix[1] @ np.array([x + width / 2, y + height, 1.]))
    chin = max(gy + gh, photo_chin)
    kernel = lambda radius: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * max(1, round(radius)) + 1,) * 2)
    oval = Image.new('L', original.size, 0)
    centre_x, centre_y = x + width / 2, y + height * .56
    ImageDraw.Draw(oval).ellipse((centre_x - width * .44, centre_y - height * .56,
                                  centre_x + width * .44, centre_y + height * .5), fill=255)
    oval = cv2.warpAffine((np.asarray(oval) > 0).astype(np.uint8), matrix, size, flags=cv2.INTER_NEAREST).astype(bool)
    photo_face = ((photo_labels == 11) & (rows <= photo_chin)) | (photo_labels == 3)
    photo_hair = cv2.warpAffine(_long_hair(source_labels, source_face.box).astype(np.uint8), matrix, size,
                                flags=cv2.INTER_NEAREST).astype(bool) if labelled else np.zeros(oval.shape, bool)
    in_head = (xx >= gx - .65 * gw) & (xx <= gx + 1.65 * gw) & (yy >= gy - .9 * gh)
    frame_head = np.isin(frame_labels, HEAD_LABELS) & (rows <= chin) & in_head
    frame_hair = _long_hair(frame_labels, target.box)
    # The face itself must be the photo's; its ears and the sides of its neck may give way to a new hood or collar.
    must_photo = cv2.erode(((photo_face & cv2.dilate(oval.astype(np.uint8), kernel(width * .04)).astype(bool)) | oval).astype(np.uint8),
                           kernel(width * .02)).astype(bool) | (photo_labels == 3)
    reach = cv2.dilate((photo_face | photo_hair | frame_head | frame_hair | oval).astype(np.uint8), kernel(width * .25)).astype(bool)
    reach &= rows <= chin + HAIR_DEPTH * gh
    # The new clothes are the frame's, over the photo's hair too: where the editor drew a collar over it, it lies under.
    # The face ellipse is wider than the jaw near the chin: there it held the photo's wall, laid over the editor's
    # cheek as a light wedge down to the neck. Where the photo has wall, nothing is the photo's by force.
    if labelled:
        must_photo &= photo_labels != 0
    must_frame = (np.isin(frame_labels, CLOTHES_LABELS) | ~reach) & ~must_photo
    # Where the editor drew neck and the photo has wall, below the mouth: the editor's neck. The photo's wall there
    # came out as a light strip down the side of the neck, in steps.
    mouth_row = float(np.asarray(target.landmarks)[3:, 1].mean())
    side_neck = (frame_labels == 11) & (photo_labels == 0) & (rows > chin)
    must_frame |= cv2.dilate(side_neck.astype(np.uint8), kernel(width * .01)).astype(bool) & ~must_photo
    # Between the mouth and the chin too, in columns where the editor's neck goes on below: there it is neck
    # beside the photo's narrower jaw, not a second jaw sticking out.
    neck_below = ((frame_labels == 11) & (rows > chin) & (rows < chin + .3 * gh)).any(axis=0)
    jaw_side = (frame_labels == 11) & (photo_labels == 0) & (rows > mouth_row) & (rows <= chin) & neck_below[None, :]
    must_frame |= jaw_side & ~must_photo
    hat_zone = np.zeros(reach.shape, bool)
    if keep:
        # A hat in the look: the hat and everything above its brim are the frame's; below the brim the head is
        # restored as in any look, ears and side hair the photo's. Only the face from the photo left the editor's
        # ears and hair round it, and they came out twice and broken up.
        hat = np.isin(frame_labels, keep) & in_head
        brows = float(np.asarray(target.landmarks)[:2, 1].mean()) - .12 * gh
        brim = float(np.percentile(np.where(hat)[0], 92)) if hat.sum() > 50 else brows
        brim = min(brim, brows)
        # Above the hat's own lower edge, column by column: one straight line at the brows cut across the glasses.
        hat_cols = np.where(hat.any(axis=0))[0]
        edge = np.full(cols_count, -1., np.float32)
        if len(hat_cols):
            edge[hat_cols] = rows_count - 1 - np.argmax(hat[::-1, hat_cols], axis=0)
        hat_zone = cv2.dilate(hat.astype(np.uint8), kernel(width * .02)).astype(bool) | ((rows <= edge[None, :]) & reach)
        # Hair pressed under the hat: between the brim and the eyes the photo's hair beyond the editor's head stays out,
        # or it stuck out wider than the cap on both sides.
        eyes = float(np.asarray(target.landmarks)[:2, 1].mean())
        inside = cv2.dilate((frame_head | hat).astype(np.uint8), kernel(width * .03)).astype(bool)
        hat_zone |= (rows >= brim) & (rows <= eyes + .1 * gh) & (photo_labels == 2) & ~inside & reach
        must_photo &= ~hat_zone
        must_frame |= hat_zone & ~must_photo
        must_frame = (~cv2.dilate(oval.astype(np.uint8), kernel(width * .12)).astype(bool) | np.isin(frame_labels, CLOTHES_LABELS)
                      | np.isin(frame_labels, keep)) & ~must_photo
    if not must_photo.any():
        raise AlignmentError('face-transplant-mismatch')
    # The generator relights the scene slightly: the head and the wall around it take the frame's mean light first.
    photo_lab = cv2.cvtColor(photo.clip(0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    frame_lab = cv2.cvtColor(frame.clip(0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    face = (photo_face | oval) & (rows <= gy + gh)
    if labelled:
        face &= frame_labels == 11
    if face.sum() > 50:
        photo_lab[(photo_labels > 0) | oval] += np.clip(frame_lab[face].mean(axis=0) - photo_lab[face].mean(axis=0), -12, 12)
    wall = reach & (photo_labels == 0) & (frame_labels == 0) & ~oval
    if labelled and wall.sum() > 50:
        photo_lab[(photo_labels == 0) & ~oval] += np.clip(frame_lab[wall].mean(axis=0) - photo_lab[wall].mean(axis=0), -25, 25)
    photo = cv2.cvtColor(photo_lab.clip(0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.float32)
    if labelled:
        frame = _match_neck(frame, photo, frame_labels, photo_labels, target, photo_chin, np.asarray(original.convert('RGB')), source_face)
        # The editor's hair and ears beyond the photo's head are painted out with the editor's own wall:
        # laid over them, the photo's wall (another door frame, other leaves) showed as a halo round the head.
        # Above the mouth only: lower down a beard or the shade inside a hood beside the jaw came out as a white wedge.
        ghost = (frame_head | frame_hair) & (photo_labels == 0) & ~oval & reach & (rows <= float(np.asarray(target.landmarks)[3:, 1].mean()))
        # The editor's skin only where it is ear, beside its own face box: its cheek and jaw, a little wider than the
        # photo's, painted out down to the mouth left a step where its neck goes on below; cut at the nose, half an ear stayed.
        ghost &= (frame_labels != 11) | (xx < gx + .02 * gw) | (xx > gx + .98 * gw)
        # Only over a plain wall: leaves or a room cannot be painted in smooth, and a blur there showed worse
        # than the editor's own hair kept round the photo's.
        gray = cv2.cvtColor(frame.clip(0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
        busy = np.sqrt(np.maximum(cv2.GaussianBlur(gray ** 2, (0, 0), 6.) - cv2.GaussianBlur(gray, (0, 0), 6.) ** 2, 0))
        plain = cv2.erode((busy < PLAIN_WALL).astype(np.uint8), kernel(width * .05)).astype(bool) | (frame_labels != 0)
        ghost &= cv2.erode(plain.astype(np.uint8), kernel(width * .02)).astype(bool)
        ghost &= ~hat_zone
        if ghost.sum() > 30:
            frame = _wall_in(frame, ghost, frame_labels, max(3, round(width * .05)))
    over = _lean(rows, chin, gh)
    lean = SEAM_LEAN * (2 * over - 1) * np.ones((1, cols_count), np.float32)
    # Deeper down harder to the frame, so the seam leaves long hair well before the photo's reach ends.
    lean -= 2 * SEAM_LEAN * np.clip((rows - chin - (LEAN_LENGTH - LEAN_START) * gh) / (.3 * gh), 0, 1)
    # Under the face the neck is the frame's even above the chin's row: beside the chin the jaw rises
    # to the ears, and the photo's wall there cut a notch into the editor's neck.
    columns = np.where(oval.any(axis=0))[0]
    jaw = np.full(cols_count, np.inf, np.float32)
    jaw[columns] = rows_count - 1 - np.argmax(oval[::-1, columns], axis=0)
    under = rows > jaw[None, :] + .03 * gh
    lean = np.where((frame_head | frame_hair) & in_head & ~under, lean + 3 * SEAM_LEAN * over, lean)
    lean = np.where(photo_face & ~under, lean + 2 * SEAM_LEAN * over, lean)
    # The photo's own hair keeps its length down to the shoulders: leaning to the frame from the chin on,
    # side locks hanging past the jaw were cut at the ear and the wall drawn where they were.
    hair_reach = np.clip((chin + HAIR_KEEP * gh - rows) / (.15 * gh), 0, 1)
    # Only beside the face: hair falling onto the shoulders brings the photo's wall between its strands.
    beside_face = (xx >= gx - .35 * gw) & (xx <= gx + 1.35 * gw)
    lean = np.where(photo_hair & beside_face, np.maximum(lean, 0) + 2 * SEAM_LEAN * hair_reach, lean)
    lean = np.where(under & ~photo_hair, np.minimum(lean, 0) - SEAM_LEAN, lean)
    # The dark inside of a hood or collar beside the jaw, read as background: the frame's, not the photo's wall.
    mouth = float(np.asarray(target.landmarks)[3:, 1].mean())
    near_clothes = cv2.dilate(np.isin(frame_labels, CLOTHES_LABELS).astype(np.uint8), kernel(width * .25)).astype(bool)
    lean = np.where((frame_labels == 0) & near_clothes & (rows > mouth) & (photo_labels == 0), np.minimum(lean, 0) - SEAM_LEAN, lean)
    # The photo's wall is the photo's own background: where it does not look like the frame's, the seam keeps to the hair.
    differ = np.clip(cv2.GaussianBlur(np.linalg.norm(photo - frame, axis=2), (0, 0), 2.) / 30., 0, 1)
    # Right beside the editor's head it is the editor's ear or beard the parser missed, not its wall: there the photo wins.
    hugging = cv2.dilate(frame_head.astype(np.uint8), kernel(width * .08)).astype(bool) & (rows <= chin)
    # Below the mouth the photo's wall never wins over the new clothes' shade: a white wedge showed in hoods.
    hugging |= (rows > float(np.asarray(target.landmarks)[3:, 1].mean())) & cv2.dilate(np.isin(frame_labels, CLOTHES_LABELS).astype(np.uint8), kernel(width * .3)).astype(bool)
    # Not on the editor's own cheek inside its face box: there the photo's wall beside a narrower jaw is no ear to cover.
    hugging &= ~((frame_labels == 11) & (xx >= gx + .02 * gw) & (xx <= gx + .98 * gw))
    photo_wall = (photo_labels == 0) & ~hugging
    lean = np.where(photo_wall, np.minimum(lean, SEAM_LEAN) - 3 * SEAM_LEAN * differ, lean)
    # The parser's outlines come in blocks: the hard constraints are rounded off, or the seam ran down them in steps.
    smooth = lambda mask: cv2.GaussianBlur(mask.astype(np.float32), (0, 0), max(2., width * .015)) > .5
    must_photo, must_frame = smooth(must_photo), smooth(must_frame) & ~must_photo
    ys, xs = np.where(reach)
    top, bottom = max(0, ys.min() - 4), min(rows_count, ys.max() + 5)
    left, right = max(0, xs.min() - 4), min(cols_count, xs.max() + 5)
    window = (slice(top, bottom), slice(left, right))
    taken = np.zeros(reach.shape, bool)
    taken[window] = _min_cut(photo[window], frame[window], must_photo[window], must_frame[window], lean[window])
    taken = (taken | must_photo) & ~(must_frame & ~must_photo)
    # The photo's wall takes the frame's light along the seam, carried smoothly over the photo's side;
    # its face and hair keep their own colour, or the editor's skin tone came through the seam.
    seam = taken & cv2.dilate((~taken).astype(np.uint8), kernel(1)).astype(bool)
    difference = frame - photo
    agree = seam & (np.linalg.norm(difference, axis=2) < 40)
    if labelled and agree.sum() > 20:
        field = np.zeros_like(photo)
        field[window] = _pull_push(difference[window], agree[window].astype(np.float32))
        scene = cv2.GaussianBlur(((photo_labels == 0) & ~oval).astype(np.float32), (0, 0), max(1., width * .02))
        photo += np.clip(field, -25, 25) * (taken * scene)[..., None]
    alpha = cv2.GaussianBlur(cv2.GaussianBlur(taken.astype(np.float32), (0, 0), max(2., width * .012)).__gt__(.5).astype(np.float32),
                             (0, 0), max(1.5, width * .012))
    if labelled:
        shared = lambda mask: cv2.GaussianBlur(cv2.erode(mask.astype(np.uint8), kernel(width * .03)).astype(np.float32), (0, 0), width * .03)
        both = np.maximum(shared((photo_labels == 2) & (frame_labels == 2)),
                          shared((photo_labels == 11) & (frame_labels == 11) & (rows > photo_chin - .15 * gh)))
        # Where the hair passes from the photo's outline to the editor's, the outline moves over as gradually;
        # never at the new clothes, which would take the photo's wall at their edge.
        band = over * (1 - over) * 4
        clear = 1 - cv2.dilate(np.isin(frame_labels, CLOTHES_LABELS).astype(np.uint8), kernel(gh * .15)).astype(np.float32)
        both = np.maximum(both, shared((photo_labels == 2) | (frame_labels == 2)) * band * clear)
        alpha = both * cv2.GaussianBlur(taken.astype(np.float32), (0, 0), max(2., gh * .07)) + (1 - both) * alpha
    if keep:
        # The soft edge never reaches into the hat: blurred across it, the photo's hair cut its band.
        alpha *= 1 - cv2.GaussianBlur(hat_zone.astype(np.float32), (0, 0), max(1., width * .006))
    blended = frame * (1 - alpha[..., None]) + photo * alpha[..., None]
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
