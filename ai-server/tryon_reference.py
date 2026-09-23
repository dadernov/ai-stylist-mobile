"""Arrange selected originals once, preserving each complete garment and hem."""
from PIL import Image, ImageOps
from io import BytesIO

import image_color
import tryon_policy


def decode(content):
    # Bound retained reference memory before composing a multi-item board.
    with Image.open(BytesIO(content)) as source:
        source.draft('RGB', (2048, 2048))
        image = image_color.to_srgb(ImageOps.exif_transpose(source))
        image.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
        return image


def build(images):
    if not 2 <= len(images) <= 4 or any(slot not in ('top', 'bottom', 'outer', 'shoes') for slot in images):
        raise ValueError('Expected two to four supported garment references')
    if set(images) == {'top', 'bottom', 'outer'}:
        boxes = {'top': (0, 0, 1024, 1024), 'bottom': (0, 1024, 1024, 2048), 'outer': (1024, 0, 2048, 2048)}
        positions = {'top': 'upper left', 'bottom': 'lower left', 'outer': 'right'}
    else:
        slots = [slot for slot in ('top', 'bottom', 'outer', 'shoes') if slot in images]
        cells = [(0, 0, 1024, 2048), (1024, 0, 2048, 2048)] if len(slots) == 2 else [
            (0, 0, 1024, 1024), (1024, 0, 2048, 1024), (0, 1024, 1024, 2048), (1024, 1024, 2048, 2048)]
        names = ['left', 'right'] if len(slots) == 2 else ['upper left', 'upper right', 'lower left', 'lower right']
        boxes, positions = dict(zip(slots, cells)), dict(zip(slots, names))
    board = Image.new('RGB', (2048, 2048), 'white')
    for slot, photo in images.items():
        x0, y0, x1, y1 = boxes[slot]
        photo = image_color.to_srgb(ImageOps.exif_transpose(photo))
        photo = ImageOps.contain(photo, (x1-x0-24, y1-y0-24), Image.Resampling.LANCZOS)
        position = (x0+(x1-x0-photo.width)//2, y0+(y1-y0-photo.height)//2)
        board.paste(photo, position, photo.getchannel('A') if photo.mode == 'RGBA' else None)
    board.info['icc_profile'] = image_color.SRGB_BYTES
    return board, positions


def prompt(positions, top_category='', outer_category='', tuck='auto'):
    names = {'top': 'one-piece garment' if top_category in tryon_policy.ONE_PIECE else 'inner top',
             'bottom': 'lower-body garment', 'outer': 'outer garment', 'shoes': 'footwear'}
    items = ', '.join(f'{names[slot]} at {position}' for slot, position in positions.items())
    text = (f'Wear all selected items in the product reference together as one outfit: {items}. '
            'Replace the corresponding original clothes completely. Preserve each reference color, cut, print and full hem. '
            f'{tryon_policy.IDENTITY} '
            'Ignore unrelated objects and backgrounds in the product reference. ')
    if 'top' in positions:
        text += 'Remove the old collar, neckline and cuffs; use only the selected top neckline. '
        if top_category not in tryon_policy.ONE_PIECE:
            text += tryon_policy.fit_instruction(tuck)
    if 'bottom' in positions:
        text += tryon_policy.TROUSERS
    if 'outer' in positions:
        if 'top' in positions:
            text += 'Wear the outer garment fully open and unfastened, all buttons undone, with the inner top and print visible. '
        else:
            text += 'Match the reference outerwear fastening state. '
        text += 'Do not tuck the outer garment. '
        if outer_category in tryon_policy.LONG_OUTER:
            text += 'Keep the full long outerwear hem below the hips, never shorten it to a shirt. '
    if 'shoes' not in positions:
        text += tryon_policy.FOOTWEAR
    return text
