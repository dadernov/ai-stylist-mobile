"""Local clothing recognition with a fashion-trained SigLIP and foreground colour extraction.

The model is Marqo's fashion SigLIP rather than plain CLIP: on a benchmark of
real garment photos general CLIP names the right category 76% of the time
against 93% for the fashion one, and the confidence it reports actually tracks
whether it is right, which is what lets the app stop asking the user to double
check every single item.
"""
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import threading

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps
from tokenizers import Tokenizer

CATEGORIES = [
    ("Футболка", "Верх", "a short sleeved crew neck t-shirt"),
    ("Поло", "Верх", "a polo shirt with a collar and short button placket"),
    ("Лонгслив", "Верх", "a long sleeved cotton t-shirt"),
    ("Рубашка", "Верх", "a button-down collared shirt"),
    ("Блуза", "Верх", "a flowing blouse"),
    ("Топ", "Верх", "a sleeveless crop top"),
    ("Майка", "Верх", "a tank top"),
    ("Водолазка", "Верх", "a turtleneck sweater with a high neck"),
    ("Свитер", "Верх", "a knitted pullover sweater"),
    ("Худи", "Верх", "a hooded sweatshirt with a hood"),
    ("Свитшот", "Верх", "a crewneck sweatshirt without a hood"),
    ("Кардиган", "Верх", "a knitted cardigan with an open front"),
    ("Жилет", "Верх", "a sleeveless vest"),
    ("Пиджак", "Верхняя одежда", "a tailored suit jacket or blazer with lapels"),
    ("Бомбер", "Верхняя одежда", "a bomber jacket with ribbed cuffs"),
    ("Куртка", "Верхняя одежда", "a leather or denim jacket"),
    ("Пальто", "Верхняя одежда", "a long wool overcoat"),
    ("Тренч", "Верхняя одежда", "a belted trench coat"),
    ("Плащ", "Верхняя одежда", "a lightweight raincoat"),
    ("Пуховик", "Верхняя одежда", "a quilted puffer down jacket"),
    ("Парка", "Верхняя одежда", "a hooded insulated parka"),
    ("Платье", "Верх", "a dress with a skirt attached to the bodice"),
    ("Сарафан", "Верх", "a sleeveless sundress"),
    ("Комбинезон", "Верх", "a one-piece jumpsuit with trouser legs"),
    ("Юбка", "Низ", "a skirt"),
    ("Джинсы", "Низ", "denim jeans with pockets and seams"),
    ("Брюки", "Низ", "tailored trousers or chinos"),
    ("Шорты", "Низ", "shorts"),
    ("Леггинсы", "Низ", "tight athletic leggings"),
    ("Колготки", "Низ", "sheer nylon tights or pantyhose"),
    ("Джоггеры", "Низ", "sweatpants or joggers with elastic cuffs"),
    ("Кроссовки", "Обувь", "athletic sneakers or running shoes"),
    ("Кеды", "Обувь", "canvas sneakers with a flat rubber sole"),
    ("Лоферы", "Обувь", "slip-on leather loafers"),
    ("Туфли", "Обувь", "formal leather dress shoes or pumps"),
    ("Ботинки", "Обувь", "ankle boots"),
    ("Сандалии", "Обувь", "open-toe sandals"),
    ("Сапоги", "Обувь", "tall knee-high boots"),
    ("Балетки", "Обувь", "ballet flat shoes"),
    ("Шапка", "Аксессуары", "a knitted beanie or winter hat"),
    ("Кепка", "Аксессуары", "a baseball cap with a visor"),
    ("Шляпа", "Аксессуары", "a brimmed hat such as a fedora, panama or sun hat"),
    ("Шарф", "Аксессуары", "a scarf or shawl"),
    ("Перчатки", "Аксессуары", "a pair of gloves or mittens"),
    ("Сумка", "Сумки", "a handbag or shoulder bag"),
    ("Рюкзак", "Сумки", "a backpack"),
    ("Клатч", "Сумки", "a small clutch purse")
]
PATTERNS = [
    ("Однотонный", "plain solid-colored clothing without a pattern"),
    ("Полоска", "striped clothing"),
    ("Клетка", "plaid checkered clothing"),
    ("Горох", "polka dot clothing"),
    ("Цветочный", "floral print clothing"),
    ("Принт", "clothing with a large printed graphic or lettering")
]
SHORT_NAMES = ["a t-shirt", "a polo shirt", "a long-sleeve t-shirt", "a button-up shirt", "a blouse", "a crop top", "a tank top",
               "a turtleneck", "a sweater", "a hoodie", "a sweatshirt", "a cardigan", "a vest", "a blazer", "a bomber jacket",
               "a jacket", "an overcoat", "a trench coat", "a raincoat", "a puffer jacket", "a parka", "a dress", "a sundress",
               "a jumpsuit", "a skirt", "jeans", "trousers", "shorts", "leggings", "tights", "sweatpants", "sneakers", "canvas shoes",
               "loafers", "dress shoes", "ankle boots", "sandals", "knee-high boots", "ballet flats",
               "a beanie", "a baseball cap", "a hat", "a scarf", "gloves", "a handbag", "a backpack", "a clutch bag"]

