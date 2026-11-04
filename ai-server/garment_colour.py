"""The garment's colour as one of the app's 27 named colours.

The app used to name the colour itself, as the nearest of its 27 by plain RGB distance to the
server's dominantColor: on real home photos that was right 49% of the time (shadows, casts and
skin pull it off). Here two opinions are joined:
- the colour head (colour_head.npz): a softmax layer over the SigLIP image vector /analyze already
  has (predict()'s embedding); trained on labelled garment photos, it tells navy from black and
  is not fooled by a shadow;
- the cut-out's main colour: skin dropped when it is only part of the picture, k-means in CIELAB,
  the biggest cluster, turned into a soft vote by its distance to each named colour.
name = argmax(log P_head + 0.5 * log P_pixels): 88% right on real photos, 77% on catalogue shots
(catdata RECOGNITION_REPORT.md, section 4.3). The confidence is the head's probability of that name.
That sum alone lets the head overrule any measurement: a ΔE of 20 is worth only 1.3 nats, and the head was taught
from English "khaki" (a tan) under the name Хаки (a grey-green), so it called caramel garments Хаки. So the measured
colour also refuses names outright (_refused), but only when the measurement can be trusted.
No head file, no answer: the fields are left out and the app names the colour as before.
"""
import os
from pathlib import Path
import threading

import numpy as np
from PIL import Image

# The app's colours (src/screens/WardrobeScreen.tsx namedColors), in this order, with their reference hexes.
NAMED = [("Белый", "#FFFFFF"), ("Молочный", "#FFF8E7"), ("Кремовый", "#FFF4D6"), ("Бежевый", "#F5F5DC"), ("Песочный", "#E6D1A3"),
         ("Карамельный", "#CDAA7D"), ("Коричневый", "#8B5A2B"), ("Черный", "#000000"), ("Графит", "#3A3A3A"), ("Серый", "#808080"),
         ("Серебристый", "#BFC5C9"), ("Синий", "#1E88E5"), ("Синий деним", "#2F4B7C"), ("Голубой", "#4FC3F7"), ("Бирюзовый", "#26C6DA"),
         ("Зеленый", "#43A047"), ("Оливковый", "#7D8F3B"), ("Хаки", "#6B7B4A"), ("Желтый", "#FDD835"), ("Горчичный", "#C9A227"),
         ("Оранжевый", "#FB8C00"), ("Красный", "#E53935"), ("Бордовый", "#7B1E3B"), ("Розовый", "#F48FB1"), ("Пудровый", "#E5B6C6"),
         ("Фиолетовый", "#8E24AA"), ("Лавандовый", "#B39DDB")]
NAMES = [name for name, _ in NAMED]
HEAD_PATH = Path(__file__).parent / "colour_head.npz"
# How much the pixels weigh against the head, and how soft their vote is (CIELAB ΔE per unit of log-probability).
PIXEL_WEIGHT = 0.5
PIXEL_SOFTNESS = 8.0
# The measured colour may refuse names only if it has a hue and is not in deep shadow (shade greys and darkens, so a
# dull reading proves nothing), and the head is not all but certain.
VETO_MIN_CHROMA = 10.0
VETO_MIN_LIGHTNESS = 25.0
VETO_HEAD_CERTAIN = 0.999
# Hue: on a nearly one-coloured cut-out (a print or a person would mislead), a name this much further in the a*b* plane
# than the nearest name; a weak reading does not refuse a name of about its own hue (washed denim is a pale blue).
VETO_SOLID_SHARE = 0.8
VETO_NEAR = 10.0
VETO_HUE_MARGIN = 12.0
VETO_WEAK_CHROMA = 14.0
VETO_SAME_HUE_DEGREES = 45.0
# Lightness, on any cut-out: a name this much darker in L* than the garment (shade darkens a garment, it never lightens
# it) and with almost no pixel of that colour anywhere in the picture. Full CIELAB here: brown and caramel share a hue.
VETO_LIGHTNESS_GAP = 15.0
VETO_PRESENT_DISTANCE = 15.0
VETO_ABSENT_SHARE = 0.03


def srgb_to_lab(rgb):
    """sRGB 0-255 (any leading shape, last axis 3) to CIELAB under D65."""
    linear = np.asarray(rgb, np.float64) / 255.0
    linear = np.where(linear > 0.04045, ((linear + 0.055) / 1.055) ** 2.4, linear / 12.92)
    xyz = linear @ np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]]).T
    xyz = xyz / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


REFERENCE_LAB = srgb_to_lab(np.array([[int(code[i:i + 2], 16) for i in (1, 3, 5)] for _, code in NAMED]))


def _skin(pixels):
    """Skin by the usual YCrCb rule: a person's arms, neck or legs around a worn garment."""
    r, g, b = (pixels[:, channel].astype(np.float32) for channel in range(3))
    y = .299 * r + .587 * g + .114 * b
    cr, cb = (r - y) * .713 + 128, (b - y) * .564 + 128
    return (cr > 138) & (cr < 175) & (cb > 85) & (cb < 128) & (y > 60) & (r > g) & (g > b)


