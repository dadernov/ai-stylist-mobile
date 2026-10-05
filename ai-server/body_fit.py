"""Bring a try-on body back to the width of the photo.

Seedream draws the person about a tenth wider than they are, with fitted
clothes too: shoulders, waist and hips alike. Told so in every wording, it
still does. So the frame is corrected after the editor: the width of the torso
is measured against the photo's (both from the clothes parser), and the
columns the body stands in are narrowed by that ratio, the scene on both sides
widened by as much. Only x moves, so vertical lines stay straight and nothing
has to be painted in.
"""
import os

import cv2
import numpy as np
from PIL import Image

# Body labels of the clothes parser (footwear_guard): everything but background and bags.
BAG = 16
# Never narrower than this: a bigger correction would be the editor's other mistake.
MAX_SQUEEZE = .10
# Garments that really add volume keep some of it.
BULKY = {'Пальто', 'Пуховик', 'Парка', 'Шуба', 'Свитер', 'Худи', 'Кардиган'}
BULKY_ALLOWANCE = 1.04
# Rows measured, as a share of the person's height: shoulders to waist, above any flared skirt or coat hem.
TORSO = (.18, .40)


def enabled():
    return os.getenv('TRYON_BODY_FIT', 'on').strip().lower() not in ('0', 'off', 'false', 'no')


def allowance(categories):
    """How much wider than the photo the clothes of this look may make the body."""
    return BULKY_ALLOWANCE if any(category in BULKY for category in categories) else 1.0


def _person(labels):
    labels = np.asarray(labels)
    return (labels > 0) & (labels != BAG)


def measure(source_labels, generated_labels, allowed=1.0):
    """(factor, zone): narrow columns zone[0]..zone[1] by `factor`, or (1.0, None) to leave the frame as it is."""
    source, generated = _person(source_labels), _person(generated_labels)
    if source.shape != generated.shape:
        return 1.0, None
    rows = np.where(source.any(axis=1))[0]
    if len(rows) < 20:
        return 1.0, None
    top, height = rows[0], rows[-1] - rows[0]
    torso = slice(int(top + TORSO[0] * height), int(top + TORSO[1] * height))
    source_width = source[torso].sum(axis=1).astype(float)
    generated_width = generated[torso].sum(axis=1).astype(float)
    valid = (source_width > 10) & (generated_width > 10)
    if valid.sum() < 10:
        return 1.0, None
    ratio = float(np.median(generated_width[valid] / source_width[valid]))
    factor = float(np.clip(allowed / ratio, 1 - MAX_SQUEEZE, 1.0))
    columns = np.where(generated[torso].any(axis=0))[0]
    zone = (int(np.percentile(columns, 1)), int(np.percentile(columns, 99)))
    # A body filling the frame leaves no scene to take up the difference.
    if factor > .985 or zone[1] - zone[0] > .7 * source.shape[1]:
        return 1.0, None
    return factor, zone


def _column_map(width, factor, zone):
    # The soft step from body to scene lies outside the body, so its edges narrow as much as its middle.
    sigma = max(2., .02 * width)
    start, end = max(0, zone[0] - int(2 * sigma)), min(width - 1, zone[1] + int(2 * sigma))
    body = end - start
    xs = np.arange(width, dtype=np.float64)
    scene = (width - factor * body) / max(width - body, 1)
    gain = np.where((xs >= start) & (xs <= end), factor, scene)
    gain = cv2.GaussianBlur(gain.reshape(1, -1), (0, 0), sigma).ravel()
    gain *= width / gain.sum()
    forward = np.concatenate([[0], np.cumsum(gain)])[:-1]
    return np.interp(xs, forward, xs).astype(np.float32)


def narrow(image: Image.Image, labels, factor, zone, chin=None, neck=0):
    """The frame and its labels with the body's columns narrowed; the scene keeps the frame's width.

    The scene is remapped the same way on every row, so a door frame or a wall
    corner stays straight: narrowed only below the chin, it bent at the
    shoulders. The person is remapped on their own and laid over it: above
    `chin` they do not move, as the face is put back from the photo and has to
    fit the head it lands on, and over the next `neck` rows the narrowing grows
    to its full amount. The scene pixels a head covers in one map and not in
    the other are plain wall beside it.
    """
    width, height = image.size
    full = _column_map(width, factor, zone)
    identity = np.arange(width, dtype=np.float32)
    rows = np.arange(height, dtype=np.float32)
    map_y = np.repeat(rows.reshape(-1, 1), width, axis=1)
    scene_x = np.tile(full, (height, 1))
    if chin is None:
        weight = np.ones(height, np.float32)
    else:
        weight = np.clip((rows - chin) / max(neck, 1), 0, 1)
        weight = (1 - np.cos(np.pi * weight)) / 2
    person_x = (identity[None, :] + weight[:, None] * (full - identity)[None, :]).astype(np.float32)
    source = np.asarray(image.convert('RGB'))
    scene = cv2.remap(source, scene_x, map_y, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    if labels is None:
        return Image.fromarray(scene), None
    labels = np.asarray(labels).astype(np.uint8)
    body = cv2.remap(source, person_x, map_y, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    person = (_person(labels)).astype(np.float32)
    # A pixel's worth of the edge comes along: the person's outline is soft in the frame too.
    person = cv2.dilate(person, np.ones((3, 3), np.uint8))
    cover = cv2.remap(person, person_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    cover = cv2.GaussianBlur(cover, (0, 0), 1.)[..., None]
    frame = scene * (1 - cover) + body * cover
    scene_labels = cv2.remap(labels, scene_x, map_y, cv2.INTER_NEAREST, borderMode=cv2.BORDER_REPLICATE)
    body_labels = cv2.remap(labels, person_x, map_y, cv2.INTER_NEAREST, borderMode=cv2.BORDER_REPLICATE)
    narrowed_labels = np.where(_person(body_labels), body_labels, np.where(_person(scene_labels), 0, scene_labels)).astype(np.uint8)
    return Image.fromarray(frame.clip(0, 255).round().astype(np.uint8)), narrowed_labels
