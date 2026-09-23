"""Keep one coherent generated body; restore only the head and distant scenery."""
import cv2
import numpy as np
from PIL import Image

import face_guard
import footwear_guard
import image_color


def components(mask):
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8))
    return [(labels == index, stats[index]) for index in range(1, count)
            if stats[index, 4] >= max(8, mask.size * .00008)]


def body_support(source_labels, generated_labels, face):
    """Locate the same subject in both frames, including displaced source limbs."""
    x, y, width, height = face.box
    foreground = ((source_labels > 0) | (generated_labels > 0)).astype(np.uint8)
    radius = max(2, min(24, round(width * .15)))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius*2+1, radius*2+1))
    joined = cv2.morphologyEx(foreground, cv2.MORPH_CLOSE, kernel).astype(bool)
    parts = components(joined)
    if not parts:
        raise ValueError('Не удалось выделить человека на исходном фото.')
    head = np.zeros_like(joined)
    head[max(0, int(y)):min(head.shape[0], int(y+height)),
         max(0, int(x)):min(head.shape[1], int(x+width))] = True
    main = max(parts, key=lambda part: (np.count_nonzero(part[0] & head), part[1][4]))[0]
    if not (main & head).any():
        raise ValueError('Не удалось связать лицо с силуэтом человека.')

    # Small parsing gaps can disconnect a wrist or ankle. Attach only nearby
    # fragments to the head-anchored person, without cascading through scenery.
    nearby = footwear_guard._dilate(main, max(radius, round(width * .35)))
    support = main.copy()
    for part, stats in parts:
        if np.count_nonzero(part & nearby) >= max(4, stats[4] * .25):
            support |= part
    return support


def body_envelope(support):
    """Continuous edit support, not a claim that enclosed scenery is anatomy.

    Keep both the old and new limb locations in one generated layer. Restoring
    source pixels between them is what created extra hands and exposed legs.
    """
    height, width = support.shape
    rows = np.flatnonzero(support.any(axis=1))
    if not rows.size:
        raise ValueError('Не удалось определить границы тела.')
    left = np.argmax(support[rows], axis=1)
    right = width - 1 - np.argmax(support[rows, ::-1], axis=1)
    span = np.arange(rows[0], rows[-1]+1)
    first = np.floor(np.interp(span, rows, left)).astype(int)
    last = np.ceil(np.interp(span, rows, right)).astype(int)
    result = np.zeros((height, width), bool)
    columns = np.arange(width)[None, :]
    result[span] = (columns >= first[:, None]) & (columns <= last[:, None])
    return result


def require_coverage(coverage, keep):
    """Never fill missing generated anatomy with limbs from the source photo."""
    error = 'Не удалось точно совместить примерку с исходным фото. Лицо и фон не изменены; попробуй повторить примерку.'
    if coverage.size != keep.size:
        raise ValueError(error)
    valid = np.asarray(coverage.convert('L')) == 255
    mask = np.asarray(keep.convert('L'))
    if np.any(~valid & (mask == 0)):
        raise ValueError(error)
    # prepare feathers only OUTSIDE the body envelope and its safety padding.
    # Missing samples in that scenery-only fringe can use the source outright.
    safe = mask.copy()
    safe[~valid] = 255
    return Image.fromarray(safe)


def prepare(source, generated, source_labels, generated_labels, faces, slots):
    labels_by_slot = {**footwear_guard.GARMENT_LABELS, 'bottom': {5, 6, 8}, 'shoes': {9, 10}}
    if not slots or any(slot not in labels_by_slot for slot in slots):
        raise ValueError('Не удалось определить область замены одежды.')
    if len(faces) != 1 or source_labels.shape != generated_labels.shape:
        raise ValueError('Не удалось совместить силуэты человека.')
    selected = list(set().union(*(labels_by_slot[slot] for slot in slots)))
    support = body_support(source_labels, generated_labels, faces[0])
    if np.count_nonzero(np.isin(generated_labels, selected) & support) < max(16, support.size*.0001):
        raise ValueError('Не удалось выделить новую одежду на результате.')

    envelope = body_envelope(support)
    # Blend only in the scenery OUTSIDE both body footprints, never across a
    # wrist, trouser leg or foot. No source-skin patches, local warp or inpaint.
    padding = max(3, min(24, round(faces[0].box[2] * .12)))
    interior = footwear_guard._dilate(envelope, padding)
    distance = cv2.distanceTransform((~interior).astype(np.uint8), cv2.DIST_L2, 5)
    feather = max(2, min(12, round(faces[0].box[2] * .08)))
    keep = np.rint(np.clip(distance / feather, 0, 1)*255).astype(np.uint8)
    head = face_guard.protected_head_mask(faces[0], source.size, source_labels, generated_labels)
    keep = np.maximum(keep, np.asarray(head))
    generated = image_color.match_source_lighting(source, generated, source_labels, generated_labels)
    return generated, Image.fromarray(keep), generated_labels.copy()
