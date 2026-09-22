"""Local face landmarks used only to protect the source photograph."""
import os
from pathlib import Path
import threading

import cv2
import numpy as np
from PIL import Image

_lock = threading.Lock()
_detector = None


def detect_faces(image: Image.Image):
    global _detector
    size = image.size
    scale = min(1., 960 / max(size))
    small = image.convert('RGB').resize((round(size[0] * scale), round(size[1] * scale)))
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
    return [tuple(float(value / scale) for value in face[:4]) for face in found]


def protected_head(face, size):
    x, y, w, h = face
    return (max(0, int(x - .45 * w)), max(0, int(y - .65 * h)),
            min(size[0], int(x + 1.45 * w)), min(size[1], int(y + 1.18 * h)))


def faces_aligned(original_faces, generated_faces, size):
    if len(original_faces) != 1 or len(generated_faces) != 1:
        return False
    x, y, w, h = original_faces[0]
    gx, gy, gw, gh = generated_faces[0]
    return (abs(x + w / 2 - gx - gw / 2) <= max(3, w * .12)
            and abs(y + h / 2 - gy - gh / 2) <= max(3, h * .12)
            and .85 <= gw / max(w, 1) <= 1.15 and .85 <= gh / max(h, 1) <= 1.15)
