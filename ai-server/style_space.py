"""How well garments go together, learned from outfits real people put together (Polyvore).

Each garment's photo becomes a short "style vector": the production SigLIP embedding projected into a small space
(style_space.npz, trained by tools/training/compat.py) where pieces worn together lie close. A look's harmony is
how close its pieces are there. On held-out outfits it picks the real missing piece among four of the same kind 69%
of the time (25% by chance, 53% with the raw embedding) and tells a real outfit from a shuffled one with AUC 0.89.

The vector travels with the item as 64 signed bytes in base64, so the app keeps it and sends it with the wardrobe.
"""
import base64
import io
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

from clothing_analysis import CATEGORIES, get_classifier, prompt_signature

SPACE = Path(__file__).parent / 'style_space.npz'
ONE_PIECE = {'Платье', 'Сарафан', 'Комбинезон'}
SECTION = {name: section for name, section, _ in CATEGORIES}
_space = None


def _load():
    global _space
    if _space is None:
        path = Path(os.getenv('AI_STYLE_SPACE', SPACE))
        if not path.exists():
            _space = False
        else:
            with np.load(path, allow_pickle=False) as data:
                _space = (data['P'].astype(np.float32), data['E'].astype(np.float32), [str(s) for s in data['slots']])
    return _space or None


def slot(category, section=''):
    if category in ONE_PIECE:
        return 'Цельное'
    return SECTION.get(category) or section or 'Верх'


def vector(content: bytes, category='', section=''):
    """The garment's style vector as base64, or None when the space is not installed."""
    space = _load()
    if space is None:
        return None
    projection, offsets, slots = space
    classifier = get_classifier()
    with Image.open(io.BytesIO(content)) as image:
        image = ImageOps.exif_transpose(image)
        if image.mode in ('RGBA', 'LA') or (image.mode == 'P' and 'transparency' in image.info):
            # A cut-out card picture: on white, as the outfits' product photos are.
            rgba = image.convert('RGBA')
            white = Image.new('RGB', rgba.size, 'white')
            white.paste(rgba, mask=rgba.getchannel('A'))
            image = white
        frame = classifier._fit(image.convert('RGB'))
    embedding = classifier._embed([frame])[0]
    name = slot(category, section)
    z = embedding @ projection + offsets[slots.index(name) if name in slots else 0]
    z /= max(np.linalg.norm(z), 1e-8)
    return base64.b64encode(np.clip(np.round(z * 127), -127, 127).astype(np.int8).tobytes()).decode()


def decode(value):
    try:
        raw = np.frombuffer(base64.b64decode(value, validate=True), dtype=np.int8).astype(np.float32)
    except (ValueError, TypeError):
        return None
    space = _load()
    if space is None or raw.shape != (space[0].shape[1],):
        return None
    return raw / max(np.linalg.norm(raw), 1e-8)


def harmony(values):
    """Mean closeness of the pieces that have a vector; None with fewer than two."""
    vectors = [v for v in (decode(value) for value in values if value) if v is not None]
    if len(vectors) < 2:
        return None
    z = np.stack(vectors)
    g = z @ z.T
    n = len(vectors)
    return float((g.sum() - n) / (n * (n - 1)))
