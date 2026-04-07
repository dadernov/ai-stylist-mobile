import base64
from io import BytesIO
import math

import numpy as np
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps
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

try:
    import mediapipe as mp

    POSE_AVAILABLE = True
except Exception:
    POSE_AVAILABLE = False
    mp = None

try:
    import onnxruntime  # noqa: F401

    REMBG_RUNTIME_AVAILABLE = True
except Exception:
    REMBG_RUNTIME_AVAILABLE = False

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


def clamp(value, min_value, max_value):
    return max(min_value, min(value, max_value))


def _image_to_data_url(image: Image.Image, fmt="PNG"):
    buff = BytesIO()
    image.save(buff, format=fmt)
    b64 = base64.b64encode(buff.getvalue()).decode("utf-8")
    return f"data:image/{fmt.lower()};base64,{b64}"


def _rgba_to_png_bytes(image: Image.Image):
    buff = BytesIO()
    image.convert("RGBA").save(buff, format="PNG")
    return buff.getvalue()


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


_pose_detector = None
_selfie_detector = None


def _get_pose_detector():
    global _pose_detector
    if not POSE_AVAILABLE:
        return None
    if _pose_detector is None:
        _pose_detector = mp.solutions.pose.Pose(
            static_image_mode=True,
            model_complexity=1,
            enable_segmentation=False,
            min_detection_confidence=0.35
        )
    return _pose_detector


def _get_selfie_detector():
    global _selfie_detector
    if not POSE_AVAILABLE:
        return None
    if _selfie_detector is None:
        _selfie_detector = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=1)
    return _selfie_detector


def _fallback_pose_from_bbox(rgba: Image.Image):
    bbox = _object_bbox(rgba)
    if not bbox:
        return None
    x0, y0, x1, y1 = bbox
    w = max(1, x1 - x0)
    h = max(1, y1 - y0)
    lx = (x0 + 0.32 * w) / rgba.width
    rx = (x0 + 0.68 * w) / rgba.width
    ly_shoulder = (y0 + 0.18 * h) / rgba.height
    ly_hip = (y0 + 0.52 * h) / rgba.height
    ly_ankle = min(0.98, (y0 + 0.96 * h) / rgba.height)
    return {
        "leftShoulder": {"x": lx, "y": ly_shoulder, "v": 0.45},
        "rightShoulder": {"x": rx, "y": ly_shoulder, "v": 0.45},
        "leftHip": {"x": (x0 + 0.38 * w) / rgba.width, "y": ly_hip, "v": 0.45},
        "rightHip": {"x": (x0 + 0.62 * w) / rgba.width, "y": ly_hip, "v": 0.45},
        "leftAnkle": {"x": (x0 + 0.42 * w) / rgba.width, "y": ly_ankle, "v": 0.45},
        "rightAnkle": {"x": (x0 + 0.58 * w) / rgba.width, "y": ly_ankle, "v": 0.45},
        "nose": {"x": (x0 + 0.5 * w) / rgba.width, "y": (y0 + 0.06 * h) / rgba.height, "v": 0.45}
    }


def _extract_pose_landmarks(image_rgb: Image.Image, person_rgba: Image.Image):
    if not POSE_AVAILABLE:
        return _fallback_pose_from_bbox(person_rgba)
    try:
        detector = _get_pose_detector()
        if detector is None:
            return _fallback_pose_from_bbox(person_rgba)
        result = detector.process(np.array(image_rgb.convert("RGB")))
        if not result.pose_landmarks:
            return _fallback_pose_from_bbox(person_rgba)
        lm = result.pose_landmarks.landmark
        idx = {
            "nose": 0,
            "leftShoulder": 11,
            "rightShoulder": 12,
            "leftHip": 23,
            "rightHip": 24,
            "leftAnkle": 27,
            "rightAnkle": 28
        }

        out = {}
        for key, i in idx.items():
            out[key] = {
                "x": float(lm[i].x),
                "y": float(lm[i].y),
                "v": float(getattr(lm[i], "visibility", 0.0))
            }
        return out
    except Exception:
        return _fallback_pose_from_bbox(person_rgba)


def _orientation_from_pose(pose):
    if not pose:
        return "unknown"
    ls = pose["leftShoulder"]
    rs = pose["rightShoulder"]
    nose = pose["nose"]
    shoulder_width = abs(rs["x"] - ls["x"])
    center = (ls["x"] + rs["x"]) / 2.0
    if shoulder_width < 0.1:
        return "left" if nose["x"] < center else "right"
    return "front"


