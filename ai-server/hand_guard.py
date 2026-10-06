"""The photo's own hands on the finished look.

The editor redraws every hand, and a relaxed hand with curled fingers came out
with a thumb drawn twice, once see-through. The pose is kept pixel for pixel,
so the hands are where they were in the photo, moved only by the body refit
(body_fit), which shifts columns by a known map. So each hand is cut from the
photo, put through the same map, and laid over the look. The new sleeves stay
over the wrists; the editor's own fingers reaching past the photo's hand are
painted over from what lies around them.
"""
import os

import cv2
import numpy as np
from PIL import Image

import body_fit

ARMS = (14, 15)  # left and right arm skin in the clothes parsing
SLEEVES = (4, 7, 17)  # upper clothes, dress, scarf: what may cover a wrist
BAG = 16
# A hand and its wrist: the lowest part of an arm, as a share of the person's height.
HAND_DEPTH = .075
# Least overlap of the photo's hand with the editor's: below it the editor moved the arm, and its hand stays.
HAND_MATCH = .5
# How far the editor's hand may lie from the photo's, as a share of the person's height.
SHIFT_REACH = .035
# Least share of a hand's rim that must be the scene.
FREE_RIM = .35
SCALES = (.92, 1., 1.08, 1.16, 1.24)


def enabled():
    return os.getenv('TRYON_HANDS', 'on').strip().lower() not in ('0', 'off', 'false', 'no')


def _hands(labels, height):
    hands = []
    for label in ARMS:
        count, parts, stats, _ = cv2.connectedComponentsWithStats((labels == label).astype(np.uint8))
        if count < 2:
            continue
        arm = parts == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        rows = np.where(arm.any(axis=1))[0]
        hand = arm & (np.arange(labels.shape[0])[:, None] > rows.max() - HAND_DEPTH * height)
        if hand.sum() < 100:
            continue
        # Only a hand hanging free beside the body, the scene partly around it: one clasped, in a pocket
        # or on the body is drawn over other clothes and the other hand, and laid back it smeared them.
        rim = cv2.dilate(hand.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool) & ~hand
        if (labels[rim] == 0).mean() < FREE_RIM:
            continue
        hands.append(hand)
    if len(hands) == 2:
        apart = cv2.dilate(hands[0].astype(np.uint8), np.ones((int(.02 * height) | 1,) * 2, np.uint8)).astype(bool)
        if (apart & hands[1]).any():
            return []
    return hands


def restore(original: Image.Image, frame: Image.Image, source_labels, frame_labels, fit=None):
    """`frame` with the photo's hands; `fit` is the refit the frame went through (factor, zone, chin, neck), or None."""
    if source_labels is None or frame_labels is None or frame.size != original.size:
        return frame
    source_labels, frame_labels = np.asarray(source_labels), np.asarray(frame_labels)
    if fit:
        original, source_labels = body_fit.narrow(original, source_labels, *fit)
    person = (source_labels > 0) & (source_labels != BAG)
    rows = np.where(person.any(axis=1))[0]
    if len(rows) < 20:
        return frame
    height = rows[-1] - rows[0]
    photo = np.asarray(original.convert('RGB')).astype(np.float32)
    out = np.asarray(frame.convert('RGB')).astype(np.float32)
    theirs_all = np.isin(frame_labels, ARMS)
    sleeves = np.isin(frame_labels, SLEEVES)
    ring = lambda radius: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * max(1, round(radius)) + 1,) * 2)
    size = (photo.shape[1], photo.shape[0])
    for hand in _hands(source_labels, height):
        reach = cv2.dilate(hand.astype(np.uint8), ring(SHIFT_REACH * height)).astype(bool)
        theirs = theirs_all & reach
        if theirs.sum() < .4 * hand.sum():
            continue
        # The editor keeps the arm but not its hand to the pixel: the photo's hand is moved onto
        # the editor's, where their outlines agree best.
        ys, xs = np.where(hand)
        pad = int(SHIFT_REACH * height)
        # Scaled about the wrist too: the editor tends to draw the hand a little larger.
        anchor_x, anchor_y = xs.mean(), ys.min()
        best = None
        for scale in SCALES:
            transform = np.float32([[scale, 0, anchor_x * (1 - scale)], [0, scale, anchor_y * (1 - scale)]])
            scaled = cv2.warpAffine(hand.astype(np.uint8), transform, size, flags=cv2.INTER_NEAREST).astype(bool)
            sy, sx = np.where(scaled)
            if not len(sy):
                continue
            top, bottom, left, right = sy.min(), sy.max() + 1, sx.min(), sx.max() + 1
            y0, x0 = max(0, top - pad), max(0, left - pad)
            area = theirs[y0:bottom + pad, x0:right + pad]
            if area.shape[0] < bottom - top or area.shape[1] < right - left:
                continue
            score = cv2.matchTemplate(area.astype(np.float32), scaled[top:bottom, left:right].astype(np.float32), cv2.TM_CCORR_NORMED)
            _, _, _, (lx, ly) = cv2.minMaxLoc(score)
            transform[0, 2] += x0 + lx - left
            transform[1, 2] += y0 + ly - top
            moved = cv2.warpAffine(hand.astype(np.uint8), transform, size, flags=cv2.INTER_NEAREST).astype(bool)
            fit = (moved & theirs).sum() / max(1, (moved | theirs).sum())
            if best is None or fit > best[0]:
                best = (fit, transform, moved)
        if best is None or best[0] < HAND_MATCH:
            continue
        _, shift, moved = best
        laid = cv2.warpAffine(photo, shift, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        # The new sleeve covers the wrist; the photo's hand goes only where the look has no sleeve.
        mine = moved & ~sleeves
        if mine.sum() < 50:
            continue
        # The photo's hand in the look's light: its mean colour moved toward the editor's hand, a little.
        both = mine & theirs
        if both.sum() > 30:
            laid += np.clip(out[both].mean(axis=0) - laid[both].mean(axis=0), -12, 12)
        # The editor's fingers reaching past the photo's hand are painted over from what lies around them:
        # left, they showed as a second thumb. Only from the top of the hand down; above is the forearm.
        hand_top = np.where(moved.any(axis=1))[0].min()
        ghost = theirs & ~sleeves & ~mine & (np.arange(hand.shape[0])[:, None] >= hand_top)
        if ghost.sum() > 10:
            hole = cv2.dilate(ghost.astype(np.uint8), ring(2)) & ~cv2.erode(mine.astype(np.uint8), ring(1))
            # Filled from around the editor's whole hand, never from its own skin.
            whole = cv2.dilate((theirs & ~sleeves & (np.arange(hand.shape[0])[:, None] >= hand_top)).astype(np.uint8), ring(2)) | hole
            filled = cv2.inpaint(out.clip(0, 255).astype(np.uint8), whole, 5, cv2.INPAINT_TELEA).astype(np.float32)
            out = np.where(hole[..., None] > 0, filled, out)
        alpha = cv2.GaussianBlur(mine.astype(np.float32), (0, 0), 1.)[..., None]
        out = out * (1 - alpha) + laid * alpha
    return Image.fromarray(out.clip(0, 255).round().astype(np.uint8))
