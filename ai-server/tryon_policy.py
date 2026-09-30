"""Quality profiles and garment-specific instructions, shared by API callers."""
import os
from typing import NamedTuple

MODEL = 'tryon-max'
MODE = 'quality'
CACHE_VERSION = 'v20-draft-and-final'

# Price of one tryon-max call in FASHN credits by (generation_mode, resolution),
# from https://help.fashn.ai/plans-and-pricing/api-pricing. The cost of a look
# is derived from this table rather than configured separately, so the quota
# can never drift from what the provider actually bills.
CREDITS = {
    ('fast', '1k'): 1, ('fast', '2k'): 2, ('fast', '4k'): 3,
    ('balanced', '1k'): 2, ('balanced', '2k'): 3, ('balanced', '4k'): 4,
    ('quality', '1k'): 3, ('quality', '2k'): 4, ('quality', '4k'): 5,
}

# Most try-ons are a quick "how would this look", so they run as a cheap draft;
# the high-quality final is generated only when the user asks for it. A final
# costs four times a draft per garment. The draft profile is configurable on
# the server so that, if drafts look too rough on real photos, it can be raised
# to balanced or 2k without shipping a new app.
_DEFAULT_PROFILES = {'draft': ('fast', '1k'), 'final': ('quality', '2k')}


class Profile(NamedTuple):
    name: str
    mode: str
    resolution: str
    credits: int


def profile(name):
    name = name if name in _DEFAULT_PROFILES else 'final'
    default_mode, default_resolution = _DEFAULT_PROFILES[name]
    prefix = f'FASHN_{name.upper()}_'
    # FASHN_QUALITY_RESOLUTION predates profiles and still sets the final one.
    fallback_resolution = os.getenv('FASHN_QUALITY_RESOLUTION', default_resolution) if name == 'final' else default_resolution
    mode = os.getenv(prefix + 'MODE', default_mode).strip().lower()
    resolution = os.getenv(prefix + 'RESOLUTION', fallback_resolution).strip().lower()
    if (mode, resolution) not in CREDITS:
        mode, resolution = default_mode, default_resolution
    return Profile(name, mode, resolution, CREDITS[(mode, resolution)])


def normalize_quality(value):
    """Map the request field to a profile name.

    The app names the two modes 'fast' and 'quality'; 'draft' and 'final' are
    accepted too. Anything unknown is a final, so an old client that always
    sends 'quality' keeps getting exactly what it got before.
    """
    value = value.strip().lower() if isinstance(value, str) else ''
    return 'draft' if value in ('fast', 'draft') else 'final'

# One provider call per selected garment, innermost first: the product image of
# tryon-max is one product. A board of several garments produced extra limbs,
# exposed leg strips and missing feet; single garments keep the anatomy intact.
STRATEGY = 'sequential'
STAGE_ORDER = ('bottom', 'shoes', 'top', 'outer')
LONG_OUTER = {'Плащ', 'Тренч', 'Пальто', 'Шуба', 'Парка'}
ONE_PIECE = {'Платье', 'Сарафан', 'Комбинезон'}
IDENTITY = ('Keep the exact source framing, camera, lighting, pose, face, hair, skin and background. '
            'Do not retouch or move the person. Preserve every visible hand and finger at its original position; '
            'do not erase hands, put them in pockets, fuse them into sleeves or cover them with cuffs. '
            'Change only the specified garment, including its complete silhouette.')
FOOTWEAR = ('Preserve the existing bare feet or worn shoes, including toes, laces, soles and contact shadows. '
            'Keep bare feet bare. Shoes or slippers lying on the floor are background, not footwear to put on. '
            'Keep each foot attached to its original ankle at the original floor contact point. '
            'Only hide skin or footwear where the new garment actually covers it.')
TROUSERS = ('If the reference is trousers or jeans, put each leg fully inside its corresponding trouser leg, '
            'following the source hips, knees and ankles, without an exposed original leg beside or through the trousers. '
            'Keep the reference width, rise, length and natural drape. Never turn a reference skirt into trousers. ')


def fit_instruction(tuck):
    if tuck == 'tucked':
        return ('Fully tuck the top into the trousers or skirt all around the waist. '
                'The waistband must be visible in front of the top; no loose hem over it and no half-tuck. ')
    if tuck == 'untucked':
        return ('Wear the top completely untucked, with its full natural hem outside and over the waistband. '
                'No front tuck, side tuck or half-tuck. Do not shorten the garment. ')
    return ''


