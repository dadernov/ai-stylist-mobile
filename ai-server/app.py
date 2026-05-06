import base64
import asyncio
import hashlib
from io import BytesIO
import math
import os
import time

import httpx
import numpy as np
from fastapi import FastAPI, File, Form, UploadFile
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

_TRYON_LOOK_CACHE: dict[str, dict] = {}
_TRYON_LOOK_INFLIGHT: dict[str, asyncio.Task] = {}
_TRYON_LOOK_LOCK = asyncio.Lock()


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


def _bytes_to_data_url(content: bytes, mime_type: str):
    b64 = base64.b64encode(content).decode("utf-8")
    return f"data:{mime_type};base64,{b64}"


def _extract_prediction_image(output):
    if isinstance(output, str):
        return output
    if isinstance(output, list):
        for item in output:
            if isinstance(item, str):
                return item
            if isinstance(item, dict):
                for key in ("url", "image", "output", "file"):
                    value = item.get(key)
                    if isinstance(value, str):
                        return value
        return None
    if isinstance(output, dict):
        for key in ("url", "image", "output", "file"):
            value = output.get(key)
            if isinstance(value, str):
                return value
    return None


def _build_fashn_inputs(
    model_name: str,
    model_image: str,
    garment_image: str,
    category_value: str | None = None,
    mode_override: str | None = None,
    generation_mode_override: str | None = None,
    prompt_override: str | None = None
):
    if "max" in model_name:
        generation_mode = generation_mode_override or os.getenv("FASHN_GENERATION_MODE", "").strip()
        prompt = prompt_override or os.getenv("FASHN_PROMPT", "").strip()
        inputs = {
            "model_image": model_image,
            "product_image": garment_image,
            "output_format": os.getenv("FASHN_OUTPUT_FORMAT", "jpeg"),
            "return_base64": os.getenv("FASHN_RETURN_BASE64", "false").lower() == "true"
        }
        if prompt:
            inputs["prompt"] = prompt
        if generation_mode:
            inputs["generation_mode"] = generation_mode
        resolution = os.getenv("FASHN_RESOLUTION", "").strip()
        if resolution:
            inputs["resolution"] = resolution
        return inputs

    mode_value = mode_override or os.getenv("FASHN_MODE", "balanced")
    return {
        "model_image": model_image,
        "garment_image": garment_image,
        "mode": mode_value,
        "category": category_value or os.getenv("FASHN_CATEGORY", "auto"),
        "garment_photo_type": os.getenv("FASHN_GARMENT_PHOTO_TYPE", "auto"),
        "segmentation_free": os.getenv("FASHN_SEGMENTATION_FREE", "false").lower() == "true",
        "output_format": os.getenv("FASHN_OUTPUT_FORMAT", "jpeg"),
        "return_base64": os.getenv("FASHN_RETURN_BASE64", "false").lower() == "true",
        "num_samples": int(os.getenv("FASHN_NUM_SAMPLES", "1"))
    }


async def _run_fashn_tryon(client: httpx.AsyncClient, token: str, model_name: str, inputs: dict):
    create_res = await client.post(
        "https://api.fashn.ai/v1/run",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"model_name": model_name, "inputs": inputs}
    )
    if create_res.status_code >= 400:
        return {"error": f"FASHN create failed ({create_res.status_code})", "detail": create_res.text}

    prediction = create_res.json()
    prediction_id = prediction.get("id")
    status = "starting"
    deadline = time.time() + int(os.getenv("FASHN_MAX_WAIT_SECONDS", "180"))
    while status in ("starting", "in_queue", "processing") and prediction_id and time.time() < deadline:
        await asyncio.sleep(2.0)
        get_res = await client.get(
            f"https://api.fashn.ai/v1/status/{prediction_id}",
            headers={"Authorization": f"Bearer {token}"}
        )
        if get_res.status_code >= 400:
            return {"error": f"FASHN poll failed ({get_res.status_code})", "detail": get_res.text}
        prediction = get_res.json()
        status = prediction.get("status")

    if status != "completed":
        return {
            "status": status,
            "error": prediction.get("error") or "FASHN prediction failed",
            "logs": prediction.get("logs")
        }

    output_url = _extract_prediction_image(prediction.get("output"))
    if not output_url:
        return {"status": "succeeded", "error": "No image URL in prediction output", "output": prediction.get("output")}

    return {
        "status": "succeeded",
        "predictionId": prediction.get("id"),
        "outputUrl": output_url,
        "webUrl": (prediction.get("urls") or {}).get("web")
    }