def _torso_angle_deg(pose):
    if not pose:
        return 0.0
    ls = pose["leftShoulder"]
    rs = pose["rightShoulder"]
    dx = rs["x"] - ls["x"]
    dy = rs["y"] - ls["y"]
    if abs(dx) < 1e-6:
        return 0.0
    angle = math.degrees(math.atan2(dy, dx))
    return float(max(-20.0, min(20.0, angle)))


def _neutralize_person_appearance(original_rgb: Image.Image, person_rgba: Image.Image):
    mask = person_rgba.split()[-1]
    base = original_rgb.convert("RGB")
    toned = ImageOps.grayscale(base).convert("RGB")
    toned = ImageEnhance.Contrast(toned).enhance(0.85)
    toned = ImageEnhance.Brightness(toned).enhance(1.08)
    toned = toned.filter(ImageFilter.GaussianBlur(radius=1.4))

    # Build a softer canvas so original clothes texture interferes less with overlays.
    bg = Image.new("RGB", base.size, (246, 242, 234))
    person_soft = Image.composite(toned, bg, mask)
    return person_soft


def _segment_person_with_mediapipe(original_rgb: Image.Image):
    if not POSE_AVAILABLE:
        # No segmentation backend available: return full-opacity fallback.
        rgba = original_rgb.convert("RGBA")
        alpha = Image.new("L", original_rgb.size, 255)
        rgba.putalpha(alpha)
        return rgba

    detector = _get_selfie_detector()
    if detector is None:
        rgba = original_rgb.convert("RGBA")
        alpha = Image.new("L", original_rgb.size, 255)
        rgba.putalpha(alpha)
        return rgba
    result = detector.process(np.array(original_rgb.convert("RGB")))
    if result.segmentation_mask is None:
        rgba = original_rgb.convert("RGBA")
        alpha = Image.new("L", original_rgb.size, 255)
        rgba.putalpha(alpha)
        return rgba

    mask = np.clip(result.segmentation_mask * 255.0, 0, 255).astype(np.uint8)
    mask_img = Image.fromarray(mask, mode="L").filter(ImageFilter.GaussianBlur(radius=1.1))
    alpha = mask_img.point(lambda v: 255 if v > 36 else 0)
    rgba = original_rgb.convert("RGBA")
    rgba.putalpha(alpha)
    return rgba


def _remove_background_rgba(content: bytes, original_rgb: Image.Image):
    if not REMBG_RUNTIME_AVAILABLE:
        rgba = _segment_person_with_mediapipe(original_rgb)
        return rgba, _rgba_to_png_bytes(rgba)
    try:
        removed_bytes = remove(content)
        rgba = Image.open(BytesIO(removed_bytes)).convert("RGBA")
        return rgba, removed_bytes
    except Exception:
        rgba = _segment_person_with_mediapipe(original_rgb)
        return rgba, _rgba_to_png_bytes(rgba)


def _estimate_skin_tone(original_rgb: Image.Image, person_rgba: Image.Image, pose):
    arr = np.array(original_rgb.convert("RGB"))
    alpha = np.array(person_rgba.split()[-1])
    h, w = alpha.shape

    if pose and pose.get("nose"):
        nx = int(clamp(pose["nose"]["x"], 0, 1) * (w - 1))
        ny = int(clamp(pose["nose"]["y"], 0, 1) * (h - 1))
        x0, x1 = max(0, nx - 18), min(w, nx + 18)
        y0, y1 = max(0, ny - 16), min(h, ny + 16)
        patch = arr[y0:y1, x0:x1]
        patch_alpha = alpha[y0:y1, x0:x1]
        if patch.size and (patch_alpha > 20).any():
            sample = patch[patch_alpha > 20]
            rgb = sample.mean(axis=0)
            return tuple(int(v) for v in rgb)

    valid = arr[alpha > 20]
    if valid.size == 0:
        return (208, 178, 154)
    rgb = np.percentile(valid, 65, axis=0)
    return tuple(int(v) for v in rgb)


