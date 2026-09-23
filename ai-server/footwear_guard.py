"""Keep existing footwear without mistaking a floor-length hem for shoes."""
import os
from pathlib import Path
import threading

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageFilter

# ATR labels from mattmdjaga/segformer_b0_clothes. A coat is upper clothing;
# dresses and jumpsuits can occlude the shoes without changing footwear.
GARMENT_LABELS = {
    'top': {4}, 'outer': {4, 7}, 'long_outer': {4, 5, 7},
    'one_piece': {4, 5, 6, 7}, 'bottom': {5, 6},
}
_lock = threading.Lock()
_session = None


def _get_session():
    global _session
    if _session is None:
        path = Path(os.getenv('AI_PARSING_MODEL', Path(__file__).parent / 'models/parsing/clothes.onnx'))
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.enable_cpu_mem_arena = False
        _session = ort.InferenceSession(str(path), sess_options=options, providers=['CPUExecutionProvider'])
    return _session


def parse(image):
    """Return full-resolution clothing labels, interpolating logits, not labels."""
    rgb = image.convert('RGB').resize((512, 512), Image.Resampling.BILINEAR)
    pixels = np.asarray(rgb, dtype=np.float32) / 255.0
    pixels = (pixels - np.array([.485, .456, .406], dtype=np.float32)) / np.array([.229, .224, .225], dtype=np.float32)
    # Serial inference and no arena keep peak memory bounded on the CPU server.
    with _lock:
        logits = _get_session().run(['logits'], {'pixel_values': pixels.transpose(2, 0, 1)[None]})[0][0]
    labels = np.zeros((image.height, image.width), dtype=np.uint8)
    best = np.full(labels.shape, -np.inf, dtype=np.float32)
    for label, scores in enumerate(logits):
        scores = cv2.resize(scores, image.size, interpolation=cv2.INTER_LINEAR)
        wins = scores > best
        labels[wins] = label
        best[wins] = scores[wins]
    return labels


def _dilate(mask, radius):
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))
    return cv2.dilate(mask.astype(np.uint8), kernel).astype(bool)


def keep_mask(source_labels, generated_labels, changed_slots):
    """Restore both shoe footprints and nearby floor, except actual new fabric."""
    if not changed_slots or any(slot not in GARMENT_LABELS for slot in changed_slots):
        # In particular, an explicit shoes request must keep its new footwear.
        return None
    if source_labels.shape != generated_labels.shape:
        raise ValueError('Parsing maps must be aligned')
    height, width = source_labels.shape
    shoes = np.isin(source_labels, [9, 10]) | np.isin(generated_labels, [9, 10])
    count, components, stats, _ = cv2.connectedComponentsWithStats(shoes.astype(np.uint8), connectivity=8)
    valid = [label for label in range(1, count) if stats[label, cv2.CC_STAT_AREA] >= max(4, width * height * .00004)]
    shoes = np.isin(components, valid)
    if not shoes.any():
        # No fixed bottom strip: on cropped portraits this would erase clothes.
        return None
    padding = max(3, min(24, round(height * .012)))
    footprint = _dilate(shoes, padding)
    shoe_top = max(0, int(np.where(shoes)[0].min()) - padding)
    floor = (source_labels == 0) & (generated_labels == 0)
    floor[:shoe_top] = False
    labels = set().union(*(GARMENT_LABELS[slot] for slot in changed_slots))
    garments = np.isin(generated_labels, list(labels))
    # Allow hems to overlap shoes, including ankle/floor-length coats. The small
    # margin covers parsing uncertainty along the fabric edge.
    garments = _dilate(garments, max(1, round(height * .002)))
    protected = (footprint | floor) & ~garments
    mask = Image.fromarray(protected.astype(np.uint8) * 255)
    soft = np.asarray(mask.filter(ImageFilter.GaussianBlur(radius=max(1, height * .002))))
    # Original shoe/sole pixels stay exact; feather only outside their envelope.
    result = np.maximum(np.asarray(mask), soft)
    result[garments] = 0
    return Image.fromarray(result)


def protect(original, generated, changed_slots):
    if not changed_slots or any(slot not in GARMENT_LABELS for slot in changed_slots):
        return None
    try:
        return keep_mask(parse(original), parse(generated), changed_slots)
    except Exception as exc:
        # This supplementary guard must not discard a paid result if its local
        # model is unavailable. The mandatory face/silhouette guards still run.
        print(f'Try-on footwear parsing unavailable: {type(exc).__name__}', flush=True)
        return None