def _category_candidates(slot_name: str, default_values: list[str]):
    explicit = os.getenv(f"FASHN_CATEGORY_{slot_name.upper()}_CANDIDATES", "").strip()
    fallback_single = os.getenv(f"FASHN_CATEGORY_{slot_name.upper()}", "").strip()
    raw_values = []
    if explicit:
        raw_values.extend(part.strip() for part in explicit.split(","))
    if fallback_single:
        raw_values.append(fallback_single)
    raw_values.extend(default_values)
    raw_values.append("auto")

    unique_values = []
    seen = set()
    for value in raw_values:
        if not value:
            continue
        normalized = value.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        unique_values.append(value)
    return unique_values


def _now_ts():
    return time.time()


def _tryon_cache_ttl_seconds():
    return int(os.getenv("FASHN_LOOK_CACHE_TTL_SECONDS", "21600"))


def _tryon_cache_max_entries():
    return int(os.getenv("FASHN_LOOK_CACHE_MAX_ENTRIES", "200"))


def _prune_tryon_look_cache():
    ttl = _tryon_cache_ttl_seconds()
    now = _now_ts()
    stale_keys = []
    for key, value in _TRYON_LOOK_CACHE.items():
        if now - value.get("createdAt", 0) > ttl:
            stale_keys.append(key)
    for key in stale_keys:
        _TRYON_LOOK_CACHE.pop(key, None)

    max_entries = _tryon_cache_max_entries()
    if len(_TRYON_LOOK_CACHE) <= max_entries:
        return
    oldest = sorted(_TRYON_LOOK_CACHE.items(), key=lambda item: item[1].get("createdAt", 0))
    to_delete = len(_TRYON_LOOK_CACHE) - max_entries
    for idx in range(to_delete):
        _TRYON_LOOK_CACHE.pop(oldest[idx][0], None)


def _cache_key_for_tryon_look(
    person_content: bytes,
    top_content: bytes | None,
    bottom_content: bytes | None,
    shoes_content: bytes | None,
    tuck_mode_normalized: str,
    look_model_name: str,
    look_mode: str,
    look_generation_mode: str,
    base_prompt: str,
    quality_mode: str
):
    hasher = hashlib.sha256()
    hasher.update(look_model_name.encode("utf-8"))
    hasher.update(look_mode.encode("utf-8"))
    hasher.update(look_generation_mode.encode("utf-8"))
    hasher.update(base_prompt.encode("utf-8"))
    hasher.update(quality_mode.encode("utf-8"))
    hasher.update(tuck_mode_normalized.encode("utf-8"))
    hasher.update(person_content)
    hasher.update(top_content or b"")
    hasher.update(bottom_content or b"")
    hasher.update(shoes_content or b"")
    return hasher.hexdigest()


def _get_cached_tryon_look(cache_key: str):
    _prune_tryon_look_cache()
    cached = _TRYON_LOOK_CACHE.get(cache_key)
    if not cached:
        return None
    return {**cached["result"], "cached": True}


def _set_cached_tryon_look(cache_key: str, result: dict):
    _TRYON_LOOK_CACHE[cache_key] = {
        "createdAt": _now_ts(),
        "result": {**result, "cached": False}
    }
    _prune_tryon_look_cache()


