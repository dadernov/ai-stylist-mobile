import base64
import asyncio
import hashlib
import json
from io import BytesIO
import math
import os
import time
import threading

import httpx
import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, UploadFile, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps, UnidentifiedImageError
from rembg import remove, new_session
from clothing_analysis import get_classifier, extract_palette, CATEGORIES
import tryon_composite
import face_guard
import tryon_policy
import access
import accounts

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

# Мобильный клиент не браузер и Origin не присылает, поэтому по умолчанию не
# открываем API ни одному сайту. Нужен веб-клиент — перечисли его в
# AI_ALLOWED_ORIGINS. Куки не используются, значит и credentials не нужны.
_allowed_origins = [origin.strip() for origin in os.getenv("AI_ALLOWED_ORIGINS", "").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Device-Id"]
)

# Застёгнутый слой полностью скрывает то, что под ним; открытый — нет.
COVERING_OUTERWEAR = {"Пуховик", "Парка", "Пальто", "Шуба", "Тренч", "Плащ"}
# У FASHN платье и комбинезон — отдельная категория: как «верх» они садятся
# по линии талии и обрезаются.
ONE_PIECE_GARMENTS = {"Платье", "Сарафан", "Комбинезон"}

_TRYON_LOOK_CACHE: dict[str, dict] = {}
_TRYON_LOOK_INFLIGHT: dict[str, asyncio.Task] = {}
_TRYON_LOOK_LOCK = asyncio.Lock()
_ANALYSIS_LOCK = threading.Lock()
_ANALYSIS_CACHE = {}
_REMBG_LOCK = threading.Lock()
_rembg_session = None


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


def _env_bool(name: str, default: bool = False):
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int):
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _env_float(name: str, default: float):
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


def _data_url_to_bytes(data_url: str):
    if not data_url.startswith("data:") or "," not in data_url:
        return None
    header, raw = data_url.split(",", 1)
    mime_type = header.split(";")[0].replace("data:", "") or "image/jpeg"
    try:
        return base64.b64decode(raw), mime_type
    except Exception:
        return None


def _prepare_tryon_image_data_url(content: bytes, mime_type: str, max_side: int, jpeg_quality: int):
    if max_side <= 0:
        return _bytes_to_data_url(content, mime_type)
    try:
        image = ImageOps.exif_transpose(Image.open(BytesIO(content)))
        if max(image.size) > max_side:
            image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)

        canvas = Image.new("RGB", image.size, (255, 255, 255))
        if image.mode in ("RGBA", "LA") or ("transparency" in image.info):
            rgba = image.convert("RGBA")
            canvas.paste(rgba, mask=rgba.split()[-1])
        else:
            canvas = image.convert("RGB")

        buff = BytesIO()
        canvas.save(buff, format="JPEG", quality=jpeg_quality, optimize=True)
        return _bytes_to_data_url(buff.getvalue(), "image/jpeg")
    except Exception:
        return _bytes_to_data_url(content, mime_type)


async def _load_image_from_url_or_data_url(client: httpx.AsyncClient, source: str):
    try:
        decoded = _data_url_to_bytes(source)
        if decoded:
            content, _mime_type = decoded
            return Image.open(BytesIO(content)).convert("RGB")
        if source.startswith("http://") or source.startswith("https://"):
            res = await client.get(source)
            res.raise_for_status()
            return Image.open(BytesIO(res.content)).convert("RGB")
    except Exception as exc:
        print(f"Failed to load generated image for face lock: {type(exc).__name__}: {exc}")
    return None


def _silhouette(image: Image.Image):
    """Cut the person out so the composite can tell body from background."""
    buffer = BytesIO()
    image.convert("RGB").save(buffer, format="PNG")
    rgba, _ = _remove_background_rgba(buffer.getvalue(), image.convert("RGB"))
    return rgba


def _prepare_identity_source(original_content: bytes):
    original = ImageOps.exif_transpose(Image.open(BytesIO(original_content))).convert("RGB")
    faces = face_guard.detect_faces(original)
    if len(faces) != 1:
        raise ValueError('Для защищённой примерки нужно фото одного человека с хорошо видимым лицом.')
    cutout = _silhouette(original)
    if tryon_composite.person_alpha(original.size, cutout) is None:
        raise ValueError('Не удалось отделить человека от фона. Выбери более чёткое фото.')
    return original, cutout, faces


