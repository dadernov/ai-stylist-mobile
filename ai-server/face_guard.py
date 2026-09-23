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


def protected_head_mask(face, size):
    """Protect the head, tapering at the jaw instead of pasting back a collar."""
    x, y, w, h = face.box
    mask = Image.new('L', size, 0)
    ImageDraw.Draw(mask).polygon([
        (x - .45 * w, y - .65 * h), (x + 1.45 * w, y - .65 * h),
        (x + 1.45 * w, y + .45 * h), (x + 1.02 * w, y + .82 * h),
        (x + w, y + h), (x, y + h),
        (x - .02 * w, y + .82 * h), (x - .45 * w, y + .45 * h),
    ], fill=255)
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
    matrix, _ = cv2.estimateAffinePartial2D(generated, source, method=cv2.LMEDS)
    if matrix is None or not np.isfinite(matrix).all():
        raise AlignmentError('no-transform')
    scale = np.hypot(matrix[0, 0], matrix[1, 0])
    angle = abs(np.degrees(np.arctan2(matrix[1, 0], matrix[0, 0])))
    if not .9 <= scale <= 1.1 or angle > 5:
        raise AlignmentError('large-scale-or-rotation')
    mapped = generated @ matrix[:, :2].T + matrix[:, 2]
    if np.linalg.norm(mapped - source, axis=1).max() > max(2, width * .1):
        raise AlignmentError('inconsistent-landmarks')
    return matrix


def align_to_source(original: Image.Image, generated: Image.Image, source_face: Face):
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
    matrix = alignment_transform(source_face, faces[0], original.size)
    corners = np.array([[0, 0], [original.width, 0], [0, original.height], original.size])
    if np.max(np.linalg.norm(corners @ matrix[:, :2].T + matrix[:, 2] - corners, axis=1)) < .5:
        return generated
    # A similarity transform cannot shear or reshape the body. Only the generated
    # layer moves; the source photo and its protected pixels are never transformed.
    aligned = cv2.warpAffine(np.asarray(generated.convert('RGB')), matrix, original.size, flags=cv2.INTER_CUBIC)
    coverage = cv2.warpAffine(np.full((original.height, original.width), 255, dtype=np.uint8), matrix, original.size)
    aligned[coverage < 255] = np.asarray(original.convert('RGB'))[coverage < 255]
    return Image.fromarray(aligned)