async def _run_fashn_tryon_with_category_fallback(
    client: httpx.AsyncClient,
    token: str,
    model_name: str,
    model_image: str,
    garment_image: str,
    category_candidates: list[str],
    mode_override: str | None = None,
    generation_mode_override: str | None = None,
    prompt_override: str | None = None
):
    if "max" in model_name:
        inputs = _build_fashn_inputs(
            model_name,
            model_image,
            garment_image,
            mode_override=mode_override,
            generation_mode_override=generation_mode_override,
            prompt_override=prompt_override
        )
        return await _run_fashn_tryon(client, token, model_name, inputs)

    errors = []
    for category in category_candidates:
        inputs = _build_fashn_inputs(
            model_name,
            model_image,
            garment_image,
            category,
            mode_override=mode_override,
            generation_mode_override=generation_mode_override
        )
        result = await _run_fashn_tryon(client, token, model_name, inputs)
        if not result.get("error"):
            result["usedCategory"] = category
            return result
        errors.append({"category": category, "error": result.get("error"), "detail": result.get("detail")})

    return {
        "error": "FASHN generation failed for all categories",
        "attempts": errors
    }


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
        return "Пальто" if area_ratio > 0.55 else "Брюки"
    if aspect > 1.3:
        return "Платье"
    if aspect > 1.1:
        return "Юбка" if area_ratio > 0.3 else "Лонгслив"
    if area_ratio > 0.5:
        return "Худи"
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
    category_labels = [
        "Футболка",
        "Поло",
        "Лонгслив",
        "Рубашка",
        "Блуза",
        "Топ",
        "Майка",
        "Водолазка",
        "Свитер",
        "Худи",
        "Свитшот",
        "Кардиган",
        "Пиджак",
        "Бомбер",
        "Куртка",
        "Пальто",
        "Платье",
        "Юбка",
        "Джинсы",
        "Брюки",
        "Шорты",
        "Леггинсы",
        "Обувь",
        "Сумка"
    ]
    category_prompts = [
        "a t-shirt",
        "a polo shirt",
        "a long sleeve shirt",
        "a shirt",
        "a blouse",
        "a crop top",
        "a tank top",
        "a turtleneck",
        "a sweater",
        "a hoodie",
        "a sweatshirt",
        "a cardigan",
        "a blazer",
        "a bomber jacket",
        "a jacket",
        "a coat",
        "a dress",
        "a skirt",
        "jeans",
        "pants",
        "shorts",
        "leggings",
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


@app.post("/tryon-generate")
async def tryon_generate(person_file: UploadFile = File(...), garment_file: UploadFile = File(...)):
    try:
        token = os.getenv("FASHN_API_KEY", "").strip()
        if not token:
            return {"error": "FASHN_API_KEY is not set"}
        if not token.isascii():
            return {"error": "FASHN_API_KEY contains non-ASCII symbols. Set the real API key (latin letters/numbers only)."}

        model_name = os.getenv("FASHN_MODEL_NAME", "tryon-v1.6").strip()
        single_prompt = os.getenv(
            "FASHN_IDENTITY_PROMPT",
            "Preserve the person's face, head, hair, facial expression, glasses, skin tone, body pose, camera angle, and identity exactly. Change only the clothing item being tried on. Do not beautify, redraw, crop, or alter the face."
        ).strip()

        person_content = await person_file.read()
        garment_content = await garment_file.read()
        person_mime = person_file.content_type or "image/jpeg"
        garment_mime = garment_file.content_type or "image/jpeg"

        person_data = _bytes_to_data_url(person_content, person_mime)
        garment_data = _bytes_to_data_url(garment_content, garment_mime)

        async with httpx.AsyncClient(timeout=90.0) as client:
            generic_categories = _category_candidates("generic", ["auto"])
            return await _run_fashn_tryon_with_category_fallback(
                client,
                token,
                model_name,
                person_data,
                garment_data,
                generic_categories,
                prompt_override=single_prompt
            )
    except Exception as exc:
        return {"error": f"tryon-generate exception: {type(exc).__name__}: {str(exc)}"}


@app.post("/tryon-generate-look")
async def tryon_generate_look(
    person_file: UploadFile = File(...),
    top_file: UploadFile | None = File(None),
    bottom_file: UploadFile | None = File(None),
    shoes_file: UploadFile | None = File(None),
    tuck_mode: str = Form("auto"),
    compare_mode: str = Form("false"),
    quality_mode: str = Form("quality")
):
    try:
        token = os.getenv("FASHN_API_KEY", "").strip()
        if not token:
            return {"error": "FASHN_API_KEY is not set"}
        if not token.isascii():
            return {"error": "FASHN_API_KEY contains non-ASCII symbols. Set the real API key (latin letters/numbers only)."}
        model_name = os.getenv("FASHN_MODEL_NAME", "tryon-v1.6").strip()
        look_model_name = os.getenv("FASHN_LOOK_MODEL_NAME", model_name).strip() or model_name
        look_mode = os.getenv("FASHN_LOOK_MODE", "quality").strip()
        look_generation_mode = os.getenv("FASHN_LOOK_GENERATION_MODE", "").strip()
        base_prompt = os.getenv(
            "FASHN_IDENTITY_PROMPT",
            "Preserve the person's face, head, hair, facial expression, glasses, skin tone, body pose, camera angle, and identity exactly. Change only clothing and wearable accessories. Do not beautify, redraw, crop, or alter the face."
        ).strip()
        compare_mode_enabled = str(compare_mode).strip().lower() in ("1", "true", "yes", "on")
        quality_mode_normalized = str(quality_mode).strip().lower()
        if quality_mode_normalized not in ("fast", "quality"):
            quality_mode_normalized = "quality"
        if quality_mode_normalized == "fast":
            look_mode = os.getenv("FASHN_FAST_MODE", "balanced").strip()
            look_generation_mode = os.getenv("FASHN_FAST_GENERATION_MODE", "balanced").strip()
        tuck_mode_normalized = (tuck_mode or "auto").strip().lower()
        if tuck_mode_normalized not in ("auto", "tucked", "untucked"):
            tuck_mode_normalized = "auto"

        person_content = await person_file.read()
        person_mime = person_file.content_type or "image/jpeg"

        top_content = await top_file.read() if top_file is not None else None
        top_mime = (top_file.content_type or "image/jpeg") if top_file is not None else None

        bottom_content = await bottom_file.read() if bottom_file is not None else None
        bottom_mime = (bottom_file.content_type or "image/jpeg") if bottom_file is not None else None

        shoes_content = await shoes_file.read() if shoes_file is not None else None
        shoes_mime = (shoes_file.content_type or "image/jpeg") if shoes_file is not None else None

        cache_key = _cache_key_for_tryon_look(
            person_content,
            top_content,
            bottom_content,
            shoes_content,
            tuck_mode_normalized,
            look_model_name,
            look_mode,
            look_generation_mode,
            base_prompt,
            quality_mode_normalized
        )

        async def _generate_look():
            current_model = _bytes_to_data_url(person_content, person_mime)
            top_image = _bytes_to_data_url(top_content, top_mime) if top_content and top_mime else None
            bottom_image = _bytes_to_data_url(bottom_content, bottom_mime) if bottom_content and bottom_mime else None
            shoes_image = _bytes_to_data_url(shoes_content, shoes_mime) if shoes_content and shoes_mime else None

            async with httpx.AsyncClient(timeout=120.0) as client:
                steps = []

                async def _run_bottom_step(step_name: str):
                    nonlocal current_model
                    bottom_prompt = f"{base_prompt} Replace the lower-body garment only. Keep the face and upper body identity unchanged."
                    bottom_categories = _category_candidates("bottom", ["bottoms"])
                    bottom_result = await _run_fashn_tryon_with_category_fallback(
                        client,
                        token,
                        look_model_name,
                        current_model,
                        bottom_image,
                        bottom_categories,
                        mode_override=look_mode,
                        generation_mode_override=look_generation_mode,
                        prompt_override=bottom_prompt
                    )
                    steps.append({"step": step_name, "result": bottom_result})
                    if not bottom_result.get("error"):
                        current_model = bottom_result.get("outputUrl")
                    return bottom_result

                async def _run_top_step(step_name: str):
                    nonlocal current_model
                    tuck_instruction = ""
                    if tuck_mode_normalized == "tucked":
                        tuck_instruction = " Tuck the shirt/top into the bottom garment."
                    elif tuck_mode_normalized == "untucked":
                        tuck_instruction = " Leave the shirt/top untucked and relaxed over the waist."
                    top_prompt = f"{base_prompt} Replace the upper-body garment only.{tuck_instruction} Keep the face and lower body identity unchanged."
                    top_categories = _category_candidates("top", ["tops"])
                    top_result = await _run_fashn_tryon_with_category_fallback(
                        client,
                        token,
                        look_model_name,
                        current_model,
                        top_image,
                        top_categories,
                        mode_override=look_mode,
                        generation_mode_override=look_generation_mode,
                        prompt_override=top_prompt
                    )
                    steps.append({"step": step_name, "result": top_result})
                    if not top_result.get("error"):
                        current_model = top_result.get("outputUrl")
                    return top_result

                preferred_order = "top-first" if tuck_mode_normalized == "tucked" else "bottom-first"

                if preferred_order == "top-first":
                    if top_image is not None:
                        top_result = await _run_top_step("top")
                        if top_result.get("error"):
                            return {"error": "Top garment generation failed", "top": top_result, "steps": steps}

                    if bottom_image is not None:
                        bottom_result = await _run_bottom_step("bottom")
                        if bottom_result.get("error"):
                            return {"error": "Bottom garment generation failed", "bottom": bottom_result, "steps": steps}
                else:
                    if bottom_image is not None:
                        bottom_result = await _run_bottom_step("bottom")
                        if bottom_result.get("error"):
                            return {"error": "Bottom garment generation failed", "bottom": bottom_result, "steps": steps}

                    if top_image is not None:
                        top_result = await _run_top_step("top")
                        if top_result.get("error"):
                            return {"error": "Top garment generation failed", "top": top_result, "steps": steps}

                        do_top_refine = os.getenv("FASHN_TOP_REFINEMENT_PASS", "false").lower() == "true"
                        if compare_mode_enabled and bottom_image is not None:
                            do_top_refine = True
                        if bottom_image is not None and do_top_refine:
                            top_refine_result = await _run_top_step("top_refine")
                            if not top_refine_result.get("error"):
                                current_model = top_refine_result.get("outputUrl")

                if (
                    preferred_order == "top-first"
                    and top_image is not None
                    and bottom_image is not None
                and (
                    os.getenv("FASHN_BOTTOM_REFINEMENT_PASS", "false").lower() == "true"
                    or compare_mode_enabled
                )
            ):
                    bottom_refine_result = await _run_bottom_step("bottom_refine")
                    if not bottom_refine_result.get("error"):
                        current_model = bottom_refine_result.get("outputUrl")

                warning_message = None
                if shoes_image is not None:
                    if "max" not in look_model_name:
                        steps.append(
                            {
                                "step": "shoes",
                                "result": {"status": "skipped", "reason": "Shoes replacement works best with tryon-max"}
                            }
                        )
                        warning_message = "Shoes skipped for non-max model"
                    else:
                        shoes_categories = _category_candidates("shoes", ["auto"])
                        shoes_prompt = f"{base_prompt} Replace footwear only. Keep the face, pose, clothing, and identity unchanged."
                        shoes_result = await _run_fashn_tryon_with_category_fallback(
                            client,
                            token,
                            look_model_name,
                            current_model,
                            shoes_image,
                            shoes_categories,
                            mode_override=look_mode,
                            generation_mode_override=look_generation_mode,
                            prompt_override=shoes_prompt
                        )
                        steps.append({"step": "shoes", "result": shoes_result})
                        if shoes_result.get("error"):
                            return {"error": "Shoes generation failed", "shoes": shoes_result, "steps": steps}
                        current_model = shoes_result.get("outputUrl")

            if not steps:
                return {"error": "No garments provided (top_file or bottom_file or shoes_file required)"}

            response = {"status": "succeeded", "outputUrl": current_model, "steps": steps, "tuckModeUsed": tuck_mode_normalized}
            if warning_message:
                response["warning"] = warning_message
            return response

        async with _TRYON_LOOK_LOCK:
            cached = _get_cached_tryon_look(cache_key)
            if cached:
                return cached
            inflight_task = _TRYON_LOOK_INFLIGHT.get(cache_key)
            if inflight_task is None:
                inflight_task = asyncio.create_task(_generate_look())
                _TRYON_LOOK_INFLIGHT[cache_key] = inflight_task

        try:
            result = await inflight_task
        finally:
            async with _TRYON_LOOK_LOCK:
                if _TRYON_LOOK_INFLIGHT.get(cache_key) is inflight_task:
                    _TRYON_LOOK_INFLIGHT.pop(cache_key, None)

        if result.get("status") == "succeeded" and result.get("outputUrl"):
            async with _TRYON_LOOK_LOCK:
                _set_cached_tryon_look(cache_key, result)

        return result
    except Exception as exc:
        return {"error": f"tryon-generate-look exception: {type(exc).__name__}: {str(exc)}"}
