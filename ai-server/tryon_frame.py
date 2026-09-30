"""Send the provider a frame it returns unchanged, then map the result back.

FASHN renders every model image on its own canvas. A full-height phone photo
(about 1:1.93) is narrower than the narrowest canvas the provider uses (24:43,
measured as 768x1376, 1143x2048 and 1536x2752 for the same source), so the
provider adds margins of its own and the person's scale and offset in the
result become uncertain. Padding the photo to that canvas here makes the result
a plain resize of what was sent: the background registers at scale 1.000 and
the original photo is a known crop of the returned frame.
"""
import cv2
import numpy as np
from PIL import Image, ImageOps

PROVIDER_RATIO = 24 / 43
TOLERANCE = .012


def pad(image, ratio=PROVIDER_RATIO):
    """Return (padded, box). The untouched original occupies `box` in `padded`.

    `ratio` is the narrowest canvas the provider keeps: FASHN's 24:43 by
    default. A general editor keeps the photo's own aspect down to about 1:3
    and redraws a padded person at another scale, so it gets a smaller ratio.
    """
    width, height = image.size
    if width / height >= ratio * (1 - TOLERANCE):
        return image, (0, 0, width, height)
    target = int(round(height * ratio))
    left = (target - width) // 2
    right = target - width - left
    pixels = np.asarray(image.convert('RGB'))
    padded = cv2.copyMakeBorder(pixels, 0, 0, left, right, cv2.BORDER_REPLICATE)
    # Replicated columns are streaks the generator may try to "continue".
    # A soft out-of-focus band gives it nothing to draw: no mirrored limbs,
    # no invented furniture. The original pixels are pasted back verbatim.
    sigma = max(3., max(left, right) * .5)
    blurred = cv2.GaussianBlur(padded, (0, 0), sigma)
    blurred[:, left:left + width] = pixels
    result = Image.fromarray(blurred)
    result.info['icc_profile'] = image.info.get('icc_profile')
    return result, (left, 0, left + width, height)


def matches(size, target_size):
    """True when a provider frame has the aspect of `target_size` within rounding."""
    ratio = target_size[0] / target_size[1]
    return abs(size[0] / size[1] - ratio) <= TOLERANCE * ratio


def to_source_frame(generated, original_size, padded_size, box):
    """Map a provider frame back onto the original photo without stretching.

    A frame with the padded aspect is a uniform resize of what was sent and the
    photo is a known crop of it. Any other aspect means the provider chose its
    own canvas around the photo: uniform scale plus centre crop, still
    validated afterwards by background registration and face landmarks.
    """
    if tuple(padded_size) != tuple(original_size) and matches(generated.size, padded_size):
        return generated.resize(tuple(padded_size), Image.Resampling.LANCZOS).crop(box)
    return ImageOps.fit(generated, tuple(original_size), method=Image.Resampling.LANCZOS)