def garment_prompt(slot, category='', tuck='auto', keep_outer_open=False):
    if slot == 'outer':
        inner_fit = f'For the inner top only, never the outerwear: {fit_instruction(tuck)}' if tuck in ('tucked', 'untucked') else ''
        length = ('This is a long outer garment, not a shirt. Reproduce the entire garment from collar to hem, '
                  'including the panels extending below the hips and over the legs. Match the hem length in the product photo. '
                  'Do not crop, tuck, shorten or transform it into a T-shirt. ' if category in LONG_OUTER else '')
        opening = ('Wear the outer garment fully open and unfastened. Leave all buttons and zippers undone, '
                   'with separated front panels and the selected inner top and its print clearly visible. '
                   'Do not close, button up, zip up, or belt the coat shut. ' if keep_outer_open else
                   'Match the open or closed state of the product photo; do not change its fastening state. ')
        return (f'{IDENTITY} Wear the reference {category or "outerwear"} as the outermost layer. {length}'
                f'{opening}Preserve its sleeves, front opening, lapels, belt and proportions. The garment may cover the existing '
                f'clothes and legs where its length requires. Preserve underlying clothes only where still visible. '
                f'{inner_fit}Do not tuck the outer garment. {FOOTWEAR}')
    if slot == 'top' and category in ONE_PIECE:
        return f'{IDENTITY} Wear the complete reference one-piece garment including its full skirt or trouser legs and hem. Do not cut it off at the waist. {FOOTWEAR}'
    if slot == 'top':
        fit = fit_instruction(tuck) or 'Match the natural fit of the reference. '
        return (f'{IDENTITY} Replace the existing top completely, not as an extra layer. '
                'Remove the old collar, neckline, cuffs, sleeves and hem wherever the reference top replaces them. '
                'Use only the reference neckline; do not leave a shirt collar underneath a T-shirt. '
                f'Preserve the reference print, lettering and proportions. {fit}{FOOTWEAR}')
    if slot == 'bottom':
        return f'{IDENTITY} Replace only the lower-body garment, preserving its full length, rise and cut. {TROUSERS}{fit_instruction(tuck)}{FOOTWEAR}'
    return f'{IDENTITY} Replace only the footwear. Keep all clothing unchanged. {fit_instruction(tuck)}'


def composite_slot(slot, category=''):
    if slot == 'outer' and category in LONG_OUTER:
        return 'long_outer'
    if slot == 'top' and category in ONE_PIECE:
        return 'one_piece'
    return slot


# A general image editor sees the photo and every garment at once (fal_tryon).
# One instruction names each image by its position and carries the same rules
# as the single-garment prompts above.
LOOK_NAMES = {'top': 'top', 'top2': 'outerwear', 'bottom': 'lower-body garment',
              'outer': 'outerwear', 'outer2': 'outermost layer, worn over the outerwear', 'shoes': 'pair of shoes'}
LOOK_IDENTITY = ('Keep everything else in image 1 exactly as it is: the same canvas, framing, camera angle and zoom, '
                 'pose, face, expression, hair, skin, body shape, hands and background. '
                 'Image 1 is the exact canvas of the result: the head, face and body keep exactly the same position, '
                 'size and angle in the frame, so the result can be laid over image 1 pixel for pixel. '
                 'Do not crop, zoom, move, turn, slim or retouch the person. '
                 # A pendant from a bare-chested photo kept showing on top of every new top.
                 'Remove any necklace, chain or pendant the person wears in image 1: no jewellery is visible on the new clothes. ')


# Upper layers over the base top, from the inside out. Seedream layered a shirt
# reliably when it was called outerwear and dropped it as a "second top", so
# every layer over the base top is described in outerwear terms.
UPPER_LAYERS = ('top2', 'outer', 'outer2')
UPPER_ROLES = ('outerwear', 'second layer, worn over the outerwear', 'outermost layer, worn over everything')


