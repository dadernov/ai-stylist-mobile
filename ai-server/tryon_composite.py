"""Keep everything except the replaced garments from the original photo.

FASHN redraws the whole frame on every pass, so a look with several garments
drifts: the background warps, the face changes, and body parts nobody asked to
restyle get repainted. Try-on is only trustworthy when the person stays the
person, so the final image is assembled here instead of being taken as-is —
generated pixels are kept where a garment was actually replaced, and every
other pixel comes back from the original photo.

The geometry is derived from the person silhouette (rembg alpha), not from the
frame: a photo where the model stands off-centre or fills half the crop must
work exactly like a centred full-height shot.
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# Zones a slot is allowed to repaint, as a fraction of the person's height
# measured from the top of the silhouette. Generous on purpose: a coat reaches
# the knees, trousers start above the hip line, a hem falls over the shoe.
SLOT_ZONES = {
    "top": (0.0, 0.72),
    "outer": (0.0, 0.92),
    "long_outer": (0.0, 1.0),
    "one_piece": (0.0, 1.0),
    "bottom": (0.30, 1.0),
    "shoes": (0.72, 1.0),
}


def person_alpha(size, cutout: Image.Image | None):
    """Silhouette alpha scaled to `size`, or None when the cutout is not usable."""
    if cutout is None:
        return None
    alpha = cutout.convert("RGBA").getchannel("A")
    if alpha.size != size:
        alpha = alpha.resize(size, Image.Resampling.LANCZOS)
    coverage = float((np.asarray(alpha) > 128).mean())
    # A silhouette that covers almost nothing or almost everything means the
    # segmentation failed; guessing from it would be worse than not composing.
    if not 0.04 < coverage < 0.97:
        return None
    return alpha


def silhouette_bbox(alpha: Image.Image):
    mask = np.asarray(alpha) > 128
    rows = np.where(mask.any(axis=1))[0]
    columns = np.where(mask.any(axis=0))[0]
    if not len(rows) or not len(columns):
        return None
    return int(columns[0]), int(rows[0]), int(columns[-1]) + 1, int(rows[-1]) + 1


def head_box(alpha: Image.Image):
    """Locate the head by the shoulder step in the silhouette.

    Scanning down from the crown the row width stays near the head width and
    then jumps at the shoulders. That jump is the only landmark needed to lock
    the head without pasting the original collar back over the new garment.
    """
    bbox = silhouette_bbox(alpha)
    if bbox is None:
        return None
    x0, y0, x1, y1 = bbox
    mask = np.asarray(alpha)[y0:y1, x0:x1] > 128
    height = mask.shape[0]
    if height < 24:
        return None
    widths = mask.sum(axis=1).astype(float)
    # Head width reference: the widest of the first rows, which is stable even
    # when the crown is rounded or hair sticks out.
    probe = max(3, int(height * 0.04))
    head_width = float(np.max(widths[:probe]))
    if head_width <= 0:
        return None
    limit = int(height * 0.45)
    shoulder_row = None
    for row in range(probe, limit):
        if widths[row] > head_width * 1.55:
            shoulder_row = row
            break
    if shoulder_row is None or shoulder_row < height * 0.04:
        return None
    # Stop just above the shoulders: the neck belongs to the garment, not the head.
    head_rows = mask[:shoulder_row]
    columns = np.where(head_rows.any(axis=0))[0]
    if not len(columns):
        return None
    return x0 + int(columns[0]), y0, x0 + int(columns[-1]) + 1, y0 + shoulder_row


def _feather(mask: Image.Image, radius: float):
    return mask.filter(ImageFilter.GaussianBlur(radius=max(1.0, radius)))


def build_keep_mask(size, original_alpha, generated_alpha, changed_slots, protected_heads=()):
    """White where the original photo must win over the generated image."""
    width, height = size
    keep = Image.new("L", size, 0)
    exact = Image.new("L", size, 0)
    scale = min(width, height)

    silhouettes = [alpha for alpha in (original_alpha, generated_alpha) if alpha is not None]
    if silhouettes:
        union = silhouettes[0]
        for alpha in silhouettes[1:]:
            union = Image.fromarray(np.maximum(np.asarray(union), np.asarray(alpha)), mode="L")
        # The union allows a new, wider garment without repainting distant background.
        body = union.point(lambda value: 255 if value > 128 else 0)
        background = Image.eval(body, lambda value: 255 - value)
        keep.paste(background, (0, 0))
        exact.paste(background, (0, 0))

    if original_alpha is None:
        return _feather(keep, scale * 0.004)

    bbox = silhouette_bbox(original_alpha)
    person_mask = original_alpha.point(lambda value: 255 if value > 128 else 0)

    head = head_box(original_alpha)
    if head is not None:
        hx0, hy0, hx1, hy1 = head
        pad_x = (hx1 - hx0) * 0.12
        pad_y = (hy1 - hy0) * 0.06
        head_mask = Image.new("L", size, 0)
        ImageDraw.Draw(head_mask).ellipse(
            (hx0 - pad_x, hy0 - pad_y * 3, hx1 + pad_x, hy1 + pad_y),
            fill=255,
        )
        head_mask = Image.fromarray(
            np.minimum(np.asarray(head_mask), np.asarray(person_mask)), mode="L"
        )
        keep = Image.fromarray(np.maximum(np.asarray(keep), np.asarray(head_mask)), mode="L")

    # Zones are fractions of a whole body, so they only mean anything when the
    # whole body is in frame. On a waist-up shot 0.72 lands in the middle of the
    # very garment being replaced, and freezing it would cut the new one in half.
    # The head is the ruler: it takes about a seventh of a standing figure and a
    # third or more of a half-length portrait.
    head_ratio = (head[3] - head[1]) / max(1, bbox[3] - bbox[1]) if head is not None and bbox is not None else 1.0
    full_body = head is not None and head_ratio <= 0.22

    if bbox is not None and changed_slots and full_body:
        x0, y0, x1, y1 = bbox
        person_height = max(1, y1 - y0)
        allowed = []
        for slot in changed_slots:
            zone = SLOT_ZONES.get(slot)
            if zone is None:
                # Unknown slot: assume it may touch anything and lock nothing.
                allowed = [(0.0, 1.0)]
                break
            allowed.append(zone)
        top = min(start for start, _ in allowed)
        bottom = max(end for _, end in allowed)
        frozen = Image.new("L", size, 0)
        draw = ImageDraw.Draw(frozen)
        if top > 0.02:
            draw.rectangle((0, 0, width, y0 + person_height * top), fill=255)
        if bottom < 0.98:
            draw.rectangle((0, y0 + person_height * bottom, width, height), fill=255)
        frozen = Image.fromarray(
            np.minimum(np.asarray(frozen), np.asarray(person_mask)), mode="L"
        )
        keep = Image.fromarray(np.maximum(np.asarray(keep), np.asarray(frozen)), mode="L")

    softened = np.asarray(_feather(keep, min(3, scale * 0.003)))
    # Blend only inside the garment boundary. Outside it, source pixels win exactly.
    exact_draw = ImageDraw.Draw(exact)
    for box in protected_heads:
        exact_draw.rectangle(box, fill=255)
    return Image.fromarray(np.maximum(softened, np.asarray(exact)), mode='L')


def compose(original: Image.Image, generated: Image.Image, original_cutout, generated_cutout, changed_slots, protected_heads=()):
    """Blend the generated garments onto the untouched original person."""
    generated = generated.convert("RGB")
    original = original.convert("RGB")
    source_ratio = original.width / max(1, original.height)
    target_ratio = generated.width / max(1, generated.height)
    # A different aspect ratio means the model recomposed the shot; pixels no
    # longer line up, and blending would smear the person instead of fixing it.
    if abs(source_ratio - target_ratio) > 0.02 * max(source_ratio, target_ratio):
        return original, "aspect-mismatch"

    generated = generated.resize(original.size, Image.Resampling.LANCZOS)
    original_alpha = person_alpha(generated.size, original_cutout)
    generated_alpha = person_alpha(generated.size, generated_cutout)
    if original_alpha is None or generated_alpha is None:
        return original, "no-silhouette"
    if not protected_heads:
        return original, 'no-face-protection'

    keep = build_keep_mask(generated.size, original_alpha, generated_alpha, changed_slots, protected_heads)
    return Image.composite(original, generated, keep), "composed"
