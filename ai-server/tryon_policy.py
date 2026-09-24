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
