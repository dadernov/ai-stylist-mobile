"""Local clothing recognition with quantized CLIP and foreground colour extraction."""
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
    ("Джоггеры", "Низ", "sweatpants or joggers with elastic cuffs"),
    ("Кроссовки", "Обувь", "athletic sneakers or running shoes"),
    ("Кеды", "Обувь", "canvas sneakers with a flat rubber sole"),
    ("Лоферы", "Обувь", "slip-on leather loafers"),
    ("Туфли", "Обувь", "formal leather dress shoes or pumps"),
    ("Ботинки", "Обувь", "ankle boots"),
    ("Сандалии", "Обувь", "open-toe sandals"),
    ("Сапоги", "Обувь", "tall knee-high boots"),
    ("Балетки", "Обувь", "ballet flat shoes"),
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
               "a jumpsuit", "a skirt", "jeans", "trousers", "shorts", "leggings", "sweatpants", "sneakers", "canvas shoes",
               "loafers", "dress shoes", "ankle boots", "sandals", "knee-high boots", "ballet flats", "a handbag", "a backpack", "a clutch bag"]

SCENES = ['a person wearing clothes', 'a clothing product alone without a person']


def build_text_features(directory):
    directory = Path(directory)
    tokenizer = Tokenizer.from_file(str(directory / 'tokenizer.json'))
    tokenizer.enable_truncation(max_length=77)
    tokenizer.enable_padding(length=77, pad_id=49407, pad_token='<|endoftext|>')
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    options.enable_cpu_mem_arena = False
    model = ort.InferenceSession(str(directory / 'onnx/text_model_fp16.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
    descriptions = [[short, detail[2]] for short, detail in zip(SHORT_NAMES, CATEGORIES)] + [[entry[1]] for entry in PATTERNS] + [[scene] for scene in SCENES]
    features = []
    for variants in descriptions:
        vectors = []
        for description in variants:
            ids = tokenizer.encode('a photo of ' + description + '.').ids
            vectors.append(normalise(model.run(['text_embeds'], {'input_ids': np.array([ids], dtype=np.int64)})[0]))
        features.append(normalise(np.mean(vectors, axis=0))[0])
    np.save(directory / 'text_features.npy', np.array(features))


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


class ClothingClassifier:
    def __init__(self, directory=None):
        directory = Path(directory or os.getenv("AI_ANALYSIS_MODEL_DIR", Path(__file__).parent / "models" / "clip"))
        config = json.loads((directory / "preprocessor_config.json").read_text())
        self.size = config["crop_size"]["height"]
        self.mean = np.array(config["image_mean"], dtype=np.float32)
        self.std = np.array(config["image_std"], dtype=np.float32)
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.enable_cpu_mem_arena = False
        self.vision = ort.InferenceSession(str(directory / "onnx/vision_model_quantized.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
        self.features = np.load(directory / 'text_features.npy', allow_pickle=False)
        if self.features.shape != (len(CATEGORIES) + len(PATTERNS) + len(SCENES), 512):
            raise ValueError('Rebuild text features with download_analysis_model.py')

    def predict(self, original: Image.Image, foreground: Image.Image, section_hint=None):
        white = Image.new("RGB", foreground.size, "white")
        white.paste(foreground, mask=foreground.getchannel("A"))
        bbox = foreground.getchannel("A").getbbox()
        crop = white.crop(bbox) if bbox else white
        full = ImageOps.fit(original.convert("RGB"), (self.size, self.size), method=Image.Resampling.BICUBIC)
        garment = ImageOps.pad(crop, (self.size, self.size), method=Image.Resampling.BICUBIC, color="white")
        arrays = [(np.asarray(image, dtype=np.float32) / 255 - self.mean) / self.std for image in [full, garment]]
        pixels = np.stack([array.transpose(2, 0, 1) for array in arrays]).astype(np.float32)
        embeddings = normalise(self.vision.run(["image_embeds"], {"pixel_values": pixels})[0])
        similarities = (embeddings @ self.features.T).mean(axis=0) * 100
        indices = [index for index, entry in enumerate(CATEGORIES) if not section_hint or entry[1] == section_hint]
        choices = ranked(similarities[indices])
        candidates = [{"category": CATEGORIES[indices[index]][0], "section": CATEGORIES[indices[index]][1], "score": round(score, 3)} for index, score in choices[:3]]
        top = candidates[0]
        uncertain = top["score"] < 0.80 or top["score"] - candidates[1]["score"] < 0.40
        pattern_choices = ranked(similarities[len(CATEGORIES):len(CATEGORIES) + len(PATTERNS)])
        pattern_index, pattern_score = pattern_choices[0]
        pattern = PATTERNS[pattern_index][0] if pattern_score >= 0.80 and pattern_score - pattern_choices[1][1] >= 0.30 else None
        # The cutout loses scene context; detect a person in the original only.
        scene_scores = embeddings[0] @ self.features[-len(SCENES):].T
        worn = scene_scores[0] > scene_scores[1]
        category = top["category"]
        season = "Зима" if category in {"Пуховик", "Парка"} else "Демисезон" if top["section"] == "Верхняя одежда" or category in {"Ботинки", "Сапоги"} else "Лето" if category in {"Шорты", "Сарафан", "Сандалии"} else "Круглый год"
        warnings = []
        if uncertain:
            warnings.append("Тип вещи определён неуверенно. Проверь предложенные варианты.")
        if pattern is None:
            warnings.append("Рисунок не удалось уверенно определить.")
        if worn:
            warnings.append('На фото человек: проверь цвет и тип вещи. Для точного анализа лучше отдельное фото одежды.')
        return {"category": category, "section": top["section"], "categoryCandidates": candidates, "needsReview": uncertain,
                "pattern": pattern, "season": season, "seasonSource": "category", "warnings": warnings, "analysisSource": "clip-onnx", "wornByPerson": bool(worn)}


_classifier = None
_load_lock = threading.Lock()


def get_classifier():
    global _classifier
    with _load_lock:
        if _classifier is None:
            _classifier = ClothingClassifier()
    return _classifier
