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
        # Described as it looks: told only "untucked", the editor cropped a polo
        # to end exactly at the belt.
        return ('Wear the top completely untucked: its hem hangs loose outside the trousers at the garment\'s full natural '
                'length, below the waistband, covering the waistband and the belt area, which are not visible. '
                'No front tuck, side tuck or half-tuck. Do not shorten or crop the garment. ')
    return ''


def garment_prompt(slot, category='', tuck='auto', keep_outer_open=False, length=None):
    if slot == 'outer':
        inner_fit = f'For the inner top only, never the outerwear: {fit_instruction(tuck)}' if tuck in ('tucked', 'untucked') else ''
        length = ('This is a long outer garment, not a shirt. Reproduce the entire garment from collar to hem, '
                  'including the panels extending below the hips and over the legs. Match the hem length in the product photo. '
                  'Do not crop, tuck, shorten or transform it into a T-shirt. '
                  if length == 'long' or (length is None and category in LONG_OUTER) else '')
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


def composite_slot(slot, category='', length=None):
    if slot == 'legwear':
        # Tights change the legs, as trousers would.
        return 'bottom'
    if slot == 'outer' and (length == 'long' or (length is None and category in LONG_OUTER)):
        return 'long_outer'
    if slot == 'top' and category in ONE_PIECE:
        return 'one_piece'
    return slot


# The classifier's names describe a typical photo of each category; in a prompt
# they become orders. "A crop top" cut a long sleeveless top off at the ribs, and
# "a sleeveless top" took the sleeves off a T-shirt-like top: its sleeves and
# length are said from its own photo instead (look_prompt).
PROMPT_NOUNS = {'Топ': 'a top'}


# A shirt photographed open at the collar put its neck label on the front of the
# wearer's neck. Labels sit inside a garment and never show when it is worn.
INSIDE_LABELS = ('A brand, size or care label sewn inside a garment, at the back of the collar or neckline or inside the waistband, '
                 'stays inside it out of sight when it is worn: no label or tag shows anywhere on the person, least of all at the '
                 'front of the neck. ')


# A general image editor sees the photo and every garment at once (fal_tryon).
# One instruction names each image by its position and carries the same rules
# as the single-garment prompts above.
LOOK_NAMES = {'top': 'top', 'top2': 'outerwear', 'top3': 'outerwear', 'top4': 'outerwear', 'bottom': 'lower-body garment',
              'outer': 'outerwear', 'outer2': 'outermost layer, worn over the outerwear', 'shoes': 'pair of shoes',
              'legwear': 'pair of tights'}
LOOK_IDENTITY = ('Keep everything else in image 1 exactly as it is: the same canvas, framing, camera angle and zoom, '
                 'pose, face, expression, hair, skin, body shape, hands and background. '
                 'Image 1 is the exact canvas of the result: the head, face and body keep exactly the same position, '
                 'size and angle in the frame, so the result can be laid over image 1 pixel for pixel. '
                 'Do not crop, zoom, move, turn, slim or retouch the person. '
                 # A pendant from a bare-chested photo kept showing on top of every new top.
                 'Remove any necklace, chain or pendant the person wears in image 1: no jewellery is visible on the new clothes. '
                 # A T-shirt photographed from the back turned the whole body round:
                 # back pockets and elbows to the front under the user's own face.
                 'The person faces the camera exactly as in image 1: the face, chest, stomach, knees and toes point forward, '
                 # Told only "keep their pose", hands clasped at the waist came out as arms folded on the chest in three runs of six.
                 'and the arms and hands stay exactly where they are in image 1: hands held together in front stay together at the '
                 'same height, hands in pockets stay in the pockets, hanging arms keep hanging; the arms are never folded, crossed or '
                 'moved to another place. Never turn the person or show them from behind. A garment image may show '
                 'the back of the garment: then its back print, back pockets and back seams stay on the person\'s back, out of sight, '
                 'and the front of the garment is what shows. '
                 # A bulky coat in the photo made every new garment as broad as the coat.
                 'Every garment fits the person\'s real body closely, as it would in life, in the person\'s own size: the shoulders, '
                 'chest, waist and hips keep the person\'s own width. The volume of the clothes worn in image 1 is not part of the body: '
                 'never make the person broader. ')