def _build_avatar_model(original_rgb: Image.Image, person_rgba: Image.Image, pose):
    alpha = person_rgba.split()[-1]
    rgb = original_rgb.convert("RGB")
    gray = ImageOps.autocontrast(ImageOps.grayscale(rgb), cutoff=2)
    smooth = gray.filter(ImageFilter.SMOOTH_MORE).filter(ImageFilter.GaussianBlur(radius=1.0))

    skin = _estimate_skin_tone(rgb, person_rgba, pose)
    light = tuple(min(255, int(v * 1.18 + 24)) for v in skin)
    dark = tuple(max(24, int(v * 0.48)) for v in skin)

    body = ImageOps.colorize(smooth, black=dark, white=light)
    body = ImageOps.posterize(body, bits=4)
    body = ImageEnhance.Color(body).enhance(0.75)
    body = ImageEnhance.Contrast(body).enhance(1.08)

    stylized = rgb.filter(ImageFilter.SMOOTH_MORE)
    stylized = ImageOps.posterize(stylized, bits=4)
    stylized = ImageEnhance.Color(stylized).enhance(0.9)

    # Keep head/hair closer to the real photo so avatar remains recognizable.
    head_mask = Image.new("L", rgb.size, 0)
    draw = ImageDraw.Draw(head_mask)
    bbox = _object_bbox(person_rgba)
    if bbox:
        x0, y0, x1, y1 = bbox
        bw = max(1, x1 - x0)
        bh = max(1, y1 - y0)
        cx = x0 + bw * 0.5
        cy = y0 + bh * 0.13
        rx = max(46, int(bw * 0.22))
        ry = max(56, int(bh * 0.14))
        if pose and pose.get("nose"):
            cx = clamp(pose["nose"]["x"], 0, 1) * rgb.width
            cy = clamp(pose["nose"]["y"], 0, 1) * rgb.height + ry * 0.16
        draw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=235)
    head_mask = head_mask.filter(ImageFilter.GaussianBlur(radius=12))
    avatar = Image.composite(stylized, body, head_mask)

    edges = gray.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.GaussianBlur(radius=0.6))
    edge_alpha = edges.point(lambda v: 72 if v > 28 else 0)
    outline = Image.new("RGB", rgb.size, (72, 60, 48))
    avatar.paste(outline, mask=edge_alpha)

    # Return transparent avatar (background already removed by person alpha).
    avatar_rgba = avatar.convert("RGBA")
    avatar_rgba.putalpha(alpha)
    return avatar_rgba


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
    original = Image.open(BytesIO(content)).convert("RGB")

    # background removal
    bg_removed_img, bg_removed_bytes = _remove_background_rgba(content, original)
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


@app.post("/tryon-model")
async def tryon_model(file: UploadFile = File(...)):
    content = await file.read()
    original = Image.open(BytesIO(content)).convert("RGB")

    person_rgba, _person_bytes = _remove_background_rgba(content, original)
    person_mask = person_rgba.split()[-1]

    pose = _extract_pose_landmarks(original, person_rgba)
    neutral = _neutralize_person_appearance(original, person_rgba)
    orientation = _orientation_from_pose(pose)
    torso_angle = _torso_angle_deg(pose)

    mask_data_url = _image_to_data_url(person_mask.convert("L"))
    neutral_data_url = _image_to_data_url(neutral, "PNG")

    return {
        "neutralModelBase64": neutral_data_url,
        "personMaskBase64": mask_data_url,
        "pose": pose,
        "orientation": orientation,
        "torsoAngleDeg": torso_angle,
        "sourceWidth": original.width,
        "sourceHeight": original.height
    }


@app.post("/tryon-avatar")
async def tryon_avatar(file: UploadFile = File(...)):
    content = await file.read()
    original = Image.open(BytesIO(content)).convert("RGB")

    person_rgba, _person_bytes = _remove_background_rgba(content, original)
    person_mask = person_rgba.split()[-1]

    pose = _extract_pose_landmarks(original, person_rgba)
    avatar = _build_avatar_model(original, person_rgba, pose)
    orientation = _orientation_from_pose(pose)
    torso_angle = _torso_angle_deg(pose)

    return {
        "avatarModelBase64": _image_to_data_url(avatar, "PNG"),
        "personMaskBase64": _image_to_data_url(person_mask.convert("L")),
        "pose": pose,
        "orientation": orientation,
        "torsoAngleDeg": torso_angle,
        "sourceWidth": original.width,
        "sourceHeight": original.height
    }