def _apply_identity_lock(original_content: bytes, generated_image: Image.Image, changed_slots, prepared=None):
    original, cutout, faces = prepared or _prepare_identity_source(original_content)
    aligned = generated_image.resize(original.size, Image.Resampling.LANCZOS)
    if not face_guard.faces_aligned(faces, face_guard.detect_faces(aligned), original.size):
        raise ValueError('Результат изменил положение человека. Примерка отклонена, исходное фото сохранено.')
    return tryon_composite.compose(
        original,
        generated_image,
        cutout,
        _silhouette(generated_image),
        changed_slots,
        [face_guard.protected_head(face, original.size) for face in faces],
    )


async def _face_locked_output_url(
    client: httpx.AsyncClient,
    original_content: bytes,
    output_url: str,
    changed_slots=(),
    prepared=None,
):
    # Never expose an unchecked provider image as the final result. PNG preserves
    # source pixels exactly; JPEG would modify the protected face and background.
    generated_image = await _load_image_from_url_or_data_url(client, output_url)
    if generated_image is None:
        raise ValueError('Не удалось проверить результат примерки. Попробуй ещё раз.')

    final_image, status = await asyncio.to_thread(
        _apply_identity_lock, original_content, generated_image, changed_slots, prepared
    )
    if status != 'composed':
        raise ValueError('Не удалось сохранить лицо и фон без искажений. Результат примерки отклонён.')
    buff = BytesIO()
    final_image.save(buff, format='PNG', compress_level=3)
    return _bytes_to_data_url(buff.getvalue(), 'image/png')


MAX_UPLOAD_BYTES = _env_int("AI_MAX_UPLOAD_BYTES", 15 * 1024 * 1024)