# Layers without sleeves of their own: a knit vest, a waistcoat.
SLEEVELESS_LAYERS = {'Жилет', 'Майка', 'Топ'}
# The outermost sleeves' length is said with the outfit itself (look_prompt), for
# garments that always have long sleeves: a shirt or a blouse may be short-sleeved.
SLEEVES_IN_OUTFIT = True
LONG_SLEEVED = {'Пиджак', 'Бомбер', 'Куртка', 'Пальто', 'Тренч', 'Плащ', 'Пуховик', 'Парка', 'Шуба',
                'Кардиган', 'Свитер', 'Худи', 'Свитшот', 'Лонгслив', 'Водолазка'}
# Short sleeves under long ones: told their sleeves were "inside the coat's sleeves",
# a T-shirt came out as a long-sleeve, its white cuffs showing at the wrists, unevenly.
SHORT_SLEEVED = {'Футболка', 'Поло'}
SHORT_SLEEVES_TOLD = True


def _trait(traits, slot, name):
    value = (traits or {}).get(slot)
    return value.get(name) if isinstance(value, dict) else None


def sleeve_length(slot, categories, traits):
    """'long', 'short', 'none' or None: measured from the garment's photo, else what its category always has.

    A category is only a guess: polos, shirts, blouses, dresses and sweaters come
    with either sleeve, so each garment's photo is read (clothing_analysis); the
    category answers only when the photo left it open.
    """
    if _trait(traits, slot, 'sleeves'):
        return _trait(traits, slot, 'sleeves')
    category = categories.get(slot, '')
    if category in SLEEVELESS_LAYERS:
        return 'none'
    if category in LONG_SLEEVED:
        return 'long'
    return 'short' if category in SHORT_SLEEVED else None


def is_long(slot, categories, traits=None):
    """Long below the hips: read from its photo; a coat, a trench or a parka is assumed so only when the photo left it open."""
    measured = _trait(traits, slot, 'length')
    return measured == 'long' or (measured is None and categories.get(slot, '') in LONG_OUTER)


def opens_at_front(slot, categories, traits=None):
    """Zips or buttons down the front: read from its photo (a zip hoodie does, a pullover does not), else by its category."""
    measured = _trait(traits, slot, 'opening')
    return measured == 'front' or (measured is None and categories.get(slot, '') in OPEN_FRONT)


def length_sentence(slot, image, categories, traits=None):
    """What the prompt says of a garment's length: what its photo showed, never what its category suggests."""
    measured = _trait(traits, slot, 'length')
    if measured == 'long':
        return f'The garment in image {image} is long: keep its full length below the hips and never shorten it. '
    if measured == 'cropped':
        return f'The garment in image {image} is cropped: it ends at the waist, as in its photo; never lengthen it. '
    if measured is None and categories.get(slot, '') in LONG_OUTER:
        # Unread, a coat is not assumed long: a short one came out down to the knees.
        return f'Keep the length of the garment in image {image} exactly as in its photo: neither shorten nor lengthen it. '
    return ''


def length_words(slot, categories, traits=None):
    """The length said with the garment itself, where its name would suggest another: a short overcoat, a long cardigan."""
    measured = _trait(traits, slot, 'length')
    category = categories.get(slot, '')
    if measured == 'cropped':
        return ', cropped, ending at the waist'
    if measured == 'hip' and category in LONG_OUTER:
        return ', hip-length, ending at the hips'
    if measured == 'long' and category not in LONG_OUTER and category not in ONE_PIECE:
        return ', long, reaching below the hips'
    return ''


# Upper layers over the base top, from the inside out. Seedream layered a shirt
# reliably when it was called outerwear and dropped it as a "second top", so
# every layer over the base top is described in outerwear terms.
UPPER_LAYERS = ('top2', 'top3', 'top4', 'outer', 'outer2')
UPPER_ROLES = ('outerwear', 'second layer, worn over the outerwear', 'outermost layer, worn over everything')
# A look carries at most this many garments on the upper body, the base top included.
MAX_UPPER_LAYERS = 4


