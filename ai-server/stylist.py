"""The outfit ideas, put together by a language model that knows clothes, checked by rules that never bend.

The old ideas were hand-written rules over categories: every "Рубашка" looked
the same to them, a linen Hawaiian one or a white office one, and they knew
nothing of style, silhouette or texture. Now each garment gets a profile once,
from its own photo (`profile`): what it is, its colours, material, fit,
formality, warmth, the styles and occasions it suits. The stylist (`compose`)
reads the wardrobe as these profiles with the weather, the occasion and the
style asked for, and puts looks together the way a stylist would. Code then
checks what must hold whatever the model says (`check`): a whole outfit, one
bottom, nothing for summer in the cold, no look twice.

Calls go through fal (any-llm), the account already used for the try-on.
"""
import base64
import hashlib
import io
import json
import os
import re

import httpx
import numpy as np
from PIL import Image, ImageOps

import fal_tryon
import style_space

VISION_URL = 'https://fal.run/fal-ai/any-llm/vision'
TEXT_URL = 'https://fal.run/fal-ai/any-llm'


def model():
    return os.getenv('STYLIST_MODEL', 'anthropic/claude-haiku-5.5').strip()


STYLES = ['Кэжуал', 'Смарт-кэжуал', 'Минимализм', 'Классика', 'Офисный', 'Old money', 'Романтичный', 'Бохо', 'Спортивный',
          'Стритвир', 'Вечерний', 'Гранж', 'Преппи']

PROFILE_PROMPT = """You are a fashion stylist cataloguing one garment from its photo for a wardrobe app.
The owner filed it as: {category}.
Answer with JSON only, no prose, exactly these keys:
{{"kind": "precise garment type in English, e.g. 'oversized linen camp-collar shirt'",
 "colors": ["main colour", "other visible colours"],
 "hex": "#rrggbb of the main colour",
 "pattern": "solid | stripes | checks | print | floral | graphic | other",
 "material": "fabric as it looks",
 "fit": "slim | regular | relaxed | oversized | cropped | long",
 "formality": 1-5 (1 gym, 2 casual, 3 smart casual, 4 business, 5 evening/black tie),
 "warmth": 1-5 (1 hot summer, 3 mild, 5 deep winter),
 "styles": [up to 3 of {styles}],
 "occasions": [up to 4 short English words, e.g. office, date, walk, party, sport, travel, theatre],
 "seasons": [of winter, spring, summer, autumn],
 "notes": "one short English sentence on what it pairs well with"}}"""

COMPOSE_SYSTEM = """You are an experienced personal stylist. You build outfits only from the client's own wardrobe,
the way a good stylist would: a clear idea per look, colours that work together, proportions, textures and
formality that match each other and the occasion, and clothes right for the weather. You answer in JSON only."""

COMPOSE_PROMPT = """Client: {gender}. Occasion: {event}. Wanted style: {style}. Weather: {weather}.
{anchor}{avoid}
Wardrobe (id | section | category | name | profile):
{wardrobe}

Put together {count} different outfits for this situation, best first. Rules:
- Each outfit is complete: a top and a bottom, or a one-piece (dress, sundress, jumpsuit); shoes if the wardrobe has
  any; outerwear when it is cool (below about 15°C), raining or snowing; a bag when one suits.
- At most one bottom, one pair of shoes, one bag. Up to 4 tops may be layered (a T-shirt under a shirt under a sweater),
  only where layering is natural; tights only with a skirt, dress or shorts.
- Nothing summery (shorts, sandals, tank tops alone) below about 15°C; nothing heavy (down jackets, wool coats) above 20°C.
- Outerwear must be warm enough: warmth 4-5 below 0°C, at least 3 below 10°C.
- Respect formality: a theatre or an interview is not a hoodie; a walk is not a tuxedo; a bridal gown is only for
  the client's own wedding.
- The looks differ from one another in their main pieces; do not repeat the same top and bottom.
- Use only ids from the list, exactly as written.
Write the title, why and tips in {language}, in a warm, confident stylist's voice, without exclamation marks.
JSON: {{"looks": [{{"ids": ["..."], "title": "2-4 words", "why": "one or two sentences: the idea and why it works here",
 "tips": ["one or two short practical tips: how to wear, tuck, roll, accessorise"]}}]}}"""


def _call(url, payload, timeout=60.):
    key = fal_tryon.api_key()
    headers = {'Authorization': f'Key {key}', 'Content-Type': 'application/json', **fal_tryon.privacy_headers()}
    with httpx.Client(timeout=timeout, trust_env=False) as client:
        response = client.post(url, headers=headers, json=payload)
    if response.status_code >= 400:
        raise RuntimeError(f'stylist {response.status_code}')
    body = response.json()
    if body.get('error'):
        raise RuntimeError(f"stylist error {str(body['error'])[:120]}")
    return body.get('output') or ''


def _json(text):
    """The JSON object in a model's answer, fenced or not."""
    match = re.search(r'\{.*\}', text, re.S)
    if not match:
        raise ValueError('no json')
    return json.loads(match.group(0))


