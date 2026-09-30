"""A quick look at the try-on photo before any paid generation.

Runs on the server with the local models the identity lock already uses (the
clothes parser and the face detector); the photo goes nowhere and is not kept.
Every issue is advice, never a refusal: the photo stays usable.

Measured on stock photos, 8 generations: the background barely mattered, a
hand raised to the hair spoiled the jacket in every run, and cut-off feet
leave nowhere to put shoes.
"""
import numpy as np
from PIL import Image

import face_guard
import footwear_guard

# ATR labels of footwear_guard's parser.
SHOES = (9, 10)
ARMS = (14, 15)
FACE = 11
MAX_SIDE = 768
# The figure should fill most of the frame; below this the face is too small to restore.
MIN_HEIGHT = .5
# A figure that reaches the bottom row with barely any shoe in sight is cut at the ankles.
MIN_SHOES = .002
EDGE_ROWS = 2


def issues(image: Image.Image):
    """Codes of what may spoil a try-on: person, people, head, face, feet, arms, small."""
    image = image.convert('RGB')
    image.thumbnail((MAX_SIDE, MAX_SIDE))
    labels = footwear_guard.parse(image)
    person = labels > 0
    if person.mean() < .01:
        return ['person']
    height = labels.shape[0]
    rows = np.flatnonzero(person.any(axis=1))
    faces = face_guard.detect_faces(image) or _closer_look(image, labels)
    if not faces:
        # A turned-away person, a cut-off head or clothes alone: nothing else
        # can be judged without a face, and one clear request is enough.
        return ['face']
    found = []
    if len(faces) > 1:
        found.append('people')
    if rows[0] < EDGE_ROWS:
        found.append('head')
    if rows[-1] >= height - EDGE_ROWS and np.isin(labels, SHOES).mean() < MIN_SHOES:
        found.append('feet')
    if len(faces) == 1:
        # The chin comes from the face box: on a bare torso the parser labels skin as face.
        x, y, w, h = faces[0].box
        arms = np.flatnonzero(np.isin(labels, ARMS).any(axis=1))
        if arms.size and arms[0] < y + h:
            found.append('arms')
    if (rows[-1] - rows[0]) / height < MIN_HEIGHT:
        found.append('small')
    return found


def _closer_look(image, labels):
    """A small face of a distant figure, found again at the head's own scale."""
    ys, xs = np.nonzero(labels == FACE)
    if not ys.size:
        return []
    margin = max(int(np.ptp(ys)), int(np.ptp(xs)), 8)
    region = (max(0, xs.min() - margin), max(0, ys.min() - margin),
              min(image.width, xs.max() + margin), min(image.height, ys.max() + margin))
    return face_guard.detect_faces(image, tuple(int(value) for value in region))