SCENES = ['a person wearing clothes', 'a clothing product alone without a person']

# One phrasing is one opinion. Averaging several before the comparison costs
# nothing at request time — the text side is precomputed — and removes the luck
# of whether a category happened to be described the way the model expects.
TEMPLATES = [
    "a photo of {}.",
    "a product photo of {} on a plain background.",
    "a close-up photo of {}.",
    "a photo of {}, a clothing item.",
    "a cropped photo of {}.",
]

# Thresholds measured against a labelled benchmark: at 0.70/0.30 the app asks
# the user to confirm roughly one item in five and still catches the genuinely
# ambiguous ones. The previous 0.80/0.40 flagged almost two thirds of items,
# including more than half of the answers that were in fact correct — which is
# what made recognition feel broken even when it was right.
# What a garment is like is its own, not its category's: polos, shirts, blouses,
# dresses and cardigans come short- and long-sleeved alike, a coat may be short,
# a hoodie or a sweater may zip open, a cardigan may be thin or chunky. Each is
# read from the photo, zero-shot; how its category usually is weighs in, so a
# jacket hanging on a hook, its sleeves out of sight, is not taken for
# sleeveless. Unsure readings say nothing (None), and the category answers.
# Measured on labelled garments, real photos and product shots, at TRAIT_SURE:
# sleeves 67 right / 0 wrong / 3 unsure of 70, front opening 36/0/3 of 39,
# bulk 17/0/2 of 19, length 30/2/7 of 39 (both misses between hip and long).
_OUTERWEAR = ("Пиджак", "Бомбер", "Куртка", "Пальто", "Тренч", "Плащ", "Пуховик", "Парка", "Шуба")
TRAITS = {
    "sleeves": {
        "classes": [
            ("long", ["a garment with long sleeves", "a long-sleeved top with sleeves down to the wrists", "a long sleeve shirt"]),
            ("short", ["a garment with short sleeves", "a short-sleeved top with sleeves ending above the elbow", "a short sleeve shirt"]),
            ("none", ["a sleeveless garment", "a sleeveless top with bare arms and shoulders", "a tank top or camisole without sleeves"]),
        ],
        "priors": {
            **{category: (.97, .02, .01) for category in _OUTERWEAR},
            **{category: (.95, .04, .01) for category in ("Худи", "Свитшот", "Лонгслив", "Водолазка")},
            "Свитер": (.8, .17, .03), "Кардиган": (.8, .17, .03),
            "Рубашка": (.6, .35, .05), "Блуза": (.45, .35, .2),
            "Поло": (.2, .78, .02), "Футболка": (.05, .93, .02),
            "Платье": (.35, .3, .35), "Комбинезон": (.35, .3, .35),
            **{category: (.05, .15, .8) for category in ("Топ", "Майка", "Сарафан", "Жилет")},
        },
        "default": (.4, .4, .2),
    },
    "length": {
        "classes": [
            ("cropped", ["a cropped garment ending at the waist", "a cropped jacket or top that ends above the waist", "a short cropped top"]),
            ("hip", ["a hip-length garment", "a regular length jacket or top ending at the hips", "a standard length garment"]),
            ("long", ["a long coat reaching the knees", "a long garment reaching below the hips to the thighs or knees", "a longline knee-length coat"]),
        ],
        "priors": {
            "Тренч": (.02, .18, .8), "Плащ": (.02, .18, .8), "Пальто": (.03, .4, .57), "Шуба": (.05, .45, .5), "Парка": (.03, .62, .35),
            "Пуховик": (.2, .6, .2), "Куртка": (.25, .7, .05), "Бомбер": (.12, .86, .02), "Пиджак": (.15, .78, .07),
            "Кардиган": (.25, .55, .2), "Жилет": (.2, .7, .1), "Топ": (.5, .45, .05), "Майка": (.2, .75, .05),
            **{category: (.2, .75, .05) for category in ("Худи", "Свитшот", "Свитер")},
            **{category: (.1, .85, .05) for category in ("Футболка", "Лонгслив", "Поло", "Водолазка")},
            "Рубашка": (.08, .8, .12), "Блуза": (.08, .8, .12),
        },
        "default": (.15, .7, .15),
    },
    "opening": {
        "classes": [
            ("front", ["a jacket or cardigan with a zipper running down the whole front", "a shirt or cardigan with buttons all the way down the front",
                       "a zip-up hoodie with a front zipper from hem to collar"]),
            ("none", ["a pullover hoodie with no zipper", "a pullover sweater or sweatshirt with no buttons or zipper", "a plain t-shirt or tank top"]),
        ],
        "priors": {
            **{category: (.97, .03) for category in _OUTERWEAR},
            "Рубашка": (.95, .05), "Кардиган": (.95, .05), "Блуза": (.6, .4), "Жилет": (.5, .5), "Худи": (.3, .7),
            "Свитшот": (.12, .88), "Свитер": (.08, .92), "Поло": (.05, .95), "Лонгслив": (.03, .97), "Водолазка": (.03, .97),
            "Футболка": (.02, .98), "Топ": (.02, .98), "Майка": (.02, .98), "Платье": (.3, .7), "Сарафан": (.3, .7), "Комбинезон": (.3, .7),
        },
        "default": (.5, .5),
    },
    "bulk": {
        "classes": [
            ("bulky", ["a thick bulky padded or chunky garment", "a puffy quilted or chunky knit garment", "a heavy thick warm garment"]),
            ("thin", ["a thin lightweight fitted garment", "a thin fine fabric garment", "a light thin shirt or top"]),
        ],
        "priors": {
            "Пуховик": (.9, .1), "Шуба": (.9, .1), "Парка": (.9, .1), "Пальто": (.6, .4),
            "Свитер": (.5, .5), "Кардиган": (.5, .5), "Худи": (.5, .5), "Куртка": (.35, .65), "Бомбер": (.35, .65), "Свитшот": (.35, .65),
            "Пиджак": (.2, .8), "Тренч": (.15, .85), "Плащ": (.15, .85),
        },
        "default": (.05, .95),
    },
}
TRAIT_SURE = 0.75
# Below this a garment is not long, whether cropped or hip-length.
NOT_LONG = 0.3
# Garments a trait means nothing for: no sleeves or front on trousers and shoes.
TRAIT_SECTIONS = {"Верх", "Верхняя одежда"}