_profiles = {}


def profile(content: bytes, category=''):
    """A garment's profile from its photo, cached by its bytes; raises when the photo or the model fails."""
    key = (hashlib.sha1(content).hexdigest(), category)
    if key in _profiles:
        return _profiles[key]
    with Image.open(io.BytesIO(content)) as image:
        image = ImageOps.exif_transpose(image).convert('RGB')
        image.thumbnail((640, 640))
        buffer = io.BytesIO()
        image.save(buffer, 'JPEG', quality=85)
    url = 'data:image/jpeg;base64,' + base64.b64encode(buffer.getvalue()).decode()
    text = _call(VISION_URL, {'model': model(), 'image_urls': [url], 'max_tokens': 500, 'temperature': 0,
                              'prompt': PROFILE_PROMPT.format(category=category or 'unknown', styles=', '.join(STYLES))})
    result = _clean_profile(_json(text))
    if len(_profiles) > 2000:
        _profiles.clear()
    _profiles[key] = result
    return result


def _clean_profile(raw):
    def number(name):
        try:
            return max(1, min(5, int(round(float(raw.get(name))))))
        except (TypeError, ValueError):
            return None
    words = lambda name, limit: [str(value)[:40] for value in (raw.get(name) or []) if isinstance(value, (str, int))][:limit]
    hex_colour = str(raw.get('hex') or '')
    return {'kind': str(raw.get('kind') or '')[:80], 'colors': words('colors', 3),
            'hex': hex_colour if re.fullmatch(r'#[0-9a-fA-F]{6}', hex_colour) else None,
            'pattern': str(raw.get('pattern') or '')[:20], 'material': str(raw.get('material') or '')[:40],
            'fit': str(raw.get('fit') or '')[:20], 'formality': number('formality'), 'warmth': number('warmth'),
            'styles': [style for style in words('styles', 3) if style in STYLES], 'occasions': words('occasions', 4),
            'seasons': [season for season in words('seasons', 4) if season in ('winter', 'spring', 'summer', 'autumn')],
            'notes': str(raw.get('notes') or '')[:160]}


ONE_PIECE = {'Платье', 'Сарафан', 'Комбинезон'}
LEGWEAR = {'Колготки'}
SUMMER = {'Шорты', 'Сандалии', 'Майка', 'Топ', 'Сарафан'}
HEAVY = {'Пуховик', 'Шуба', 'Парка'}


def _line(item):
    p = item.get('profile') or {}
    parts = [p.get('kind') or '', ', '.join(p.get('colors') or []) or item.get('color') or '', p.get('pattern') or '',
             p.get('material') or '', p.get('fit') or '']
    if p.get('formality'):
        parts.append(f"formality {p['formality']}/5")
    if p.get('warmth'):
        parts.append(f"warmth {p['warmth']}/5")
    if p.get('styles'):
        parts.append('styles: ' + ', '.join(p['styles']))
    if p.get('notes'):
        parts.append(p['notes'])
    sleeves = (item.get('traits') or {}).get('sleeves')
    if sleeves:
        parts.append(f'{sleeves} sleeves')
    return f"{item['id']} | {item.get('section', '')} | {item.get('category', '')} | {item.get('name', '')[:40]} | " + '; '.join(x for x in parts if x)


HEAVY_WARMTH = {'Пуховик': 5, 'Шуба': 5, 'Парка': 5, 'Пальто': 4, 'Свитер': 4}


def _warmth(item):
    return (item.get('profile') or {}).get('warmth') or HEAVY_WARMTH.get(item.get('category'), 3)


def check(ids, items, temperature=None, precipitation=None):
    """The look kept if it holds whatever the model said; None when it cannot be worn."""
    by_id = {item['id']: item for item in items}
    look = [by_id[i] for i in dict.fromkeys(ids) if i in by_id]
    section = lambda item: item.get('section', '')
    category = lambda item: item.get('category', '')
    tops = [i for i in look if section(i) == 'Верх' and category(i) not in ONE_PIECE]
    one_piece = [i for i in look if category(i) in ONE_PIECE]
    bottoms = [i for i in look if section(i) == 'Низ' and category(i) not in LEGWEAR]
    legwear = [i for i in look if category(i) in LEGWEAR]
    shoes = [i for i in look if section(i) == 'Обувь']
    outer = [i for i in look if section(i) == 'Верхняя одежда']
    bags = [i for i in look if section(i) == 'Сумки']
    if len(one_piece) > 1 or len(bottoms) > 1 or len(shoes) > 1 or len(bags) > 1 or len(outer) > 2 or len(tops) > 4:
        return None
    if one_piece and (tops and not all(category(t) in ('Кардиган', 'Жилет', 'Пиджак') for t in tops) or bottoms):
        return None
    if not one_piece and not (tops and bottoms):
        return None
    if legwear and not (one_piece or any(category(b) in ('Юбка', 'Шорты') for b in bottoms)):
        return None
    if not shoes and any(section(i) == 'Обувь' for i in items):
        return None
    if temperature is not None:
        if temperature < 15 and any(category(i) in SUMMER for i in look) and not legwear:
            if any(category(i) in ('Шорты', 'Сандалии') for i in look):
                return None
        if temperature > 22 and any(category(i) in HEAVY for i in look):
            return None
        if (temperature < 12 or precipitation in ('rain', 'snow')) and not outer and any(section(i) == 'Верхняя одежда' for i in items):
            return None
        # The profile's warmth, where the garment has one: a leather jacket is outerwear, but not for a frost.
        needed = 4 if temperature <= 0 else 3 if temperature < 10 else 0
        coats = [i for i in items if section(i) == 'Верхняя одежда']
        if needed and outer and max(_warmth(i) for i in outer) < needed and any(_warmth(i) >= needed for i in coats):
            return None
        if temperature >= 20 and any(_warmth(i) >= 4 for i in look):
            return None
    return [i['id'] for i in look]


