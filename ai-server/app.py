import base64
from io import BytesIO

import numpy as np
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from rembg import remove

try:
    import torch
    from transformers import CLIPModel, CLIPProcessor

    CLIP_AVAILABLE = True
except Exception:
    CLIP_AVAILABLE = False
    CLIPModel = None
    CLIPProcessor = None
    torch = None

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


def _rgb_to_hex(rgb):
    return "#%02x%02x%02x" % rgb


def dominant_color(image: Image.Image, mask=None):
    img = image.convert("RGB").resize((120, 120))
    arr = np.array(img).reshape(-1, 3)
    if mask is not None:
        mask_resized = mask.resize((120, 120))
        mask_arr = np.array(mask_resized).reshape(-1)
        arr = arr[mask_arr > 10]
    if arr.size == 0:
        return (255, 255, 255)
    colors, counts = np.unique(arr, axis=0, return_counts=True)
    return tuple(colors[counts.argmax()])


def palette_colors(image: Image.Image, n=5, mask=None):
    img = image.convert("RGB").resize((160, 160))
    if mask is not None:
        mask_resized = mask.resize((160, 160))
        mask_arr = np.array(mask_resized)
        rgb = np.array(img)
        rgb[mask_arr <= 10] = [255, 255, 255]
        img = Image.fromarray(rgb)
    pal = img.quantize(colors=n, method=Image.MEDIANCUT)
    palette = pal.getpalette()[: n * 3]
    return [tuple(palette[i : i + 3]) for i in range(0, len(palette), 3)]


def _filter_palette(colors, mask_white=True):
    filtered = []
    for c in colors:
        r, g, b = c
        if mask_white and r > 240 and g > 240 and b > 240:
            continue
        filtered.append(c)
    return filtered


def _object_bbox(rgba: Image.Image):
    alpha = np.array(rgba.split()[-1])
    ys, xs = np.where(alpha > 10)
    if len(xs) == 0 or len(ys) == 0:
        return None
    return xs.min(), ys.min(), xs.max(), ys.max()


def infer_category(rgba: Image.Image):
    bbox = _object_bbox(rgba)
    if not bbox:
        return "Футболка"
    x0, y0, x1, y1 = bbox
    width = max(1, x1 - x0 + 1)
    height = max(1, y1 - y0 + 1)
    aspect = height / width
    area_ratio = (width * height) / (rgba.width * rgba.height)
    if area_ratio < 0.18:
        return "Обувь" if aspect < 0.9 else "Сумка"
    if aspect > 1.6:
        return "Пальто" if area_ratio > 0.55 else "Джинсы"
    if aspect > 1.3:
        return "Платье"
    if aspect > 1.1:
        return "Юбка"
    return "Футболка"


def infer_season(image: Image.Image):
    arr = np.array(image.convert("RGB")).astype(np.float32) / 255.0
    maxc = arr.max(axis=2)
    minc = arr.min(axis=2)
    v = maxc
    s = np.where(maxc == 0, 0, (maxc - minc) / maxc)
    v_mean = float(v.mean())
    s_mean = float(s.mean())
    if v_mean < 0.35:
        return "Зима"
    if v_mean > 0.65 and s_mean > 0.35:
        return "Лето"
    if v_mean > 0.7 and s_mean <= 0.35:
        return "Лето"
    return "Демисезон"


def infer_pattern(image: Image.Image):
    gray = image.convert("L").resize((128, 128))
    arr = np.array(gray, dtype=np.float32)
    dx = np.abs(np.diff(arr, axis=1))
    dy = np.abs(np.diff(arr, axis=0))
    score = float((dx.mean() + dy.mean()) / 2.0)
    colorfulness = float(np.std(np.array(image.convert("RGB")), axis=(0, 1)).mean())
    if score < 6:
        return "Однотонный"
    if score < 12:
        return "Полоска"
    if score < 18:
        return "Клетка"
    return "Цветочный" if colorfulness > 40 else "Горох"


_clip_model = None
_clip_processor = None


def _get_clip():
    global _clip_model, _clip_processor
    if not CLIP_AVAILABLE:
        return None, None
    if _clip_model is None or _clip_processor is None:
        _clip_model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
        _clip_processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    return _clip_model, _clip_processor


def clip_classify(image: Image.Image, labels, prompts):
    model, processor = _get_clip()
    if model is None or processor is None:
        return None
    inputs = processor(text=prompts, images=image, return_tensors="pt", padding=True)
    with torch.no_grad():
        outputs = model(**inputs)
        logits = outputs.logits_per_image[0]
        probs = logits.softmax(dim=0)
    best_idx = int(probs.argmax().item())
    return labels[best_idx]


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    content = await file.read()
    original = Image.open(BytesIO(content))

    # background removal
    bg_removed_bytes = remove(content)
    bg_removed_img = Image.open(BytesIO(bg_removed_bytes)).convert("RGBA")
    bg_on_white = Image.new("RGB", bg_removed_img.size, (255, 255, 255))
    bg_on_white.paste(bg_removed_img, mask=bg_removed_img.split()[-1])
    bg_b64 = base64.b64encode(bg_removed_bytes).decode("utf-8")
    bg_data_url = f"data:image/png;base64,{bg_b64}"

    alpha_mask = bg_removed_img.split()[-1]
    dom = dominant_color(bg_on_white, mask=alpha_mask)
    pal_raw = palette_colors(bg_on_white, n=7, mask=alpha_mask)
    pal = _filter_palette(pal_raw)[:5]
    category_labels = ["Платье", "Юбка", "Джинсы", "Футболка", "Пальто", "Обувь", "Сумка"]
    category_prompts = [
        "a dress",
        "a skirt",
        "jeans",
        "a t-shirt",
        "a coat",
        "shoes",
        "a handbag"
    ]

    pattern_labels = ["Клетка", "Полоска", "Горох", "Цветочный", "Однотонный"]
    pattern_prompts = [
        "plaid pattern",
        "striped pattern",
        "polka dot pattern",
        "floral pattern",
        "solid color clothing"
    ]

    season_labels = ["Лето", "Зима", "Демисезон"]
    season_prompts = ["summer outfit", "winter outfit", "mid-season outfit"]

    category = clip_classify(bg_on_white, category_labels, category_prompts) or infer_category(bg_removed_img)
    pattern = clip_classify(bg_on_white, pattern_labels, pattern_prompts) or infer_pattern(bg_on_white)
    season = clip_classify(bg_on_white, season_labels, season_prompts) or infer_season(bg_on_white)

    return {
        "dominantColor": _rgb_to_hex(dom),
        "palette": [_rgb_to_hex(c) for c in pal],
        "bgRemovedBase64": bg_data_url,
        "category": category,
        "season": season,
        "pattern": pattern
    }