def decide(trait, probabilities, category=""):
    """The trait's value from the photo's probabilities and the category's prior, or None when unsure."""
    spec = TRAITS[trait]
    prior = spec["priors"].get(category, spec["default"])
    joint = [weight * float(probability) for weight, probability in zip(prior, probabilities)]
    total = sum(joint)
    if total <= 0:
        return None
    best = max(range(len(joint)), key=joint.__getitem__)
    if joint[best] / total >= TRAIT_SURE:
        return spec["classes"][best][0]
    if trait == "length" and joint[2] / total < NOT_LONG:
        # Short for sure, cropped or hip-length unclear: a short coat must not be read as "unsure", or the
        # prompt falls back on "overcoat" and the editor draws it to the knees.
        return "hip"
    return None


def decide_sleeves(probabilities, category=""):
    return decide("sleeves", probabilities, category)


CONFIDENCE_MIN = 0.70
CONFIDENCE_GAP = 0.30
PATTERN_MIN = 0.55
PATTERN_GAP = 0.20


def prompt_signature():
    """Identify the prompt set the cached text features were built from."""
    payload = json.dumps([CATEGORIES, PATTERNS, SHORT_NAMES, SCENES, TEMPLATES], ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def _subjects():
    return ([[short, detail[2]] for short, detail in zip(SHORT_NAMES, CATEGORIES)]
            + [[entry[1]] for entry in PATTERNS]
            + [[scene] for scene in SCENES])


def build_text_features(directory, text_model="onnx/text_model_quantized.onnx"):
    directory = Path(directory)
    tokenizer = Tokenizer.from_file(str(directory / 'tokenizer.json'))
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    options.enable_cpu_mem_arena = False
    model = ort.InferenceSession(str(directory / text_model), sess_options=options, providers=['CPUExecutionProvider'])
    features = []
    for variants in _subjects():
        vectors = []
        for subject in variants:
            for template in TEMPLATES:
                ids = tokenizer.encode(template.format(subject)).ids
                vectors.append(normalise(model.run(['text_embeds'], {'input_ids': np.array([ids], dtype=np.int64)})[0]))
        features.append(normalise(np.mean(vectors, axis=0))[0])
    np.save(directory / 'text_features.npy', np.array(features))
    (directory / 'text_features.json').write_text(json.dumps({"signature": prompt_signature()}))


def normalise(values):
    return values / np.maximum(np.linalg.norm(values, axis=-1, keepdims=True), 1e-8)


def ranked(scores):
    probabilities = np.exp(scores - np.max(scores))
    probabilities /= probabilities.sum()
    order = np.argsort(-probabilities)
    return [(int(index), float(probabilities[index])) for index in order]


def extract_palette(image: Image.Image, mask: Image.Image, count=5):
    rgb = np.asarray(image.convert("RGB").resize((160, 160)))
    alpha = np.asarray(mask.resize((160, 160), Image.Resampling.NEAREST))
    pixels = rgb[alpha > 180]
    if len(pixels) < 20:
        return []
    # Quantise only foreground pixels; white fabric is a valid colour, not background.
    strip = Image.fromarray(pixels.reshape((-1, 1, 3)))
    quantised = strip.quantize(colors=8, method=Image.Quantize.MEDIANCUT)
    palette = quantised.getpalette()
    result = []
    for frequency, index in sorted(quantised.getcolors() or [], reverse=True):
        if frequency / len(pixels) < 0.035:
            continue
        colour = tuple(palette[index * 3:index * 3 + 3])
        if any(sum((a - b) ** 2 for a, b in zip(colour, previous)) < 28 ** 2 for previous in result):
            continue
        result.append(colour)
    return ["#%02x%02x%02x" % colour for colour in result[:count]]


def _season_for(category, section):
    if category in {"Пуховик", "Парка", "Шуба"}:
        return "Зима"
    if section == "Верхняя одежда" or category in {"Ботинки", "Сапоги", "Свитер", "Водолазка", "Колготки"}:
        return "Демисезон"
    if category in {"Шапка", "Шарф", "Перчатки"}:
        return "Зима"
    if category in {"Шорты", "Сарафан", "Сандалии", "Топ", "Майка"}:
        return "Лето"
    return "Круглый год"


# The category head: a correction to the description scores learned from labelled garment photos
# (tools/training). It is tied to the descriptions it was trained over: a head from
# other prompts or categories would quietly mislead, so it is checked and left out instead.
CATEGORY_HEAD = Path(__file__).parent / "category_head.npz"


def load_category_head(dimension, path=None):
    path = Path(path or os.getenv("AI_CATEGORY_HEAD", CATEGORY_HEAD))
    if not path.exists():
        return None
    with np.load(path, allow_pickle=False) as data:
        weights, bias = data["W"].astype(np.float32), data["b"].astype(np.float32)
        signature = str(data["signature"])
    if signature != prompt_signature() or weights.shape != (dimension, len(CATEGORIES)) or bias.shape != (len(CATEGORIES),):
        print(f"Category head {path.name} does not match the categories; using the descriptions alone", flush=True)
        return None
    return weights, bias


class ClothingClassifier:
    def __init__(self, directory=None):
        directory = Path(directory or os.getenv("AI_ANALYSIS_MODEL_DIR", Path(__file__).parent / "models" / "clip"))
        self.directory = directory
        self._trait_features = None
        self._trait_lock = threading.Lock()
        config = json.loads((directory / "preprocessor_config.json").read_text())
        crop = config.get("crop_size") or config.get("size")
        self.size = crop["height"] if isinstance(crop, dict) else int(crop)
        self.mean = np.array(config["image_mean"], dtype=np.float32)
        self.std = np.array(config["image_std"], dtype=np.float32)
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.enable_cpu_mem_arena = False
        self.vision = ort.InferenceSession(str(directory / "onnx/vision_model_quantized.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
        self.features = np.load(directory / 'text_features.npy', allow_pickle=False)
        # Text features are derived from the prompts above. Reusing a file built
        # from different prompts fails silently and quietly degrades every
        # answer, so the build is fingerprinted and checked instead.
        stamp = directory / 'text_features.json'
        signature = json.loads(stamp.read_text()).get("signature") if stamp.exists() else None
        if len(self.features) != len(_subjects()) or signature != prompt_signature():
            raise ValueError('Rebuild text features with download_analysis_model.py')
        self.head = load_category_head(len(self.features[0]))

    def _embed(self, images):
        arrays = [(np.asarray(image, dtype=np.float32) / 255 - self.mean) / self.std for image in images]
        pixels = np.stack([array.transpose(2, 0, 1) for array in arrays]).astype(np.float32)
        return normalise(self.vision.run(["image_embeds"], {"pixel_values": pixels})[0])

    def _fit(self, image: Image.Image):
        return ImageOps.pad(image.convert("RGB"), (self.size, self.size), method=Image.Resampling.BICUBIC, color="white")

    def predict(self, original: Image.Image, foreground: Image.Image, section_hint=None):
        white = Image.new("RGB", foreground.size, "white")
        white.paste(foreground.convert("RGB"), mask=foreground.getchannel("A"))
        bbox = foreground.getchannel("A").getbbox()
        subject = self._fit(white.crop(bbox) if bbox else white)
        full = self._fit(ImageOps.fit(original.convert("RGB"), (self.size, self.size), method=Image.Resampling.BICUBIC))
        vectors = self._embed([subject, full])
        subject_scores, full_scores = [vector @ self.features.T * 100 for vector in vectors]
        # The cutout shows the garment, the frame shows the context; each alone
        # misreads a class of photos, and an even blend measured best.
        similarities = 0.5 * subject_scores + 0.5 * full_scores
        if self.head is not None:
            # The learned correction over the descriptions (category_head.npz): trained on labelled photos.
            weights, bias = self.head
            similarities = similarities.copy()
            similarities[:len(CATEGORIES)] += normalise(vectors.mean(axis=0)) @ weights + bias

        indices = [index for index, entry in enumerate(CATEGORIES) if not section_hint or entry[1] == section_hint]
        choices = ranked(similarities[indices])
        candidates = [{"category": CATEGORIES[indices[index]][0], "section": CATEGORIES[indices[index]][1], "score": round(score, 3)}
                      for index, score in choices[:3]]
        top = candidates[0]
        runner_up = candidates[1]["score"] if len(candidates) > 1 else 0.0
        uncertain = top["score"] < CONFIDENCE_MIN or top["score"] - runner_up < CONFIDENCE_GAP

        pattern_choices = ranked(subject_scores[len(CATEGORIES):len(CATEGORIES) + len(PATTERNS)])
        pattern_index, pattern_score = pattern_choices[0]
        pattern = PATTERNS[pattern_index][0]
        pattern_unsure = pattern_score < PATTERN_MIN or pattern_score - pattern_choices[1][1] < PATTERN_GAP

        # The cutout loses scene context; detect a person in the original only.
        scene = full_scores[-len(SCENES):]
        worn = bool(scene[0] > scene[1])

        warnings = []
        if uncertain:
            warnings.append("Тип вещи определён неуверенно. Проверь предложенные варианты.")
        if pattern_unsure:
            warnings.append(f"Рисунок определён неуверенно — предложен «{pattern.lower()}».")
        if worn:
            warnings.append('На фото человек: проверь цвет и тип вещи. Для точного анализа лучше отдельное фото одежды.')
        traits = self.traits(original, top["category"]) if top["section"] in TRAIT_SECTIONS else {}
        return {"category": top["category"], "section": top["section"], "categoryCandidates": candidates, "traits": traits,
                "needsReview": uncertain, "pattern": pattern, "season": _season_for(top["category"], top["section"]),
                "seasonSource": "category", "warnings": warnings,
                "analysisSource": "fashion-siglip-onnx+head" if self.head is not None else "fashion-siglip-onnx",
                "wornByPerson": worn,
                # For feedback.py: what the user then saves the photo as becomes a training example.
                "embedding": normalise(vectors.mean(axis=0))}


    def _trait_text(self):
        # Built on first use from the text model, apart from the category features:
        # their fingerprint stays as it was, and so does recognition.
        with self._trait_lock:
            if self._trait_features is None:
                tokenizer = Tokenizer.from_file(str(self.directory / "tokenizer.json"))
                options = ort.SessionOptions()
                options.intra_op_num_threads = 1
                options.inter_op_num_threads = 1
                options.enable_cpu_mem_arena = False
                model = ort.InferenceSession(str(self.directory / "onnx/text_model_quantized.onnx"), sess_options=options,
                                             providers=["CPUExecutionProvider"])
                embed = lambda text: normalise(model.run(["text_embeds"], {"input_ids": np.array([tokenizer.encode(text).ids], dtype=np.int64)})[0])
                self._trait_features = {
                    trait: np.array([normalise(np.mean([embed(template.format(phrase)) for phrase in phrases for template in TEMPLATES], axis=0))[0]
                                     for _name, phrases in spec["classes"]])
                    for trait, spec in TRAITS.items()}
            return self._trait_features

    def traits(self, image: Image.Image, category=""):
        """Sleeves, length, front opening and bulk read from the whole photo; each None when unsure."""
        frame = self._fit(ImageOps.fit(image.convert("RGB"), (self.size, self.size), method=Image.Resampling.BICUBIC))
        vector = self._embed([frame])[0]
        result = {}
        for trait, features in self._trait_text().items():
            scores = vector @ features.T * 100
            probabilities = np.exp(scores - scores.max())
            result[trait] = decide(trait, probabilities / probabilities.sum(), category)
        return result

    def sleeves(self, image: Image.Image, category=""):
        return self.traits(image, category)["sleeves"]


_classifier = None
_load_lock = threading.Lock()
_trait_cache = {}
_TRAIT_CACHE_SIZE = 512


def read_garment(content: bytes, category=""):
    """A garment photo's traits (sleeves, length, opening, bulk), cached by its bytes; {} when it cannot be read."""
    key = (hashlib.sha1(content).hexdigest(), category)
    if key in _trait_cache:
        return _trait_cache[key]
    try:
        with Image.open(BytesIO(content)) as image:
            answer = get_classifier().traits(ImageOps.exif_transpose(image), category)
    except Exception:
        return {}
    if len(_trait_cache) >= _TRAIT_CACHE_SIZE:
        _trait_cache.pop(next(iter(_trait_cache)))
    _trait_cache[key] = answer
    return answer


def sleeve_length(content: bytes, category=""):
    return read_garment(content, category).get("sleeves")


def get_classifier():
    global _classifier
    with _load_lock:
        if _classifier is None:
            _classifier = ClothingClassifier()
    return _classifier