def _looks(text):
    """The looks in the answer, the whole ones even when the answer was cut off midway."""
    try:
        return [look for look in _json(text).get('looks') or [] if isinstance(look, dict)]
    except ValueError:
        pass
    looks = []
    for match in re.finditer(r'\{[^{}]*"ids"\s*:\s*\[[^\]]*\][^{}]*?(?:\[[^\]]*\][^{}]*)?\}', text):
        try:
            looks.append(json.loads(match.group(0)))
        except ValueError:
            continue
    return looks


def compose(items, context, count=4):
    """Looks for this wardrobe and situation: [{'itemIds', 'title', 'why', 'tips'}], best first."""
    usable = [item for item in items if item.get('id') and item.get('section') in ('Верх', 'Низ', 'Обувь', 'Верхняя одежда', 'Сумки')]
    if not usable:
        return []
    temperature, precipitation = context.get('temperature'), context.get('precipitation')
    weather = 'unknown' if temperature is None else f'{temperature}°C'
    if precipitation in ('rain', 'snow'):
        weather += f', {precipitation}'
    anchor = next((item for item in usable if item['id'] == context.get('anchorId')), None)
    avoid = context.get('avoid') or []
    prompt = COMPOSE_PROMPT.format(
        gender={'female': 'a woman', 'male': 'a man'}.get(context.get('gender'), 'unspecified gender'),
        event=context.get('event') or 'everyday', style=context.get('style') or 'any', weather=weather,
        anchor=f"Every outfit must include {anchor['id']} ({anchor.get('name', '')}).\n" if anchor else '',
        avoid=('Do not repeat these top-and-bottom pairs, the client put them aside: ' + '; '.join(avoid[:20]) + '\n') if avoid else '',
        wardrobe='\n'.join(_line(item) for item in usable[:220]), count=count + 4,
        language={'en': 'English', 'zh': 'Simplified Chinese'}.get(context.get('language'), 'Russian'))
    payload = {'model': model(), 'system_prompt': COMPOSE_SYSTEM, 'prompt': prompt, 'max_tokens': 4000, 'temperature': .7}
    try:
        answer = _looks(_call(TEXT_URL, payload, timeout=60.))
    except (RuntimeError, ValueError, httpx.HTTPError):
        answer = []
    if len(answer) < 2:  # a rare cut-off or empty answer: one more try
        answer = _looks(_call(TEXT_URL, payload, timeout=60.)) or answer
    looks, seen = [], set()
    for raw in answer:
        ids = check([str(i) for i in raw.get('ids') or []], usable, temperature, precipitation)
        if not ids or (anchor and anchor['id'] not in ids):
            continue
        core = ','.join(sorted(i for i in ids if next(x for x in usable if x['id'] == i).get('section') in ('Верх', 'Низ')))
        if core in seen:
            continue
        seen.add(core)
        looks.append({'itemIds': ids, 'title': str(raw.get('title') or '')[:60], 'why': str(raw.get('why') or '')[:400],
                      'tips': [str(tip)[:200] for tip in (raw.get('tips') or [])][:3]})
    return rank(looks, {item['id']: item for item in usable})[:count]


# How much the stylist's own order counts against how well the pieces go together on their photos:
# a real outfit scores about 0.23 above a shuffled one, so one place in the stylist's list is worth
# a seventh of that difference.
RANK_WEIGHT = .03


def rank(looks, by_id):
    """The stylist's looks, reordered by how well their pieces go together on their photos (style_space)."""
    scored = []
    for place, look in enumerate(looks):
        value = style_space.harmony([(by_id[i].get('styleVec') or '') for i in look['itemIds']])
        scored.append((place, look, value))
    known = [value for _, _, value in scored if value is not None]
    middle = float(np.median(known)) if known else 0.
    scored.sort(key=lambda entry: -((middle if entry[2] is None else entry[2]) - RANK_WEIGHT * entry[0]))
    return [look for _, look, _ in scored]