async def read_upload(upload: UploadFile | None, field: str):
    """Читает файл, отказывая слишком большому и не картинке.

    Ограничение нужно и на платных эндпоинтах, а не только в анализе: без него
    один запрос может занять память сервера, которой на этой машине и так мало.
    Тип проверяется по содержимому, а не по имени или заголовку — их клиент
    выбирает сам.
    """
    if upload is None:
        return None, None
    content = await upload.read(MAX_UPLOAD_BYTES + 1)
    if not content:
        raise HTTPException(422, f"Пустой файл в поле {field}.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"Файл в поле {field} больше {MAX_UPLOAD_BYTES // (1024 * 1024)} МБ.")
    try:
        probe = Image.open(BytesIO(content))
        probe.verify()
    except Exception:
        raise HTTPException(422, f"Файл в поле {field} не похож на изображение.")
    return content, upload.content_type or "image/jpeg"


def _prepare_image_for_analysis(content: bytes):
    source = Image.open(BytesIO(content))
    if source.width * source.height > 25_000_000:
        raise ValueError("Фото слишком большое. Выбери изображение до 25 мегапикселей.")
    source = ImageOps.exif_transpose(source).convert("RGBA")
    original = Image.new("RGB", source.size, "white")
    original.paste(source, mask=source.getchannel("A"))
    max_side = int(os.getenv("AI_ANALYZE_MAX_SIDE", "1280"))
    if max_side > 0 and max(original.size) > max_side:
        original.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    buff = BytesIO()
    original.save(buff, format="JPEG", quality=88, optimize=True)
    return original, buff.getvalue()


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
        generation_mode = 'quality'
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
        resolution = os.getenv("FASHN_QUALITY_RESOLUTION", "2k").strip()
        if resolution:
            inputs["resolution"] = resolution
        seed = os.getenv("FASHN_SEED", "").strip()
        if seed:
            inputs["seed"] = int(seed)
        num_images = os.getenv("FASHN_NUM_IMAGES", "").strip()
        if num_images:
            inputs["num_images"] = int(num_images)
        return inputs

    mode_value = mode_override or os.getenv("FASHN_MODE", "balanced")
    return {
        "model_image": model_image,
        "garment_image": garment_image,
        "mode": mode_value,
        "category": category_value or os.getenv("FASHN_CATEGORY", "auto"),
        "garment_photo_type": os.getenv("FASHN_GARMENT_PHOTO_TYPE", "auto"),
        "segmentation_free": _env_bool("FASHN_SEGMENTATION_FREE", True),
        "output_format": os.getenv("FASHN_OUTPUT_FORMAT", "jpeg"),
        "return_base64": _env_bool("FASHN_RETURN_BASE64", False),
        "num_samples": int(os.getenv("FASHN_NUM_SAMPLES", "1")),
        "seed": int(os.getenv("FASHN_SEED", "42"))
    }


async def _run_fashn_tryon(client: httpx.AsyncClient, token: str, model_name: str, inputs: dict):
    max_wait_seconds = int(inputs.pop("_max_wait_seconds", os.getenv("FASHN_MAX_WAIT_SECONDS", "180")))
    poll_interval_seconds = float(inputs.pop("_poll_interval_seconds", os.getenv("FASHN_POLL_INTERVAL_SECONDS", "2.0")))
    try:
        create_res = await client.post(
            "https://api.fashn.ai/v1/run",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"model_name": model_name, "inputs": inputs}
        )
    except httpx.ConnectError as exc:
        return {"error": f"FASHN connect failed: {str(exc)}"}
    except httpx.HTTPError as exc:
        return {"error": f"FASHN request failed: {type(exc).__name__}: {str(exc)}"}
    if create_res.status_code >= 400:
        return {"error": f"FASHN create failed ({create_res.status_code})", "detail": create_res.text}

    prediction = create_res.json()
    prediction_id = prediction.get("id")
    status = "starting"
    deadline = time.time() + max_wait_seconds
    while status in ("starting", "in_queue", "processing") and prediction_id and time.time() < deadline:
        await asyncio.sleep(max(0.5, poll_interval_seconds))
        try:
            get_res = await client.get(
                f"https://api.fashn.ai/v1/status/{prediction_id}",
                headers={"Authorization": f"Bearer {token}"}
            )
        except httpx.ConnectError as exc:
            return {"error": f"FASHN poll connect failed: {str(exc)}"}
        except httpx.HTTPError as exc:
            return {"error": f"FASHN poll request failed: {type(exc).__name__}: {str(exc)}"}
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

    max_entries = max(0, _tryon_cache_max_entries())
    max_bytes = max(0, _env_int('FASHN_LOOK_CACHE_MAX_BYTES', 64 * 1024 * 1024))
    total_bytes = sum(entry.get('sizeBytes', 0) for entry in _TRYON_LOOK_CACHE.values())
    oldest = sorted(_TRYON_LOOK_CACHE.items(), key=lambda item: item[1].get("createdAt", 0))
    for key, entry in oldest:
        if len(_TRYON_LOOK_CACHE) <= max_entries and total_bytes <= max_bytes:
            break
        total_bytes -= entry.get('sizeBytes', 0)
        _TRYON_LOOK_CACHE.pop(key, None)


def _reason_to_skip_top(outer_category: str, look_model_name: str):
    """Why a separate pass over the top layer would be wasted, or "" if it would not.

    Two torso passes in a row are rarely worth what they cost. Under a zipped
    puffer or a coat the top is not visible in any frame. And on models without
    "max" the second torso pass is simply unreliable: in a live run (tryon-v1.6,
    a hoodie plus a leather jacket) the outer step came back one brightness
    level out of 255 away from the frame before it — the jacket never appeared,
    while the credit was still spent. In both cases only the visible layer is
    generated.
    """
    if outer_category.strip() in COVERING_OUTERWEAR:
        return f"под «{outer_category.strip().lower()}» его не видно"
    if "max" not in look_model_name:
        return "в быстром режиме виден только верхний слой"
    return ""


def _cache_key_for_tryon_look(
    person_content: bytes,
    top_content: bytes | None,
    bottom_content: bytes | None,
    shoes_content: bytes | None,
    outer_content: bytes | None,
    tuck_mode_normalized: str,
    look_model_name: str,
    look_mode: str,
    look_generation_mode: str,
    base_prompt: str,
    quality_mode: str,
    categories: str = ""
):
    hasher = hashlib.sha256()
    # Композит и раскладка по слоям поменялись — старые кадры под теми же
    # фотографиями больше не соответствуют тому, что сервер сделал бы сейчас.
    hasher.update(tryon_policy.CACHE_VERSION.encode('utf-8'))
    hasher.update(os.getenv('FASHN_QUALITY_RESOLUTION', '2k').encode('utf-8'))
    hasher.update(look_model_name.encode("utf-8"))
    hasher.update(look_mode.encode("utf-8"))
    hasher.update(look_generation_mode.encode("utf-8"))
    hasher.update(base_prompt.encode("utf-8"))
    hasher.update(quality_mode.encode("utf-8"))
    hasher.update(tuck_mode_normalized.encode("utf-8"))
    hasher.update(categories.encode("utf-8"))
    hasher.update(person_content)
    hasher.update(top_content or b"")
    hasher.update(bottom_content or b"")
    hasher.update(shoes_content or b"")
    hasher.update(outer_content or b"")
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
        "sizeBytes": len(json.dumps(result).encode('utf-8')),
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
    prompt_override: str | None = None,
    max_wait_seconds: int | None = None,
    poll_interval_seconds: float | None = None
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
        if max_wait_seconds is not None:
            inputs["_max_wait_seconds"] = max_wait_seconds
        if poll_interval_seconds is not None:
            inputs["_poll_interval_seconds"] = poll_interval_seconds
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
        if max_wait_seconds is not None:
            inputs["_max_wait_seconds"] = max_wait_seconds
        if poll_interval_seconds is not None:
            inputs["_poll_interval_seconds"] = poll_interval_seconds
        result = await _run_fashn_tryon(client, token, model_name, inputs)
        if not result.get("error"):
            result["usedCategory"] = category
            return result
        errors.append({"category": category, "error": result.get("error"), "detail": result.get("detail")})

    return {
        "error": "FASHN generation failed for all categories",
        "attempts": errors
    }


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
    global _rembg_session
    if not REMBG_RUNTIME_AVAILABLE:
        rgba = _segment_person_with_mediapipe(original_rgb)
        return rgba, _rgba_to_png_bytes(rgba)
    try:
        with _REMBG_LOCK:
            if _rembg_session is None:
                os.environ.setdefault("OMP_NUM_THREADS", "1")
                _rembg_session = new_session("u2net", providers=["CPUExecutionProvider"])
        removed_bytes = remove(content, session=_rembg_session)
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


class Credentials(BaseModel):
    login: str
    password: str
    displayName: str = ""


@app.post("/auth/register")
def auth_register(body: Credentials, _: bool = Depends(access.require_app)):
    return accounts.register(body.login, body.password, body.displayName)


@app.post("/auth/login")
def auth_login(body: Credentials, _: bool = Depends(access.require_app)):
    return accounts.login_user(body.login, body.password)


@app.post("/auth/logout")
def auth_logout(_: bool = Depends(access.require_app), x_session_token: str | None = Header(default=None)):
    accounts.forget_session((x_session_token or "").strip() or None)
    return {"status": "ok"}


@app.get("/auth/me")
def auth_me(login: str = Depends(access.require_account)):
    """Приложение спрашивает это при запуске, чтобы понять, жива ли сессия."""
    return {**(accounts.profile(login) or {"login": login, "displayName": ""}),
            "spentToday": access.spent_today(login), "dailyQuota": access.daily_quota()}


@app.post("/analyze")
def analyze(file: UploadFile = File(...), section_hint: str = Form(""), device: str = Depends(access.require_account)):
    if section_hint and section_hint not in {entry[1] for entry in CATEGORIES}:
        raise HTTPException(422, "Неизвестная категория гардероба.")
    content = file.file.read(15 * 1024 * 1024 + 1)
    if not content or len(content) > 15 * 1024 * 1024:
        raise HTTPException(413, "Нужно фото размером не больше 15 МБ.")
    if not _ANALYSIS_LOCK.acquire(timeout=2):
        raise HTTPException(503, "Анализ занят. Повтори через несколько секунд.")
    try:
        key = hashlib.sha256(content + section_hint.encode()).hexdigest()
        if key in _ANALYSIS_CACHE:
            return _ANALYSIS_CACHE[key]
        try:
            original, analysis_content = _prepare_image_for_analysis(content)
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
            raise HTTPException(422, "Не удалось открыть фото. Выбери JPEG, PNG или WebP до 25 мегапикселей.")
        foreground, _ = _remove_background_rgba(analysis_content, original)
        alpha = foreground.getchannel("A")
        coverage = float((np.asarray(alpha) > 180).mean())
        background_removed = 0.02 < coverage < 0.98
        if coverage <= 0.02:
            foreground = original.convert("RGBA")
            alpha = foreground.getchannel("A")
        try:
            result = get_classifier().predict(original, foreground, section_hint or None)
        except Exception as exc:
            print(f"Clothing classifier unavailable: {type(exc).__name__}")
            result = {"category": None, "section": section_hint or None, "season": None, "pattern": None,
                      "categoryCandidates": [], "needsReview": True, "analysisSource": "unavailable",
                      "warnings": ["Распознавание сейчас недоступно. Выбери тип вещи вручную или повтори анализ."]}
        palette = extract_palette(foreground, alpha)
        if not background_removed:
            result["warnings"].append("Фон не удалось надёжно отделить. Цвет может включать фон фотографии.")
            result["needsReview"] = True
        cutout = ""
        if background_removed:
            box = alpha.getbbox()
            if box:
                x0, y0, x1, y1 = box
                margin = max(8, round(max(x1 - x0, y1 - y0) * 0.04))
                foreground = foreground.crop((max(0, x0 - margin), max(0, y0 - margin),
                                              min(foreground.width, x1 + margin), min(foreground.height, y1 + margin)))
            cutout = _image_to_data_url(foreground)
        result.update({"dominantColor": palette[0] if palette and not result.get('wornByPerson') else None, "palette": palette,
                       "bgRemovedBase64": cutout, "backgroundRemoved": background_removed})
        if result['analysisSource'] != 'unavailable':
            _ANALYSIS_CACHE[key] = result
        while len(_ANALYSIS_CACHE) > 12:
            _ANALYSIS_CACHE.pop(next(iter(_ANALYSIS_CACHE)))
        return result
    finally:
        _ANALYSIS_LOCK.release()


@app.post("/tryon-model")
async def tryon_model(file: UploadFile = File(...), device: str = Depends(access.require_account)):
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
async def tryon_avatar(file: UploadFile = File(...), device: str = Depends(access.require_account)):
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
async def tryon_generate(person_file: UploadFile = File(...), garment_file: UploadFile = File(...),
                         device: str = Depends(access.require_account)):
    try:
        token = os.getenv("FASHN_API_KEY", "").strip()
        if not token:
            return {"error": "FASHN_API_KEY is not set"}
        if not token.isascii():
            return {"error": "FASHN_API_KEY contains non-ASCII symbols. Set the real API key (latin letters/numbers only)."}

        model_name = tryon_policy.MODEL
        single_prompt = tryon_policy.IDENTITY

        person_content, person_mime = await read_upload(person_file, "person_file")
        garment_content, garment_mime = await read_upload(garment_file, "garment_file")
        prepared = await asyncio.to_thread(_prepare_identity_source, person_content)

        max_side = _env_int("FASHN_IMAGE_MAX_SIDE", 2048)
        jpeg_quality = 97
        person_data = _prepare_tryon_image_data_url(person_content, person_mime, max_side, jpeg_quality)
        garment_data = _prepare_tryon_image_data_url(garment_content, garment_mime, max_side, jpeg_quality)

        async with httpx.AsyncClient(timeout=90.0, trust_env=False) as client:
            generic_categories = _category_candidates("generic", ["auto"])
            result = await _run_fashn_tryon_with_category_fallback(
                client,
                token,
                model_name,
                person_data,
                garment_data,
                generic_categories,
                prompt_override=single_prompt,
                max_wait_seconds=_env_int('FASHN_QUALITY_MAX_WAIT_SECONDS', 240),
                poll_interval_seconds=1.0
            )
            if result.get("outputUrl"):
                result["outputUrl"] = await _face_locked_output_url(client, person_content, result["outputUrl"], ["unknown"], prepared)
                access.charge(device)
            return result
    except ValueError as exc:
        return {"error": str(exc)}
    except Exception as exc:
        print(f'Try-on failed: {type(exc).__name__}')
        return {"error": "Не удалось завершить примерку. Попробуй ещё раз."}


@app.post("/tryon-generate-look")
async def tryon_generate_look(
    person_file: UploadFile = File(...),
    top_file: UploadFile | None = File(None),
    bottom_file: UploadFile | None = File(None),
    shoes_file: UploadFile | None = File(None),
    outer_file: UploadFile | None = File(None),
    tuck_mode: str = Form("auto"),
    compare_mode: str = Form("false"),
    quality_mode: str = Form("quality"),
    top_category: str = Form(""),
    outer_category: str = Form(""),
    device: str = Depends(access.require_account)
):
    try:
        token = os.getenv("FASHN_API_KEY", "").strip()
        if not token:
            return {"error": "FASHN_API_KEY is not set"}
        if not token.isascii():
            return {"error": "FASHN_API_KEY contains non-ASCII symbols. Set the real API key (latin letters/numbers only)."}
        look_model_name = tryon_policy.MODEL
        look_mode = tryon_policy.MODE
        look_generation_mode = tryon_policy.MODE
        base_prompt = tryon_policy.IDENTITY
        quality_mode_normalized = 'quality'
        step_max_wait_seconds = _env_int('FASHN_QUALITY_MAX_WAIT_SECONDS', 240)
        poll_interval_seconds = 1.0
        tryon_max_side = _env_int('FASHN_IMAGE_MAX_SIDE', 2048)
        tryon_jpeg_quality = 97
        tuck_mode_normalized = (tuck_mode or "auto").strip().lower()
        if tuck_mode_normalized not in ("auto", "tucked", "untucked"):
            tuck_mode_normalized = "auto"

        person_content, person_mime = await read_upload(person_file, "person_file")
        top_content, top_mime = await read_upload(top_file, "top_file")
        bottom_content, bottom_mime = await read_upload(bottom_file, "bottom_file")
        shoes_content, shoes_mime = await read_upload(shoes_file, "shoes_file")
        outer_content, outer_mime = await read_upload(outer_file, "outer_file")

        if not any((top_content, bottom_content, shoes_content, outer_content)):
            return {"error": "Выбери хотя бы одну вещь для примерки."}

        cache_key = _cache_key_for_tryon_look(
            person_content,
            top_content,
            bottom_content,
            shoes_content,
            outer_content,
            tuck_mode_normalized,
            look_model_name,
            look_mode,
            look_generation_mode,
            base_prompt,
            quality_mode_normalized,
            f"{top_category.strip()}|{outer_category.strip()}"
        )

        async def _generate_look():
            prepared_identity = await asyncio.to_thread(_prepare_identity_source, person_content)
            current_model = _prepare_tryon_image_data_url(person_content, person_mime, tryon_max_side, tryon_jpeg_quality)
            top_image = _prepare_tryon_image_data_url(top_content, top_mime, tryon_max_side, tryon_jpeg_quality) if top_content and top_mime else None
            bottom_image = _prepare_tryon_image_data_url(bottom_content, bottom_mime, tryon_max_side, tryon_jpeg_quality) if bottom_content and bottom_mime else None
            shoes_image = _prepare_tryon_image_data_url(shoes_content, shoes_mime, tryon_max_side, tryon_jpeg_quality) if shoes_content and shoes_mime else None
            outer_image = _prepare_tryon_image_data_url(outer_content, outer_mime, tryon_max_side, tryon_jpeg_quality) if outer_content and outer_mime else None

            async with httpx.AsyncClient(timeout=120.0, trust_env=False) as client:
                steps = []

                async def _run_bottom_step(step_name: str):
                    nonlocal current_model
                    bottom_prompt = tryon_policy.garment_prompt('bottom')
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
                        prompt_override=bottom_prompt,
                        max_wait_seconds=step_max_wait_seconds,
                        poll_interval_seconds=poll_interval_seconds
                    )
                    steps.append({"step": step_name, "result": bottom_result})
                    if not bottom_result.get("error"):
                        current_model = bottom_result.get("outputUrl")
                    return bottom_result

                async def _run_top_step(step_name: str):
                    nonlocal current_model
                    top_prompt = tryon_policy.garment_prompt('top', top_category.strip(), tuck_mode_normalized)
                    top_categories = _category_candidates(
                        "top", ["one-pieces", "auto"] if top_category.strip() in ONE_PIECE_GARMENTS else ["tops"]
                    )
                    top_result = await _run_fashn_tryon_with_category_fallback(
                        client,
                        token,
                        look_model_name,
                        current_model,
                        top_image,
                        top_categories,
                        mode_override=look_mode,
                        generation_mode_override=look_generation_mode,
                        prompt_override=top_prompt,
                        max_wait_seconds=step_max_wait_seconds,
                        poll_interval_seconds=poll_interval_seconds
                    )
                    steps.append({"step": step_name, "result": top_result})
                    if not top_result.get("error"):
                        current_model = top_result.get("outputUrl")
                    return top_result

                async def _run_outer_step(step_name: str):
                    nonlocal current_model
                    outer_prompt = tryon_policy.garment_prompt('outer', outer_category.strip())
                    outer_categories = ['auto']
                    outer_result = await _run_fashn_tryon_with_category_fallback(
                        client,
                        token,
                        look_model_name,
                        current_model,
                        outer_image,
                        outer_categories,
                        mode_override=look_mode,
                        generation_mode_override=look_generation_mode,
                        prompt_override=outer_prompt,
                        max_wait_seconds=step_max_wait_seconds,
                        poll_interval_seconds=poll_interval_seconds
                    )
                    steps.append({"step": step_name, "result": outer_result})
                    if not outer_result.get("error"):
                        current_model = outer_result.get("outputUrl")
                    return outer_result

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

                if shoes_image is not None:
                    shoes_result = await _run_fashn_tryon_with_category_fallback(
                        client, token, look_model_name, current_model, shoes_image, ['auto'],
                        mode_override=look_mode,
                        generation_mode_override=look_generation_mode,
                        prompt_override=tryon_policy.garment_prompt('shoes'),
                        max_wait_seconds=step_max_wait_seconds,
                        poll_interval_seconds=poll_interval_seconds
                    )
                    steps.append({"step": "shoes", "result": shoes_result})
                    if shoes_result.get("error"):
                        return {"error": "Не удалось примерить обувь.", "steps": steps}
                    current_model = shoes_result.get("outputUrl")

                # Long outerwear is last so a subsequent footwear pass cannot trim its hem.
                if outer_image is not None:
                    outer_result = await _run_outer_step('outer')
                    if outer_result.get('error'):
                        return {'error': 'Не удалось примерить верхнюю одежду.', 'steps': steps}

            if not steps:
                return {"error": "No garments provided (top_file, bottom_file, shoes_file, or outer_file required)"}

            # Only the slots that actually ran may repaint the body; every other
            # zone (and the background and head) comes back from the source photo.
            changed_slots = sorted({
                tryon_policy.composite_slot(step['step'].split('_')[0], outer_category if step['step'] == 'outer' else top_category)
                for step in steps
                if not step["result"].get("error") and step["result"].get("status") != "skipped"
            })

            async with httpx.AsyncClient(timeout=30.0, trust_env=False) as output_client:
                locked_output_url = await _face_locked_output_url(
                    output_client, person_content, current_model, changed_slots, prepared_identity
                )
            response = {
                "status": "succeeded",
                "outputUrl": locked_output_url,
                "steps": steps,
                "tuckModeUsed": tuck_mode_normalized,
                "qualityModeUsed": quality_mode_normalized,
                "modelUsed": look_model_name,
            }
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
            # Сюда попадают только те, для кого генерация реально выполнялась:
            # ответ из кеша вернулся выше и денег не стоил. Списываем по числу
            # проходов — образ из четырёх вещей дороже одной футболки.
            access.charge(device, len([step for step in result.get("steps", []) if step["result"].get("outputUrl")]) or 1)

        return result
    except ValueError as exc:
        return {"error": str(exc)}
    except Exception as exc:
        print(f'Try-on look failed: {type(exc).__name__}')
        return {"error": "Не удалось завершить примерку. Попробуй ещё раз."}
