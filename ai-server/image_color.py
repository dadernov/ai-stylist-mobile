"""Normalize tagged inputs before mixing pixels from different photographs."""
from io import BytesIO

import cv2
import numpy as np
from PIL import Image, ImageCms


SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB'))
SRGB_BYTES = SRGB.tobytes()


def to_srgb(image):
    profile = image.info.get('icc_profile')
    alpha = image.convert('RGBA').getchannel('A') if image.mode in ('RGBA', 'LA') or 'transparency' in image.info else None
    pixels = image if image.mode in ('RGB', 'CMYK', 'LAB') else image.convert('RGB')
    if profile:
        try:
            pixels = ImageCms.profileToProfile(
                pixels, ImageCms.ImageCmsProfile(BytesIO(profile)), SRGB, outputMode='RGB'
            )
        except (ImageCms.PyCMSError, OSError, ValueError) as exc:
            raise ValueError('Не удалось прочитать цветовой профиль фото. Экспортируй его в sRGB и загрузи снова.') from exc
    else:
        pixels = pixels.convert('RGB')
    if alpha is not None:
        pixels.putalpha(alpha)
    pixels.info['icc_profile'] = SRGB_BYTES
    return pixels


def match_source_lighting(source, generated, source_labels, generated_labels):
    """Undo a provider-wide cast using unchanged background, never new clothes."""
    stride = max(1, round(max(source.size) / 512))
    original = np.asarray(source)[::stride, ::stride].astype(np.float32)
    prediction = np.asarray(generated)[::stride, ::stride].astype(np.float32)
    background = ((source_labels == 0) & (generated_labels == 0)).astype(np.uint8)
    radius = max(2, round(max(source.size) * .004))
    background = cv2.erode(background, np.ones((radius * 2 + 1, radius * 2 + 1), np.uint8))
    sample = background[::stride, ::stride].astype(bool)
    corrected = generated
    if sample.sum() >= 256:
        x, y = prediction[sample], original[sample]
        # Ignore moved edges, clipped highlights, and outliers such as shadows
        # introduced by the garment. No histogram matching against its colors.
        residual = y - x
        centre = np.median(residual, axis=0)
        deviation = np.median(np.abs(residual - centre), axis=0)
        stable = (np.abs(residual - centre) <= np.maximum(5, 3 * deviation)).all(axis=1)
        stable &= ((x > 8) & (x < 247) & (y > 8) & (y < 247)).all(axis=1)
        if stable.sum() >= 128:
            x, y = x[stable], y[stable]
            table = []
            for channel in range(3):
                a, b = x[:, channel], y[:, channel]
                variance = np.var(a)
                gain = np.mean((a - a.mean()) * (b - b.mean())) / variance if variance > 64 else 1.
                gain = float(np.clip(gain, .8, 1.25))
                offset = float(np.clip(np.median(b - gain * a), -32, 32))
                before = np.median(np.abs(b - a))
                after = np.median(np.abs(b - (gain * a + offset)))
                if before < 1 or after >= before * .8:
                    gain, offset = 1., 0.
                table.extend(np.rint(np.clip(np.arange(256) * gain + offset, 0, 255)).astype(int).tolist())
            corrected = generated.point(table)

    # A newly exposed neckline has no source skin to paste back. Match its tone
    # to the unchanged face, instead of leaving a pink rectangle under the chin.
    common_face = (source_labels == 11) & (generated_labels == 11)
    if common_face.sum() >= 32:
        delta = np.median(np.asarray(source)[common_face].astype(float) - np.asarray(corrected)[common_face], axis=0)
        delta = np.clip(delta, -24, 24)
        delta[np.abs(delta) < 1] = 0
        if np.any(delta):
            table = np.concatenate([np.rint(np.clip(np.arange(256) + offset, 0, 255)).astype(int) for offset in delta]).tolist()
            skin = corrected.point(table)
            mask = Image.fromarray((generated_labels == 11).astype(np.uint8) * 255)
            corrected = Image.composite(skin, corrected, mask)
    corrected.info['icc_profile'] = SRGB_BYTES
    return corrected
