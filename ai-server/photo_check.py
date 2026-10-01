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
# Hands hidden in long sleeves stay hidden in every look: the editor never draws
# hands it did not see, and shorter sleeves then end in empty cuffs (tested on
# the user's own photo). Visible hands are 3-20% of a figure, hidden ones ~0.
MIN_HANDS = .005
# A long coat hides the body: every look then came out as broad as the coat
# (shoulders 3.4-3.9 face widths on the user's coat photo, 3.1-3.3 on his
# own photo). What the editor cannot see it cannot fit, so the photo is the fix.
# Measured as the share of the thighs the upper garment covers: 0.52 in a long
# coat, at most 0.34 on other photos (parser noise on bare legs and dresses).
MAX_COAT = .45
UPPER_CLOTHES, SKIRT, DRESS = 4, 5, 7


def issues(image: Image.Image):
    """Codes of what may spoil a try-on: person, people, head, face, feet, arms, hands, coat, small."""
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
    if np.isin(labels, ARMS).sum() / person.sum() < MIN_HANDS:
        found.append('hands')
    figure = rows[-1] - rows[0]
    thighs = slice(int(rows[0] + .5 * figure), int(rows[0] + .75 * figure))
    covered = (labels[thighs] == UPPER_CLOTHES).sum() / max(1, person[thighs].sum())
    if covered >= MAX_COAT and np.isin(labels[thighs], (SKIRT, DRESS)).mean() < .1:
        found.append('coat')
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
