"""One quality path and garment-specific instructions, shared by API callers."""
MODEL = 'tryon-max'
MODE = 'quality'
CACHE_VERSION = 'v10-neckline-edge-and-fit'
LONG_OUTER = {'Плащ', 'Тренч', 'Пальто', 'Шуба', 'Парка'}
ONE_PIECE = {'Платье', 'Сарафан', 'Комбинезон'}
IDENTITY = ('Keep the exact source framing, camera, lighting, pose, face, hair, skin and background. '
            'Do not retouch or move the person. Change only the specified garment, including its complete silhouette.')
FOOTWEAR = ('Preserve the existing shoes, laces, soles and contact shadows exactly. Do not redraw the feet or floor. '
            'Only hide footwear where the new garment actually covers it.')


def fit_instruction(tuck):
    if tuck == 'tucked':
        return ('Fully tuck the top into the trousers or skirt all around the waist. '
                'The waistband must be visible in front of the top; no loose hem over it and no half-tuck. ')
    if tuck == 'untucked':
        return ('Wear the top completely untucked, with its full natural hem outside and over the waistband. '
                'No front tuck, side tuck or half-tuck. Do not shorten the garment. ')
    return ''


def garment_prompt(slot, category='', tuck='auto'):
    if slot == 'outer':
        inner_fit = f'For the inner top only, never the outerwear: {fit_instruction(tuck)}' if tuck in ('tucked', 'untucked') else ''
        length = ('This is a long outer garment, not a shirt. Reproduce the entire garment from collar to hem, '
                  'including the panels extending below the hips and over the legs. Match the hem length in the product photo. '
                  'Do not crop, tuck, shorten or transform it into a T-shirt. ' if category in LONG_OUTER else '')
        return (f'{IDENTITY} Wear the reference {category or "outerwear"} as the outermost layer. {length}'
                'Preserve its sleeves, front opening, lapels, belt and proportions. The garment may cover the existing '
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
        return f'{IDENTITY} Replace only the lower-body garment, preserving its full length, rise and cut. {fit_instruction(tuck)}{FOOTWEAR}'
    return f'{IDENTITY} Replace only the footwear. Keep all clothing unchanged. {fit_instruction(tuck)}'


def composite_slot(slot, category=''):
    if slot == 'outer' and category in LONG_OUTER:
        return 'long_outer'
    if slot == 'top' and category in ONE_PIECE:
        return 'one_piece'
    return slot