def upper_roles(count):
    """Roles of `count` layers over the base top, inside out; up to three read as before."""
    if count < 3:
        return UPPER_ROLES[:count]
    return UPPER_ROLES[:2] + ('third layer, worn over the second layer',) * (count - 3) + UPPER_ROLES[2:]


# What the user can set per garment in the app: tuck a top in or out, wear
# something that fastens open or closed. "Auto" sends nothing and the look
# reads exactly as without these options.
TUCKABLE = {'Футболка', 'Поло', 'Лонгслив', 'Рубашка', 'Блуза', 'Топ', 'Майка', 'Водолазка', 'Свитер', 'Свитшот'}
FASTENABLE = {'Рубашка', 'Блуза', 'Кардиган', 'Жилет', 'Пиджак', 'Бомбер', 'Куртка', 'Пальто', 'Тренч', 'Плащ', 'Пуховик', 'Парка', 'Шуба'}


def garment_options(raw, categories, openings=None):
    """The per-garment choices that apply: {slot: {'tuck': ..., 'fasten': ...}} without 'auto' or nonsense.

    `openings` holds whether each garment's photo shows it opening at the front
    ('front', 'none' or None when unsure): a zip hoodie is fastened or opened as
    chosen, a pullover is not; only an unread garment is judged by its category.
    """
    openings = openings or {}
    chosen = {}
    for slot, value in (raw or {}).items():
        if not isinstance(value, dict):
            continue
        category = categories.get(slot, '')
        option = {}
        if value.get('tuck') in ('tucked', 'untucked') and category in TUCKABLE:
            option['tuck'] = value['tuck']
        opens = openings.get(slot) == 'front' or (openings.get(slot) is None and category in FASTENABLE)
        if value.get('fasten') in ('open', 'closed') and opens:
            option['fasten'] = value['fasten']
        if option:
            chosen[slot] = option
    return chosen


# A tailored jacket closes at the waist under open lapels: told to close "up to
# the collar", a blazer stayed wide open over the top.
TAILORED = {'Пиджак'}


def fasten_instruction(state, noun, image, under=None, category=''):
    """How a garment the user chose to fasten or open is worn; `under` names what it closes over.

    Said right after the outfit, as part of it: told last, "fully closed" left a
    trench open as in its photo, the editor keeping the shirt under it in sight.
    """
    if state == 'closed' and category in TAILORED:
        over = f' over the {under}' if under else ''
        shown = f'only the neckline of the {under}' if under else 'only the neckline'
        return (f'The {noun} from image {image} is worn buttoned{over}: its front button is fastened at the waist, the two fronts '
                f'overlap there and fall closed to the hem; above the button the lapels open in a V that shows {shown}. ')
    if state == 'closed':
        if under:
            # Overlapping panels describe a buttoned coat; a zipped jacket told so stayed open or half zipped.
            return (f'The {noun} from image {image} is worn fully closed over the {under}, zipped or buttoned all the way up: '
                    f'there is no opening down its front anywhere from the hem to the neck, the zip pull or the top button sits right '
                    f'under its collar, and a belt, if it has one, is tied; of the {under} only the neckline shows above the collar '
                    f'of the {noun}, any print on the {under} stays covered, and below it only what reaches past its hem. ')
        return (f'The {noun} from image {image} is buttoned all the way down the front, its two sides closed over the body; '
                'only the top button may stay open. ')
    return (f'The {noun} from image {image} is worn open: every button or the zip is undone '
            'and its front panels hang apart, showing the clothes under it. ')


def legwear_instruction(image, shoes):
    """Tights go on the bare legs: under the skirt or dress, into the shoes.

    Told only not to shorten the dress, the editor showed the tights anyway: it
    cut a midi skirt above the knee or turned its tulle see-through.
    """
    return (f'The tights from image {image} are worn on both legs from the waist down to the toes, under the skirt, dress or shorts '
            f'and {"inside the shoes" if shoes else "over the feet"}. They show only where the legs show, below the hem; a long skirt '
            'or dress simply hides them. The skirt or dress keeps exactly its own length, fullness and opacity from its image: it is '
            'never shortened, lifted or made see-through to show the tights. '
            f'The tights keep the colour, sheerness and texture of image {image}: through sheer tights the skin shows as a soft even '
            f'tint, opaque tights hide it; the light and shadow on the legs in image {image} are no stripes or pattern. ')