def look_prompt(slots, top_category='', outer_category='', tuck='auto', names=None, categories=None):
    """`slots` in the order their images follow the photo; `names` maps a category to an English noun.

    `categories` maps a slot to its wardrobe category; the two arguments before
    it are the categories of `top` and `outer` for callers without layers.
    """
    names = names or {}
    categories = {'top': top_category, 'outer': outer_category, **(categories or {})}
    upper = [slot for slot in UPPER_LAYERS if slot in slots]
    role = {slot: UPPER_ROLES[index] for index, slot in enumerate(upper)}
    image = {slot: index for index, slot in enumerate(slots, start=2)}
    described = []
    for slot in slots:
        category = categories.get(slot, '')
        noun = 'one-piece garment' if slot == 'top' and category in ONE_PIECE else names.get(category, '')
        described.append(f'image {image[slot]} is the {role.get(slot) or LOOK_NAMES[slot]}' + (f': {noun}' if noun else ''))
    text = ('Virtual try-on. Image 1 is a full-length photo of a person. '
            f'Dress this person in the outfit from the other images: {"; ".join(described)}. '
            'Replace the matching original clothes completely and reproduce every reference garment faithfully: '
            'exact colour, print, lettering, fabric, cut, length and fit. '
            'Ignore backgrounds, hangers, mannequins and people in the garment images. '
            'Prints, logos and details of one garment must never appear on another. '
            f'{LOOK_IDENTITY}')
    if len(upper) > 1:
        # Editors tend to drop one garment of a layered look; name the rule.
        text += f'The result must show all {len(slots)} garments at once; none may be left out. '
    if 'top' in slots and categories['top'] in ONE_PIECE:
        text += 'Show the complete one-piece garment down to its hem; do not cut it off at the waist. '
    elif 'top' in slots:
        text += 'Use only the new neckline and sleeves; no collar, cuffs or hem of the old top may remain. '
        text += fit_instruction(tuck)
    if 'top' in slots and 'top2' in slots:
        # The inner top may peek out at the neck, never below the hem of the one over it.
        text += (f'The top in image {image["top"]} is worn under the garment in image {image["top2"]}: it may show only at the '
                 f'neckline, and it never sticks out below the hem of the garment in image {image["top2"]}; '
                 'below that hem only the trousers show. ')
    if 'bottom' in slots:
        text += TROUSERS
    for index, slot in enumerate(upper):
        if index == 0:
            text += ('Wear the outerwear fully open and unfastened, with the new top and its print clearly visible. '
                     if 'top' in slots else 'Match the open or closed state of the outerwear reference. ')
            text += 'Do not tuck the outerwear. '
        else:
            text += (f'Wear the {role[slot].split(",")[0]} from image {image[slot]} open over the layers beneath it, '
                     'so each of them stays visible at the front, collar or hem. ')
        if categories.get(slot) in LONG_OUTER:
            text += f'The garment in image {image[slot]} is long: keep its full length below the hips and never shorten it. '
    if 'shoes' in slots:
        text += 'Put the reference shoes on both feet, keeping each foot at its original position. '
    else:
        text += FOOTWEAR + ' '
    return text + 'The result is a photorealistic photo with the lighting and colours of image 1.'


def layer_prompt(upper, categories, names, base_top=''):
    """Second call of a layered look: put the upper layers over a finished base look.

    `upper` lists the layers inside out; each image follows the photo in that
    order. The wording is the one that kept both layers in every test run.
    """
    names = names or {}
    noun = lambda category, fallback: names.get(category, '') or fallback
    base = noun(base_top, 'the top they wear')
    steps, visible = [], [f'{base} in the middle']
    below = base
    for index, slot in enumerate(upper, start=2):
        garment = noun(categories.get(slot, ''), 'the garment')
        how = 'unbuttoned and open over' if categories.get(slot) in OPEN_FRONT or slot != 'top2' else 'worn over'
        steps.append(f'{"first" if index == 2 else "then"} {garment} from image {index}, {how} {below}')
        visible.append(f'{garment} {"around it" if index == 2 else "outside"}')
        below = garment
    count = len(upper)
    text = (f'Image 1 is a photo of a person. Put {"one extra layer" if count == 1 else f"{count} extra layers"} on this person '
            f'over the clothes they already wear: {"; ".join(steps)}. '
            f'All upper layers must be clearly visible: {", ".join(visible)}. '
            'Keep everything else in image 1 exactly as it is: the same person, face, hair, pose, framing and camera, '
            'the clothes underneath with their prints, the trousers, the shoes and the background. '
            'Reproduce every new layer faithfully: exact colour, fabric, cut, length and details. '
            'Ignore backgrounds, hangers, doors and objects in the garment images. '
            'Prints, logos and details of one garment must never appear on another. ')
    for index, slot in enumerate(upper, start=2):
        if categories.get(slot) in LONG_OUTER:
            text += f'The garment in image {index} is long: keep its full length below the hips and never shorten it. '
    return text + 'The result is a photorealistic photo with the lighting of image 1.'


# Two tops layer in their natural order, whichever was picked first: a T-shirt
# goes under a long-sleeve, a shirt under a sweater. Unknown ones keep the order.
TOP_LAYER_ORDER = {'Майка': 0, 'Топ': 0, 'Футболка': 1, 'Поло': 1, 'Лонгслив': 2, 'Водолазка': 2,
                   'Рубашка': 3, 'Блуза': 3, 'Свитер': 4, 'Худи': 4, 'Свитшот': 4, 'Кардиган': 5, 'Жилет': 5}


def inner_first(first_category, second_category):
    """True when the second top belongs under the first one."""
    return TOP_LAYER_ORDER.get(second_category, 99) < TOP_LAYER_ORDER.get(first_category, 99)


# Garments usually worn open over another top.
OPEN_FRONT = {'Рубашка', 'Блуза', 'Кардиган', 'Жилет'}


def bria_instruction(slots, top_category='', outer_category='', tuck='auto'):
    """Extra direction for Bria's try-on, which has its own base instruction."""
    parts = []
    if 'top' in slots and top_category not in ONE_PIECE:
        parts.append(fit_instruction(tuck))
    if 'outer' in slots:
        if 'top' in slots:
            parts.append('Wear the outerwear open over the top.')
        if outer_category in LONG_OUTER:
            parts.append('Keep the full length of the long outerwear.')
    parts.append('Keep the face, pose, framing and background unchanged.')
    return ' '.join(part.strip() for part in parts if part.strip())
