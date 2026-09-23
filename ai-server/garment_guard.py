"""Limit the generated layer to the garments that the user actually selected."""
import cv2
import numpy as np
from PIL import Image

from footwear_guard import GARMENT_LABELS


def hand_keep_mask(labels, faces):
    """Lock compact exposed hands, without pasting bare forearms over new sleeves."""
    keep = np.zeros(labels.shape, dtype=np.uint8)
    if len(faces) != 1:
        return Image.fromarray(keep)
    x, y, w, h = faces[0].box
    for arm_label in (14, 15):
        count, components, stats, _ = cv2.connectedComponentsWithStats((labels == arm_label).astype(np.uint8))
        for component in range(1, count):
            left, top, width, height, area = stats[component]
            # With long sleeves the exposed skin is the hand itself. Large or
            # elongated regions may be bare arms and are not safe to hard-lock.
            if (top > y + h and max(3, w*h*.015) <= area <= w*h*1.6
                    and max(width, height) <= h*1.6 and min(width, height) <= w*1.2):
                keep[components == component] = 255
    return Image.fromarray(keep)


def silhouette(image, labels):
    # Reuse parsing instead of running a second segmentation network. Include
    # a small uncertain edge so a pale rim from the old garment is replaceable.
    radius = max(1, min(4, round(image.height * .0015)))
    alpha = cv2.dilate((labels > 0).astype(np.uint8) * 255,
                       cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1)))
    result = image.convert('RGBA')
    result.putalpha(Image.fromarray(alpha))
    return result


def keep_mask(source, generated, slots):
    if source.shape != generated.shape:
        raise ValueError('Parsing maps must be aligned')
    labels_by_slot = {**GARMENT_LABELS, 'bottom': {5, 6, 8}, 'shoes': {9, 10}}
    if not slots or any(slot not in labels_by_slot for slot in slots):
        raise ValueError('Не удалось определить область замены одежды.')
    selected = set().union(*(labels_by_slot[slot] for slot in slots))
    old = np.isin(source, list(selected))
    new = np.isin(generated, list(selected))
    if np.count_nonzero(new) < max(16, source.size * .0001):
        raise ValueError('Не удалось выделить новую одежду на результате. Попробуй другое фото вещи.')

    # Include the old garment: replacing sleeves/collars exposes new skin or
    # background, which must not be covered again by the original clothing.
    region = (old | new).astype(np.uint8)
    radius = max(1, min(4, round(source.shape[0] * .0015)))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))
    region = cv2.dilate(region, kernel)
    edit = cv2.GaussianBlur(region.astype(np.float32), (0, 0), max(.5, radius / 2))
    edit[old | new] = 1

    # Face, hair and exposed skin follow semantic contours, not a rectangle
    # under the chin. New fabric may still cover a hand, neck or bare leg.
    skin = np.isin(source, [1, 2, 3, 11, 12, 13, 14, 15])
    edit[skin & ~new] = 0
    unchanged = (source > 0) & ~old & ~new
    edit[unchanged] = 0
    return Image.fromarray(np.rint((1 - np.clip(edit, 0, 1)) * 255).astype(np.uint8))