def layer_tuck_instruction(state, noun, image):
    if state == 'tucked':
        return f'Tuck the {noun} from image {image} into the trousers or skirt all around the waist. '
    return f'Wear the {noun} from image {image} untucked: its hem hangs loose over the trousers at its full length. '


def look_prompt(slots, top_category='', outer_category='', tuck='auto', names=None, categories=None, options=None, traits=None):
    """`slots` in the order their images follow the photo; `names` maps a category to an English noun.

    `categories` maps a slot to its wardrobe category; the two arguments before
    it are the categories of `top` and `outer` for callers without layers.
    `options` holds the user's per-garment choices (garment_options); the
    base top's tuck comes in `tuck`. `traits` maps a slot to what was read from
    the garment's own photo (clothing_analysis.read_garment): its sleeves, length
    and front opening, each None where the reading was unsure.
    """
    names = names or {}
    traits = traits or {}
    categories = {'top': top_category, 'outer': outer_category, **(categories or {})}
    options = options or {}
    noun_of = lambda slot: _bare(names.get(categories.get(slot, ''), '')) or 'garment'
    layer_order = [slot for slot in ('top', *UPPER_LAYERS) if slot in slots]
    closed_over = lambda slot: any(options.get(over, {}).get('fasten') == 'closed'
                                   for over in layer_order[layer_order.index(slot) + 1:]) if slot in layer_order else False
    upper = [slot for slot in UPPER_LAYERS if slot in slots]
    role = dict(zip(upper, upper_roles(len(upper))))
    image = {slot: index for index, slot in enumerate(slots, start=2)}
    described = []
    # The outermost layer with sleeves: told at its end of the prompt only, a jacket over a
    # long-sleeve came out with sleeves ending at the elbow and the long-sleeve's black cuffs below.
    length = lambda slot: sleeve_length(slot, categories, traits)
    sleeved = [slot for slot in layer_order if slot in upper and length(slot) != 'none']
    outermost = sleeved[-1] if sleeved and SLEEVES_IN_OUTFIT and length(sleeved[-1]) == 'long' else None
    for slot in slots:
        category = categories.get(slot, '')
        noun = 'one-piece garment' if slot == 'top' and category in ONE_PIECE else names.get(category, '')
        worn = length_words(slot, categories, traits) + {'closed': ', worn fastened shut', 'open': ', worn open'}.get(options.get(slot, {}).get('fasten'), '')
        inner = outermost and slot in layer_order and layer_order.index(slot) < layer_order.index(outermost)
        if slot == outermost:
            # Said loosely, the same jacket came out with sleeves at the forearm in one look and over the hands in the next.
            worn += ', its sleeves long: both end at the same height, right at the wrist bones, as in its photo'
        elif inner and length(slot) == 'short' and SHORT_SLEEVES_TOLD:
            worn += (f', with short sleeves ending above the elbow, hidden under the {noun_of(outermost)}: '
                     'nothing of it shows at the wrists')
        elif inner and length(slot) == 'long':
            worn += (f', its sleeves hidden inside the sleeves of the {noun_of(outermost)} all the way: '
                     'no cuff or band of it shows below them at the wrists')
        elif inner and length(slot) == 'none':
            worn += ', sleeveless'
        elif not inner and slot in layer_order and (_trait(traits, slot, 'sleeves') or length(slot) == 'none'):
            # Read from its photo: said so the editor keeps them, whatever the person wears in image 1.
            worn += {'long': ', with long sleeves', 'short': ', with short sleeves', 'none': ', sleeveless'}[length(slot)]
        described.append(f'image {image[slot]} is the {role.get(slot) or LOOK_NAMES[slot]}' + (f': {noun}' if noun else '') + worn)
    # The user's fastening choices belong to the outfit itself, so they are told with it.
    stack = [slot for slot in ('top', *UPPER_LAYERS) if slot in slots]
    fastening = ''.join(
        fasten_instruction(options[slot]['fasten'], noun_of(slot), image[slot],
                           under=noun_of(stack[stack.index(slot) - 1]) if stack.index(slot) > 0 else None,
                           category=categories.get(slot, ''))
        for slot in stack if options.get(slot, {}).get('fasten'))
    text = ('Virtual try-on. Image 1 is a full-length photo of a person. '
            f'Dress this person in the outfit from the other images: {"; ".join(described)}. {fastening}'
            'Replace the matching original clothes completely and reproduce every reference garment faithfully: '
            'exact colour, print, lettering, fabric, cut, length and fit. '
            'Ignore backgrounds, hangers, mannequins and people in the garment images. '
            f'{INSIDE_LABELS}'
            'Prints, logos and details of one garment must never appear on another. '
            f'{LOOK_IDENTITY}')
    if len(upper) > 1:
        # Editors tend to drop one garment of a layered look; name the rule.
        text += f'The result must show all {len(slots)} garments at once; none may be left out. '
    if 'top' in slots and categories['top'] in ONE_PIECE:
        text += 'Show the complete one-piece garment down to its hem; do not cut it off at the waist. '
    elif 'top' in slots:
        text += 'Use only the new neckline and sleeves; no collar, cuffs or hem of the old top may remain. '
        # A crop top or a tunic: its own length, read from its photo.
        if _trait(traits, 'top', 'length') in ('cropped', 'long'):
            text += length_sentence('top', image['top'], categories, traits)
        # Under a coat worn closed a tuck does not show; asked for anyway, it made the editor open the coat.
        text += '' if closed_over('top') else fit_instruction(tuck)
    if 'top' in slots and 'top2' in slots:
        # The inner top may peek out at the neck, never below the hem of the one over it.
        text += (f'The top in image {image["top"]} is worn under the garment in image {image["top2"]}: it may show only at the '
                 f'neckline, and it never sticks out below the hem of the garment in image {image["top2"]}; '
                 'below that hem only the trousers show. ')
    if 'bottom' in slots:
        text += TROUSERS
    if 'legwear' in slots:
        text += legwear_instruction(image['legwear'], 'shoes' in slots)
    # A sweater or a hoodie over other tops goes on over the head: the layers
    # under it are closed and show only at its neckline, the ones over it are
    # open over it. Looks without one read exactly as before.
    pullover = next((slot for slot in upper if slot in ('top3', 'top4') and not opens_at_front(slot, categories, traits)), None)
    if pullover:
        noun = lambda slot: _bare(names.get(categories.get(slot, ''), '')) or 'garment'
        stack = [slot for slot in ('top', *upper) if slot in slots]
        text += ('From the body outwards the upper layers are: '
                 + ', '.join(f'the {noun(slot)} (image {image[slot]})' for slot in stack) + '. ')
    for index, slot in enumerate(upper):
        if pullover and upper.index(slot) < upper.index(pullover):
            sentence = (f'The {noun(slot)} from image {image[slot]} is worn closed under the {noun(pullover)} from image {image[pullover]}: '
                        f'only its collar shows at the neckline of the {noun(pullover)}, and nothing of it shows below the hem of the {noun(pullover)}. ')
        elif pullover and upper.index(slot) > upper.index(pullover):
            sentence = (f'Wear the {noun(slot)} from image {image[slot]} open over the {noun(pullover)}, '
                        f'which stays clearly visible at the front. ')
        elif index == 0:
            sentence = ('Wear the outerwear fully open and unfastened, with the new top and its print clearly visible. '
                        if 'top' in slots else 'Match the open or closed state of the outerwear reference. ')
            sentence += 'Do not tuck the outerwear. '
        elif slot == pullover:
            sentence = (f'Wear the {role[slot].split(",")[0]} from image {image[slot]} pulled on over the layers beneath it: '
                        f'they may show only at its neckline and never below its hem. ')
        else:
            sentence = (f'Wear the {role[slot].split(",")[0]} from image {image[slot]} open over the layers beneath it, '
                        'so each of them stays visible at the front, collar or hem. ')
        # The user's own choice for this garment replaces what is assumed for it.
        chosen = options.get(slot, {})
        if chosen.get('fasten'):
            # Already told with the outfit; the assumed open or closed state no longer applies.
            sentence = 'Do not tuck the outerwear. ' if index == 0 and not chosen.get('tuck') else ''
        if chosen.get('tuck') and not closed_over(slot):
            sentence = sentence.replace('Do not tuck the outerwear. ', '') + layer_tuck_instruction(chosen['tuck'], noun_of(slot), image[slot])
        text += sentence
        text += length_sentence(slot, image[slot], categories, traits)
        if length(slot) == 'long':
            # A jacket over a long-sleeve came out with sleeves ending mid-forearm, the inner cuffs showing below.
            text += (f'The sleeves of the garment in image {image[slot]} keep their full length down to the wrists, '
                     'and the sleeves of the layers under it stay inside them. ')
        elif length(slot) == 'short':
            # Told to reach the wrists like any jacket's, a short-sleeved shirt over a T-shirt got long sleeves.
            text += f'The garment in image {image[slot]} has short sleeves, as in its photo: never lengthen them. '
    if 'shoes' in slots:
        text += 'Put the reference shoes on both feet, keeping each foot at its original position. '
    else:
        text += FOOTWEAR + ' '
    return text + 'The result is a photorealistic photo with the lighting and colours of image 1.'


