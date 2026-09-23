"""One quality path and garment-specific instructions, shared by API callers."""
MODEL = 'tryon-max'
MODE = 'quality'
CACHE_VERSION = 'v8-quality-aspect-preserving-framing'
LONG_OUTER = {'Плащ', 'Тренч', 'Пальто', 'Шуба', 'Парка'}
ONE_PIECE = {'Платье', 'Сарафан', 'Комбинезон'}
IDENTITY = ('Keep the exact source framing, camera, lighting, pose, face, hair, skin and background. '
            'Do not retouch or move the person. Change only the specified garment, including its complete silhouette.')


def garment_prompt(slot, category='', tuck='auto'):
    if slot == 'outer':
        length = ('This is a long outer garment, not a shirt. Reproduce the entire garment from collar to hem, '
                  'including the panels extending below the hips and over the legs. Match the hem length in the product photo. '
                  'Do not crop, tuck, shorten or transform it into a T-shirt. ' if category in LONG_OUTER else '')
        return (f'{IDENTITY} Wear the reference {category or "outerwear"} as the outermost layer. {length}'
                'Preserve its sleeves, front opening, lapels, belt and proportions. The garment may cover the existing '
                'clothes and legs where its length requires. Preserve underlying clothes only where still visible.')
    if slot == 'top' and category in ONE_PIECE:
        return f'{IDENTITY} Wear the complete reference one-piece garment including its full skirt or trouser legs and hem. Do not cut it off at the waist.'
    if slot == 'top':
        fit = 'Tuck the shirt into the waistband.' if tuck == 'tucked' else 'Leave the top untucked.' if tuck == 'untucked' else 'Match the natural fit of the reference.'
        return f'{IDENTITY} Replace only the upper-body garment. {fit}'
    if slot == 'bottom':
        return f'{IDENTITY} Replace only the lower-body garment, preserving its full length, rise and cut.'
    return f'{IDENTITY} Replace only the footwear. Keep all clothing unchanged.'


def composite_slot(slot, category=''):
    if slot == 'outer' and category in LONG_OUTER:
        return 'long_outer'
    if slot == 'top' and category in ONE_PIECE:
        return 'one_piece'
    return slot