def main_colour(foreground: Image.Image):
    """The CIELAB colour of the cut-out's biggest colour cluster, or None with under 20 garment pixels.

    Sampled exactly as extract_palette samples it: 160 x 160, alpha resized NEAREST, alpha > 180.
    """
    rgb = np.asarray(foreground.convert("RGB").resize((160, 160)))
    alpha = np.asarray(foreground.getchannel("A").resize((160, 160), Image.Resampling.NEAREST))
    pixels = rgb[alpha > 180].reshape(-1, 3)
    if len(pixels) < 20:
        return None
    skin = _skin(pixels)
    if 0 < skin.mean() < 0.6:
        # Some skin around the garment is a person's; a garment that is all skin-toned keeps its pixels.
        pixels = pixels[~skin]
    generator = np.random.default_rng(0)
    if len(pixels) > 4000:
        pixels = pixels[generator.choice(len(pixels), 4000, replace=False)]
    lab = srgb_to_lab(pixels)
    centres = lab[generator.choice(len(lab), 4, replace=False)]
    for _ in range(12):
        labels = ((lab[:, None] - centres[None]) ** 2).sum(-1).argmin(1)
        centres = np.array([lab[labels == k].mean(0) if (labels == k).any() else centres[k] for k in range(4)])
    biggest = int(np.bincount(labels, minlength=4).argmax())
    return srgb_to_lab(np.median(pixels[labels == biggest], axis=0).astype(int))


def _refused(colour, foreground: Image.Image, head_certainty):
    """Which names the measured colour rules out, as a boolean per name: none when it cannot be trusted."""
    chroma = np.linalg.norm(colour[1:])
    if head_certainty >= VETO_HEAD_CERTAIN or colour[0] < VETO_MIN_LIGHTNESS or chroma < VETO_MIN_CHROMA:
        return np.zeros(len(NAMES), bool)
    rgb = np.asarray(foreground.convert("RGB").resize((160, 160)))
    alpha = np.asarray(foreground.getchannel("A").resize((160, 160), Image.Resampling.NEAREST))
    lab = srgb_to_lab(rgb[alpha > 180])
    ab = lab[:, 1:]
    reference_ab = REFERENCE_LAB[:, 1:]
    hue_distance = np.linalg.norm(reference_ab - colour[1:], axis=1)
    refused = hue_distance > hue_distance.min() + VETO_HUE_MARGIN
    if chroma < VETO_WEAK_CHROMA:
        angle = np.degrees(np.arctan2(reference_ab[:, 1], reference_ab[:, 0]) - np.arctan2(colour[2], colour[1]))
        same_hue = np.abs((angle + 180) % 360 - 180) < VETO_SAME_HUE_DEGREES
        refused &= ~(same_hue & (np.linalg.norm(reference_ab, axis=1) >= VETO_MIN_CHROMA))
    if (np.linalg.norm(ab - colour[1:], axis=1) < VETO_NEAR).mean() < VETO_SOLID_SHARE:
        refused[:] = False
    present = (np.linalg.norm(lab[:, None] - REFERENCE_LAB[None], axis=2) < VETO_PRESENT_DISTANCE).mean(0)
    return refused | ((colour[0] - REFERENCE_LAB[:, 0] > VETO_LIGHTNESS_GAP) & (present < VETO_ABSENT_SHARE))


_head = None
_head_lock = threading.Lock()


def load_head(path=None):
    """(W, b) of the colour head, or None when its file is missing or names other colours than the app's."""
    global _head
    path = Path(path or os.getenv("AI_COLOUR_HEAD", HEAD_PATH))
    with _head_lock:
        if _head is not None and _head[0] == path:
            return _head[1]
        head = None
        if not path.exists():
            print(f"Colour head {path.name} missing; colours named the old way", flush=True)
        else:
            try:
                with np.load(path, allow_pickle=False) as data:
                    if [str(name) for name in data["names"]] == NAMES and data["W"].shape[1] == len(NAMES):
                        head = (data["W"].astype(np.float32), data["b"].astype(np.float32))
                    else:
                        print(f"Colour head {path.name} names other colours than the app; colours named the old way", flush=True)
            except Exception as exc:
                print(f"Colour head {path.name} unreadable ({type(exc).__name__}); colours named the old way", flush=True)
        _head = (path, head)
        return head


def name_colour(embedding, foreground: Image.Image):
    """{"colorName": one of NAMES, "colorConfidence": 0..1} for a garment, or {} without the head.

    embedding: predict()'s L2-normalised image vector of the same picture (768-d);
    foreground: its RGBA cut-out (after the coverage fallback), as extract_palette gets it.
    """
    head = load_head()
    if head is None or embedding is None:
        return {}
    weights, bias = head
    embedding = np.asarray(embedding, np.float32)
    if embedding.shape != (weights.shape[0],) or not np.isfinite(embedding).all():
        return {}
    logits = embedding @ weights + bias
    head_probabilities = np.exp(logits - logits.max())
    head_probabilities /= head_probabilities.sum()
    score = np.log(head_probabilities + 1e-9)
    colour = main_colour(foreground)
    if colour is not None:
        vote = -np.linalg.norm(REFERENCE_LAB - colour[None], axis=1) / PIXEL_SOFTNESS
        score = score + PIXEL_WEIGHT * (vote - vote.max() - np.log(np.exp(vote - vote.max()).sum()))
        score = np.where(_refused(colour, foreground, head_probabilities.max()), -np.inf, score)
    best = int(score.argmax())
    return {"colorName": NAMES[best], "colorConfidence": round(float(head_probabilities[best]), 3)}