def _bare(noun):
    """'a sweatshirt' -> 'sweatshirt'."""
    for article in ('a ', 'an '):
        if noun.startswith(article):
            return noun[len(article):]
    return noun


def layer_prompt(upper, categories, names, base_top='', traits=None):
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
        how = 'unbuttoned and open over' if opens_at_front(slot, categories, traits) or not slot.startswith('top') else 'worn over'
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
            f'{INSIDE_LABELS}'
            'Prints, logos and details of one garment must never appear on another. ')
    for index, slot in enumerate(upper, start=2):
        text += length_sentence(slot, index, categories, traits)
    return text + 'The result is a photorealistic photo with the lighting of image 1.'


# Layers go on in their natural order, whichever was picked first: a T-shirt
# goes under a long-sleeve, a shirt under a sweater, a blazer under a coat.
# Unknown ones go over the known ones, in the order they were picked.
TOP_LAYER_ORDER = {'Майка': 0, 'Топ': 0, 'Футболка': 1, 'Поло': 1, 'Лонгслив': 2, 'Водолазка': 2,
                   'Рубашка': 3, 'Блуза': 3, 'Свитер': 4, 'Худи': 4, 'Свитшот': 4, 'Кардиган': 5, 'Жилет': 5}
OUTER_LAYER_ORDER = {'Пиджак': 0, 'Бомбер': 1, 'Куртка': 1, 'Пальто': 2, 'Тренч': 2, 'Плащ': 2,
                     'Пуховик': 2, 'Парка': 2, 'Шуба': 2}


def natural_layers(layers, order):
    """(content, mime, category, ...) layers inside out, the empty ones last as (None, None, '', {}...).

    Anything after the category (the user's options) travels with its garment.
    """
    present = [layer for layer in layers if layer[0]]
    present.sort(key=lambda layer: order.get((layer[2] or '').strip(), 99))
    empty = (None, None, '') + tuple({} for _ in range(len(layers[0]) - 3))
    return present + [empty] * (len(layers) - len(present))


# Garments usually worn open over another top.
OPEN_FRONT = {'Рубашка', 'Блуза', 'Кардиган', 'Жилет'}


def bria_instruction(slots, top_category='', outer_category='', tuck='auto', outer_length=None):
    """Extra direction for Bria's try-on, which has its own base instruction."""
    parts = []
    if 'top' in slots and top_category not in ONE_PIECE:
        parts.append(fit_instruction(tuck))
    if 'outer' in slots:
        if 'top' in slots:
            parts.append('Wear the outerwear open over the top.')
        if outer_length == 'long' or (outer_length is None and outer_category in LONG_OUTER):
            parts.append('Keep the full length of the long outerwear.')
    parts.append('Keep the face, pose, framing and background unchanged.')
    return ' '.join(part.strip() for part in parts if part.strip())
