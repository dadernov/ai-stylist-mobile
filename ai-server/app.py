import base64
import asyncio
import hashlib
import json
from io import BytesIO
import math
import os
import time
import threading
import re
from contextlib import asynccontextmanager

import httpx
import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, UploadFile, HTTPException
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.datastructures import UploadFile as StarletteUploadFile
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps, UnidentifiedImageError
from rembg import remove, new_session
from clothing_analysis import get_classifier, extract_palette, CATEGORIES, SHORT_NAMES
import tryon_composite
import face_guard
import footwear_guard
import tryon_policy
import image_color
import garment_guard
import tryon_matte
import tryon_reference
import tryon_frame
import tryon_debug
import access
import accounts
import fal_tryon
import fashn_credits
import jobs
import stage_cache
from request_guard import RequestGuard, BoundedFormRoute

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

@asynccontextmanager
async def lifespan(_app):
    await asyncio.to_thread(jobs.recover_interrupted)

    async def retention():
        while True:
            try:
                await asyncio.to_thread(jobs.expire)
            except Exception as exc:
                print(f'Retention sweep failed: {type(exc).__name__}', flush=True)
            await asyncio.sleep(1800)

    sweeper = asyncio.create_task(retention())
    try:
        yield
    finally:
        sweeper.cancel()


app = FastAPI(lifespan=lifespan)
app.router.route_class = BoundedFormRoute
app.add_middleware(RequestGuard)

# Мобильный клиент не браузер и Origin не присылает, поэтому по умолчанию не
# открываем API ни одному сайту. Нужен веб-клиент — перечисли его в
# AI_ALLOWED_ORIGINS. Куки не используются, значит и credentials не нужны.
_allowed_origins = [origin.strip() for origin in os.getenv("AI_ALLOWED_ORIGINS", "").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Session-Token"]
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
    max_side = min(max_side, 2048) if max_side > 0 else 2048
    try:
        source = Image.open(BytesIO(content))
        _check_image_size(source)
        source.draft('RGB', (min(max_side, 2048), min(max_side, 2048)))
        image = image_color.to_srgb(ImageOps.exif_transpose(source))
        max_side = min(max_side, 2048)
        if max(image.size) > max_side:
            image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)

        canvas = Image.new("RGB", image.size, (255, 255, 255))
        if image.mode in ("RGBA", "LA") or ("transparency" in image.info):
            rgba = image.convert("RGBA")
            canvas.paste(rgba, mask=rgba.split()[-1])
        else:
            canvas = image.convert("RGB")

        buff = BytesIO()
        canvas.save(buff, format="JPEG", quality=jpeg_quality, optimize=True, icc_profile=image_color.SRGB_BYTES)
        return _bytes_to_data_url(buff.getvalue(), "image/jpeg")
    except ValueError:
        raise
    except Exception as exc:
        # Never forward the original bytes: they may carry EXIF location tags.
        raise ValueError('Не удалось прочитать фото вещи. Выбери другое фото.') from exc


async def _load_image_from_url_or_data_url(client: httpx.AsyncClient, source: str):
    try:
        if source.startswith('data:') and len(source) > MAX_UPLOAD_BYTES * 4 // 3 + 128:
            raise ValueError('Generated image exceeds byte limit')
        decoded = _data_url_to_bytes(source)
        if decoded:
            content, _mime_type = decoded
            return await asyncio.to_thread(_working_image, content)
        if source.startswith("http://") or source.startswith("https://"):
            content = bytearray()
            async with client.stream('GET', source) as res:
                res.raise_for_status()
                async for chunk in res.aiter_bytes():
                    if len(content) + len(chunk) > MAX_UPLOAD_BYTES:
                        raise ValueError('Generated image exceeds byte limit')
                    content.extend(chunk)
            return await asyncio.to_thread(_working_image, content)
    except Exception as exc:
        print(f"Failed to load generated image for face lock: {type(exc).__name__}")
    return None


ALIGNMENT_MESSAGE = 'Не удалось точно совместить примерку с исходным фото. Лицо и фон не изменены; попробуй повторить примерку.'
LAYERS_WARNING = 'Верхние слои не удалось надеть, показан базовый образ. Попробуй перегенерировать.'
UNLOCKED_WARNING = ('Лицо и фон не удалось защитить пиксель в пиксель, поэтому показан кадр генератора целиком. '
                    'Если лицо или фон изменились, перегенерируй.')


class AlignmentRejected(ValueError):
    """The provider frame could not be locked to the photo.

    `frame` is that frame already in the photo's coordinates, so a caller may
    still show it with an explicit warning instead of discarding paid work.
    """

    def __init__(self, message, frame=None):
        super().__init__(message)
        self.frame = frame


def _prepare_provider_frame(content: bytes, max_side: int, jpeg_quality: int, ratio=tryon_frame.PROVIDER_RATIO):
    """The photo on the provider's own canvas, so its result maps back 1:1."""
    padded, _ = tryon_frame.pad(_working_image(content, max_side=min(max_side, 2048) if max_side > 0 else 2048), ratio)
    buff = BytesIO()
    padded.convert('RGB').save(buff, format='JPEG', quality=jpeg_quality, optimize=True, icc_profile=image_color.SRGB_BYTES)
    return _bytes_to_data_url(buff.getvalue(), 'image/jpeg')


def _unlocked_output_url(original_content: bytes, frame: Image.Image):
    """After a rejected lock: the provider's own frame as PNG, never a provider URL."""
    full = _working_image(original_content, max_side=None)
    image = frame.convert('RGB')
    if image.size != full.size:
        image = image.resize(full.size, Image.Resampling.LANCZOS)
    buff = BytesIO()
    image.save(buff, format='PNG', compress_level=3, icc_profile=image_color.SRGB_BYTES)
    return _bytes_to_data_url(buff.getvalue(), 'image/png')


def _source_framed(prepared, generated_image: Image.Image, ratio=tryon_frame.PROVIDER_RATIO):
    """A provider frame in the photo's coordinates (the padded canvas cropped away)."""
    original = prepared[0]
    padded, box = tryon_frame.pad(original, ratio)
    return tryon_frame.to_source_frame(generated_image, original.size, padded.size, box)


def _face_only_output_url(generated_image: Image.Image, prepared, ratio=tryon_frame.PROVIDER_RATIO):
    """The editor's whole frame with the photo's own face, or None to fall back to the full lock."""
    try:
        framed = _source_framed(prepared, generated_image, ratio)
    except Exception as exc:
        print(f'Try-on face restore failed: {type(exc).__name__}', flush=True)
        return None
    return _face_restored_output_url(framed, prepared)


def _face_restored_output_url(frame: Image.Image, prepared):
    """After a rejected lock: the generator's frame with the photo's own face, or None.

    The lock needs the whole scene in place; a general editor often returns the
    head slightly resized, so the face alone is carried over instead
    (face_guard.transplant_face). None when even the face does not fit.
    """
    try:
        original, _cutout, faces, labels = prepared
        framed = frame.convert('RGB').resize(original.size, Image.Resampling.LANCZOS)
        try:
            generated_labels = footwear_guard.parse(framed)
        except Exception as exc:
            print(f'Try-on head parsing unavailable: {type(exc).__name__}', flush=True)
            generated_labels = None
        restored = face_guard.transplant_face(original, framed, faces[0], labels, generated_labels)
    except face_guard.AlignmentError as exc:
        print(f'Try-on face restore rejected: {exc}', flush=True)
        return None
    except Exception as exc:
        # Paid work is never lost to the restore: the caller shows the frame.
        print(f'Try-on face restore failed: {type(exc).__name__}', flush=True)
        return None
    buff = BytesIO()
    restored.save(buff, format='PNG', compress_level=3, icc_profile=image_color.SRGB_BYTES)
    return _bytes_to_data_url(buff.getvalue(), 'image/png')


def _stage_preview_url(prepared, generated_image: Image.Image, max_height: int = 1024):
    """A small provider frame in the photo's coordinates for the progress view.

    Nothing is locked here: the head and far background are the generator's
    own. The client labels it as intermediate; the final frame replaces it.
    """
    original = prepared[0]
    padded, box = tryon_frame.pad(original)
    framed = tryon_frame.to_source_frame(generated_image, original.size, padded.size, box)
    if framed.height > max_height:
        framed = framed.resize((max(1, round(framed.width * max_height / framed.height)), max_height), Image.Resampling.LANCZOS)
    buff = BytesIO()
    framed.convert('RGB').save(buff, format='JPEG', quality=82, optimize=True, icc_profile=image_color.SRGB_BYTES)
    return _bytes_to_data_url(buff.getvalue(), 'image/jpeg')


def _silhouette(image: Image.Image):
    """Cut the person out so the composite can tell body from background."""
    buffer = BytesIO()
    image.convert("RGB").save(buffer, format="PNG")
    rgba, _ = _remove_background_rgba(buffer.getvalue(), image.convert("RGB"))
    return rgba


def _prepare_identity_source(original_content: bytes):
    original = _working_image(original_content)
    faces = face_guard.detect_faces(original)
    if len(faces) != 1:
        raise ValueError('Для защищённой примерки нужно фото одного человека с хорошо видимым лицом.')
    try:
        labels = footwear_guard.parse(original)
    except Exception as exc:
        raise ValueError('Не удалось подготовить защиту лица и обуви. Попробуй примерку позже.') from exc
    cutout = garment_guard.silhouette(original, labels)
    if tryon_composite.person_alpha(original.size, cutout) is None:
        raise ValueError('Не удалось отделить человека от фона. Выбери более чёткое фото.')
    return original, cutout, faces, labels


def _apply_identity_lock(original_content: bytes, generated_image: Image.Image, changed_slots, prepared=None):
    original, cutout, faces, source_labels = prepared or _prepare_identity_source(original_content)
    # The provider was sent the photo on its own canvas (tryon_frame.pad): a
    # result with that aspect is a plain resize and the photo a known crop of
    # it. Any other aspect is fitted uniformly, never stretched. Landmark
    # validation still rejects a zoomed, cropped or repositioned person.
    padded, box = tryon_frame.pad(original)
    framed = tryon_frame.to_source_frame(generated_image, original.size, padded.size, box)
    try:
        aligned, coverage = face_guard.align_to_source(
            original, framed, faces[0], source_labels=source_labels, return_coverage=True
        )
    except face_guard.AlignmentError as exc:
        print(f'Try-on alignment rejected: {exc}; source={original.size}; generated={generated_image.size}', flush=True)
        raise AlignmentRejected(ALIGNMENT_MESSAGE, framed) from exc
    generated_labels = footwear_guard.parse(aligned)
    aligned, garment_keep, generated_labels = tryon_matte.prepare(
        original, aligned, source_labels, generated_labels, faces, changed_slots
    )
    garment_keep = tryon_matte.require_coverage(coverage, garment_keep)
    return tryon_composite.compose(
        original,
        aligned,
        cutout,
        garment_guard.silhouette(aligned, generated_labels),
        changed_slots,
        [face_guard.protected_head_mask(face, original.size, source_labels, generated_labels) for face in faces],
        original_full=_working_image(original_content, max_side=None),
        garment_keep=garment_keep,
    )


async def _face_locked_output_url(
    client: httpx.AsyncClient,
    original_content: bytes,
    output_url: str,
    changed_slots=(),
    prepared=None,
    debug_context=None,
    generated_image=None,
):
    # Never expose an unchecked provider image as the final result. PNG preserves
    # source pixels exactly; JPEG would modify the protected face and background.
    # A caller that already downloaded the frame passes it in to skip a second fetch.
    if generated_image is None:
        generated_image = await _load_image_from_url_or_data_url(client, output_url)
    if generated_image is None:
        raise ValueError('Не удалось проверить результат примерки. Попробуй ещё раз.')

    if debug_context is not None:
        await asyncio.to_thread(tryon_debug.capture, *debug_context, original_content, generated_image)

    final_image, status = await asyncio.to_thread(
        _apply_identity_lock, original_content, generated_image, changed_slots, prepared
    )
    print(f'Try-on composite: {status}; source={final_image.size}; generated={generated_image.size}', flush=True)
    if status != 'composed':
        if status == 'no-silhouette':
            raise ValueError('Не удалось отделить одежду от фона на результате примерки. Исходное фото сохранено.')
        raise ValueError('Не удалось совместить результат с исходным фото. Исходное фото сохранено.')
    buff = BytesIO()
    final_image.save(buff, format='PNG', compress_level=3, icc_profile=image_color.SRGB_BYTES)
    return _bytes_to_data_url(buff.getvalue(), 'image/png')


MAX_UPLOAD_BYTES = _env_int("AI_MAX_UPLOAD_BYTES", 15 * 1024 * 1024)
MAX_IMAGE_PIXELS = min(25_000_000, _env_int("AI_MAX_IMAGE_PIXELS", 25_000_000))
MAX_IMAGE_SIDE = 10000


def _check_image_size(image):
    if image.width * image.height > MAX_IMAGE_PIXELS or max(image.size) > MAX_IMAGE_SIDE:
        raise HTTPException(413, 'Фото слишком большое. Выбери изображение до 25 мегапикселей.')


def _working_image(content, max_side=2048):
    with Image.open(BytesIO(content)) as source:
        _check_image_size(source)
        if max_side:
            source.draft('RGB', (max_side, max_side))
        image = image_color.to_srgb(ImageOps.exif_transpose(source))
        if max_side:
            image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
        return image.convert('RGB')


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
        _check_image_size(probe)
        probe.verify()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(422, f"Файл в поле {field} не похож на изображение.")
    return content, Image.MIME.get(probe.format, "image/jpeg")


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
    prompt_override: str | None = None,
    resolution_override: str | None = None
):
    if "max" in model_name:
        # The profile decides: a draft is fast 1k, a final quality 2k. Without
        # an explicit value this stays the final's quality mode.
        generation_mode = generation_mode_override or 'quality'
        prompt = prompt_override or os.getenv("FASHN_PROMPT", "").strip()
        inputs = {
            "model_image": model_image,
            "product_image": garment_image,
            "output_format": "png",
            "return_base64": os.getenv("FASHN_RETURN_BASE64", "false").lower() == "true"
        }
        if prompt:
            inputs["prompt"] = prompt
        if generation_mode:
            inputs["generation_mode"] = generation_mode
        resolution = resolution_override or os.getenv("FASHN_QUALITY_RESOLUTION", "2k").strip()
        if resolution:
            inputs["resolution"] = resolution
        seed = os.getenv("FASHN_SEED", "").strip()
        if seed:
            inputs["seed"] = int(seed)
        inputs["num_images"] = 1
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


# English nouns for the look prompt of a general editor, from the classifier.
_CATEGORY_NOUNS = {name: noun for (name, _section, _description), noun in zip(CATEGORIES, SHORT_NAMES)}
# Inputs for fal: the model sees about 1 MP anyway, and a smaller request
# travels faster than the 2048 px frames FASHN is sent.
FAL_PERSON_SIDE = 1344
FAL_GARMENT_SIDE = 1024
FAL_JPEG_QUALITY = 92


async def _run_fal_look(client, model, person_content, garments, top_category, outer_category, tuck, seed, categories=None):
    """One call for the whole look: the photo first, then each garment."""
    categories = dict(categories or {})
    slots = [slot for slot in fal_tryon.LOOK_ORDER if slot in garments]
    person_url = await asyncio.to_thread(_prepare_provider_frame, person_content, FAL_PERSON_SIDE, FAL_JPEG_QUALITY, fal_tryon.MIN_ASPECT)
    decoded = _data_url_to_bytes(person_url)
    frame_size = Image.open(BytesIO(decoded[0])).size if decoded else None
    garment_urls = [await asyncio.to_thread(_prepare_tryon_image_data_url, garments[slot][0], garments[slot][1],
                                            FAL_GARMENT_SIDE, FAL_JPEG_QUALITY) for slot in slots]
    if model.family == 'bria':
        prompt = tryon_policy.bria_instruction(slots, top_category, outer_category, tuck)
    else:
        prompt = tryon_policy.look_prompt(slots, top_category, outer_category, tuck, _CATEGORY_NOUNS, categories)
    return await fal_tryon.generate(client, model, person_url, garment_urls, prompt, seed, frame_size=frame_size)


async def _run_fal_layers(client, model, base_url, garments, upper, categories, seed, frame_size=None):
    """Second call of a layered look: the upper layers over the finished base look."""
    garment_urls = [await asyncio.to_thread(_prepare_tryon_image_data_url, garments[slot][0], garments[slot][1],
                                            FAL_GARMENT_SIDE, FAL_JPEG_QUALITY) for slot in upper]
    prompt = tryon_policy.layer_prompt(upper, categories, _CATEGORY_NOUNS, categories.get('top', ''))
    return await fal_tryon.generate(client, model, base_url, garment_urls, prompt, seed, frame_size=frame_size)


def _look_strategy():
    return os.getenv('FASHN_LOOK_STRATEGY', tryon_policy.STRATEGY).strip().lower()


def _plan_stages(garments, top_category, outer_category, tuck, max_side, jpeg_quality):
    """One provider call per garment, innermost first (tryon_policy.STAGE_ORDER).

    Each stage's product image is a single garment, which is what tryon-max is
    built for. The legacy "collage" strategy puts every garment on one board.
    """
    if len(garments) > 1 and _look_strategy() == 'collage':
        images = {slot: tryon_reference.decode(content) for slot, (content, _) in garments.items()}
        board, positions = tryon_reference.build(images)
        return [('outfit', _image_to_data_url(board), tryon_reference.prompt(positions, top_category, outer_category, tuck))]
    return [(slot, _prepare_tryon_image_data_url(content, mime, max_side, jpeg_quality), prompt)
            for slot, content, mime, prompt in _stage_specs(garments, top_category, outer_category, tuck)]


def _stage_specs(garments, top_category, outer_category, tuck):
    """The layer chain before any image work: (slot, content, mime, prompt).

    Planning and the layer cache both read the chain from here, so a cached
    layer can only ever be matched to exactly the instruction it was made with.
    """
    specs = []
    for slot in tryon_policy.STAGE_ORDER:
        if slot not in garments:
            continue
        content, mime = garments[slot]
        category = outer_category if slot == 'outer' else top_category if slot == 'top' else ''
        prompt = tryon_policy.garment_prompt(slot, category, tuck, keep_outer_open=(slot == 'outer' and 'top' in garments))
        specs.append((slot, content, mime, prompt))
    return specs


def _layer_chain_keys(profile, person_content, garments, top_category, outer_category, tuck, max_side, jpeg_quality):
    """Cache keys of the layer chain, or [] when layers cannot be reused.

    Everything that shapes a provider frame goes into the key: the policy
    version, model, profile and the preparation of the photo and garments.
    """
    if _look_strategy() == 'collage':
        return []
    profile_key = f'{tryon_policy.CACHE_VERSION}|{tryon_policy.MODEL}|{profile.mode}|{profile.resolution}|{max_side}|{jpeg_quality}'
    stages = [(slot, hashlib.sha256(content).hexdigest(), prompt)
              for slot, content, _, prompt in _stage_specs(garments, top_category, outer_category, tuck)]
    return stage_cache.chain_keys(profile_key, hashlib.sha256(person_content).hexdigest(), stages)


def _frame_for_cache(image):
    """A provider frame as it will be fed back to the provider later.

    The first layer already goes out as a JPEG at this quality, so a reused
    frame reaches the provider in the same form as a fresh one would.
    """
    buff = BytesIO()
    image.convert('RGB').save(buff, format='JPEG', quality=97, optimize=True, icc_profile=image_color.SRGB_BYTES)
    return buff.getvalue()


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
    for slot, content in [('person', person_content), ('top', top_content), ('bottom', bottom_content), ('shoes', shoes_content), ('outer', outer_content)]:
        hasher.update(slot.encode('ascii'))
        hasher.update(hashlib.sha256(content).digest() if content is not None else b'missing')
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
    poll_interval_seconds: float | None = None,
    seed_override: int | None = None,
    resolution_override: str | None = None
):
    if "max" in model_name:
        inputs = _build_fashn_inputs(
            model_name,
            model_image,
            garment_image,
            mode_override=mode_override,
            generation_mode_override=generation_mode_override,
            prompt_override=prompt_override,
            resolution_override=resolution_override
        )
        if max_wait_seconds is not None:
            inputs["_max_wait_seconds"] = max_wait_seconds
        if poll_interval_seconds is not None:
            inputs["_poll_interval_seconds"] = poll_interval_seconds
        if seed_override is not None:
            inputs['seed'] = seed_override
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
    login: str = Field(max_length=64)
    password: str = Field(max_length=1024)
    displayName: str = Field(default="", max_length=128)


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


@app.post("/auth/delete-account")
async def auth_delete_account(login: str = Depends(access.require_account)):
    """Account deletion required by the app stores: the user, sessions, stored
    try-on results, cached try-on layers and usage rows are removed. Local data
    is cleared by the app."""
    await asyncio.to_thread(jobs.purge_owner, login)
    await asyncio.to_thread(stage_cache.purge_owner, login)
    existed = await asyncio.to_thread(accounts.delete_account, login)
    return {"deleted": bool(existed), "login": login}


@app.get("/auth/me")
def auth_me(login: str = Depends(access.require_account)):
    """Приложение спрашивает это при запуске, чтобы понять, жива ли сессия."""
    return {**(accounts.profile(login) or {"login": login, "displayName": ""}),
            # Both in FASHN credits: a draft layer costs 1, a final one 4.
            "spentToday": access.spent_today(login), "dailyQuota": access.daily_credits()}


@app.post("/analyze")
def analyze(file: UploadFile = File(...), section_hint: str = Form(""), device: str = Depends(access.require_account)):
    access.throttle(device, 'analyze', _env_int('AI_ANALYZE_PER_MINUTE', 20))
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
    raise HTTPException(410, 'Этот способ примерки устарел. Обнови приложение.')


@app.get('/tryon-jobs/{request_id}')
async def tryon_job(request_id: str, device: str = Depends(access.require_account)):
    job = await asyncio.to_thread(jobs.get, device, request_id)
    if job is None:
        raise HTTPException(404, 'Примерка не найдена.')
    return job['result'] or {'status': 'processing', 'jobId': request_id}


@app.post("/tryon-generate-look")
async def tryon_generate_look(
    person_file: UploadFile = File(...),
    top_file: UploadFile | None = File(None),
    bottom_file: UploadFile | None = File(None),
    shoes_file: UploadFile | None = File(None),
    outer_file: UploadFile | None = File(None),
    # A second layer worn over the first top or the first outerwear.
    top2_file: UploadFile | None = File(None),
    outer2_file: UploadFile | None = File(None),
    tuck_mode: str = Form("auto"),
    compare_mode: str = Form("false"),
    quality_mode: str = Form("quality"),
    top_category: str = Form(""),
    outer_category: str = Form(""),
    top2_category: str = Form(""),
    outer2_category: str = Form(""),
    request_id: str = Form(""),
    async_mode: str = Form("false"),
    fresh: str = Form("false"),
    device: str = Depends(access.require_account)
):
    try:
        use_fal = fal_tryon.enabled()
        token = os.getenv("FASHN_API_KEY", "").strip()
        if not use_fal and not token:
            return {"error": "FASHN_API_KEY is not set"}
        if not use_fal and not token.isascii():
            return {"error": "FASHN_API_KEY contains non-ASCII symbols. Set the real API key (latin letters/numbers only)."}
        # A draft (fast 1k, 1 credit per layer) unless the app asks for the
        # final (quality 2k, 4 credits). The app names them 'fast'/'quality'.
        profile = tryon_policy.profile(tryon_policy.normalize_quality(quality_mode))
        look_model_name = tryon_policy.MODEL
        look_mode = profile.mode
        look_generation_mode = profile.mode
        base_prompt = tryon_policy.IDENTITY
        quality_mode_normalized = 'fast' if profile.name == 'draft' else 'quality'
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
        # Optional layers, as the request_id below: a direct call gets Form/File defaults.
        # Over HTTP the value is Starlette's UploadFile, not FastAPI's subclass.
        top2_content, top2_mime = await read_upload(top2_file if isinstance(top2_file, StarletteUploadFile) else None, "top2_file")
        outer2_content, outer2_mime = await read_upload(outer2_file if isinstance(outer2_file, StarletteUploadFile) else None, "outer2_file")
        top2_category = top2_category if isinstance(top2_category, str) else ''
        outer2_category = outer2_category if isinstance(outer2_category, str) else ''
        layered = bool(top2_content or outer2_content)

        if not any((top_content, bottom_content, shoes_content, outer_content, top2_content, outer2_content)):
            return {"error": "Выбери хотя бы одну вещь для примерки."}
        # With TRYON_PROVIDER=fal the whole look is one call to a general editor
        # (fal_tryon); otherwise FASHN dresses one garment per call.
        if layered and not use_fal:
            return {"error": "Многослойные образы доступны только в новой примерке."}
        fal_model = fal_tryon.model_for(profile.name, sum(1 for content in (top_content, bottom_content, shoes_content, outer_content, top2_content, outer2_content) if content)) if use_fal else None
        if fal_model:
            look_model_name = f'fal:{fal_model.key}'

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
            f'{profile.name}|{profile.mode}|{profile.resolution}',
            f"{top_category.strip()}|{outer_category.strip()}"
            + (f"|{top2_category.strip()}|{outer2_category.strip()}|"
               + '|'.join(hashlib.sha256(content).hexdigest() if content else '-' for content in (top2_content, outer2_content))
               if layered else '')
        )
        request_id = request_id if isinstance(request_id, str) else ''
        if request_id and not re.fullmatch(r'[A-Za-z0-9_-]{16,96}', request_id):
            raise HTTPException(422, 'Некорректный идентификатор примерки.')
        job_id = request_id or f'legacy-{int(time.time() // 21600)}-{cache_key[:32]}'
        task_key = f'{device}:{job_id}'
        seed = int(hashlib.sha256(job_id.encode()).hexdigest()[:8], 16) % 2147483647
        garments = {slot: (content, mime) for slot, content, mime in [
            ('top', top_content, top_mime), ('bottom', bottom_content, bottom_mime),
            ('outer', outer_content, outer_mime), ('shoes', shoes_content, shoes_mime),
            ('top2', top2_content, top2_mime), ('outer2', outer2_content, outer2_mime)
        ] if content}
        slot_categories = {'top': top_category.strip(), 'outer': outer_category.strip(),
                           'top2': top2_category.strip(), 'outer2': outer2_category.strip()}
        stage_total = 1 if fal_model or _look_strategy() == 'collage' else len(garments)
        # Layers shared with an earlier look of this person are taken from the
        # layer cache instead of being paid for again. `fresh` is set by the app
        # when the same garments are generated once more: the user wants a new
        # variant, and any of the layers may be the one they disliked.
        chain_keys = [] if fal_model else _layer_chain_keys(profile, person_content, garments, top_category.strip(), outer_category.strip(),
                                                           tuck_mode_normalized, tryon_max_side, tryon_jpeg_quality)
        reuse = (fresh if isinstance(fresh, str) else '').strip().lower() not in ('1', 'true', 'yes', 'on')
        reused_depth, reused_frame = await asyncio.to_thread(stage_cache.lookup, device, chain_keys) if chain_keys and reuse else (0, None)
        # The budget is reserved in credits for exactly the layers that will run;
        # a fal look is one call and takes TRYON_FAL_UNITS.
        # A layered look on fal is two calls: the base look, then the upper layers over it.
        fal_layer_pass = bool(fal_model) and fal_tryon.layer_pass(list(garments))
        cost = fal_tryon.units() * (2 if fal_layer_pass else 1) if fal_model else (stage_total - reused_depth) * profile.credits

        async def _generate_look():
            started = time.monotonic()
            prepared_identity = await asyncio.to_thread(_prepare_identity_source, person_content)
            stages = ([('outfit', None, None)] + ([('layers', None, None)] if fal_layer_pass else [])) if fal_model else await asyncio.to_thread(
                _plan_stages, garments, top_category.strip(), outer_category.strip(), tuck_mode_normalized,
                tryon_max_side, tryon_jpeg_quality
            )
            timings = {'prepareSeconds': round(time.monotonic() - started, 2), 'layersReused': reused_depth}
            steps = []
            names = [name for name, _, _ in stages]
            preview_url = None
            layer_warning = None
            # Frames this job generated, as (layer index, bytes). They reach the
            # layer cache only after the whole look passes the identity lock.
            fresh_frames = []
            last_frame = None

            async def publish(done, stage=None, preview_url=None):
                # Progress is best effort: a failed write never fails the paid work.
                try:
                    payload = {'progress': {'done': done, 'pending': [n for n in names if n not in done and n != stage],
                                            'stage': stage, 'total': len(names)}}
                    if preview_url:
                        payload['progress']['previewUrl'] = preview_url
                    await asyncio.to_thread(jobs.progress, device, job_id, payload)
                except Exception as exc:
                    print(f'Try-on progress unavailable: {type(exc).__name__}', flush=True)

            if reused_depth:
                # The base layers come from an earlier look of this person;
                # dressing continues on that frame, and the user sees it at once.
                current_model = _bytes_to_data_url(reused_frame, 'image/jpeg')
                steps.extend({'step': name, 'result': {'status': 'reused'}, 'durationSeconds': 0}
                             for name in names[:reused_depth])
                try:
                    reused_image = await asyncio.to_thread(_working_image, reused_frame)
                    preview_url = await asyncio.to_thread(_stage_preview_url, prepared_identity, reused_image)
                except Exception as exc:
                    print(f'Try-on preview unavailable: {type(exc).__name__}', flush=True)
            elif not fal_model:
                current_model = await asyncio.to_thread(_prepare_provider_frame, person_content, tryon_max_side, tryon_jpeg_quality)

            async with httpx.AsyncClient(timeout=120.0, trust_env=False) as client:
                if fal_model:
                    upper = [slot for slot in fal_tryon.UPPER_LAYERS if slot in garments] if fal_layer_pass else []
                    await publish([], stage='outfit')
                    jobs.attempt(device, job_id, fal_tryon.units())
                    step_started = time.monotonic()
                    result = await _run_fal_look(client, fal_model, person_content,
                                                 {slot: value for slot, value in garments.items() if slot not in upper},
                                                 top_category.strip(), outer_category.strip(), tuck_mode_normalized, seed, slot_categories)
                    elapsed = round(time.monotonic() - step_started, 2)
                    steps.append({'step': 'outfit', 'result': result, 'durationSeconds': elapsed})
                    print(f'Try-on timing: stage=outfit; model={fal_model.key}; seconds={elapsed}; '
                          f'usd={result.get("costUsd")}; error={result.get("error")}; '
                          f'layers={",".join(f"{slot}:{slot_categories.get(slot) or slot}" for slot in fal_tryon.LOOK_ORDER if slot in garments)}', flush=True)
                    if result.get('error') or not result.get('outputUrl'):
                        return {'error': fal_tryon.user_error(result), 'steps': steps}
                    current_model = result['outputUrl']
                    if upper:
                        # The base look is shown while the layers go on; its face and
                        # background are the editor's until the final lock.
                        base_frame = None
                        try:
                            base_frame = await _load_image_from_url_or_data_url(client, current_model)
                            preview_url = await asyncio.to_thread(_stage_preview_url, prepared_identity, base_frame) if base_frame else None
                        except Exception as exc:
                            print(f'Try-on preview unavailable: {type(exc).__name__}', flush=True)
                        await publish(['outfit'], stage='layers', preview_url=preview_url)
                        jobs.attempt(device, job_id, fal_tryon.units())
                        step_started = time.monotonic()
                        layered = await _run_fal_layers(client, fal_model, current_model, garments, upper, slot_categories, seed,
                                                        base_frame.size if base_frame is not None else None)
                        elapsed = round(time.monotonic() - step_started, 2)
                        steps.append({'step': 'layers', 'result': layered, 'durationSeconds': elapsed})
                        print(f'Try-on timing: stage=layers; model={fal_model.key}; seconds={elapsed}; '
                              f'usd={layered.get("costUsd")}; error={layered.get("error")}', flush=True)
                        if layered.get('outputUrl'):
                            current_model = layered['outputUrl']
                        else:
                            # The base look is paid for and correct; show it and say what is missing.
                            layer_warning = LAYERS_WARNING
                    try:
                        last_frame = await _load_image_from_url_or_data_url(client, current_model)
                    except Exception as exc:
                        print(f'Try-on frame unavailable: {type(exc).__name__}', flush=True)
                for index in range(reused_depth, 0 if fal_model else len(stages)):
                    step_name, reference, prompt = stages[index]
                    step_started = time.monotonic()
                    await publish(names[:index], stage=step_name, preview_url=preview_url)
                    jobs.attempt(device, job_id, profile.credits)
                    result = await _run_fashn_tryon_with_category_fallback(
                        client, token, look_model_name, current_model, reference, ['auto'],
                        mode_override=look_mode, generation_mode_override=look_generation_mode,
                        prompt_override=prompt, max_wait_seconds=step_max_wait_seconds,
                        poll_interval_seconds=poll_interval_seconds, seed_override=seed,
                        resolution_override=profile.resolution
                    )
                    elapsed = round(time.monotonic()-step_started, 2)
                    steps.append({'step': step_name, 'result': result, 'durationSeconds': elapsed})
                    print(f'Try-on timing: stage={step_name}; seconds={elapsed}', flush=True)
                    if result.get('error') or not result.get('outputUrl'):
                        return {'error': 'Не удалось сгенерировать примерку.', 'steps': steps}
                    # The provider's frame is the model for the next garment. It is
                    # already on the provider's canvas, so nothing is refitted.
                    current_model = result['outputUrl']
                    # The frame feeds the progress preview, the layer cache and the
                    # final lock. None of them may fail the paid work.
                    try:
                        frame = await _load_image_from_url_or_data_url(client, current_model)
                        if frame is not None:
                            if chain_keys:
                                fresh_frames.append((index, await asyncio.to_thread(_frame_for_cache, frame)))
                            if index < len(stages) - 1:
                                preview_url = await asyncio.to_thread(_stage_preview_url, prepared_identity, frame)
                            else:
                                last_frame = frame
                    except Exception as exc:
                        print(f'Try-on layer frame unavailable: {type(exc).__name__}', flush=True)
                        if index < len(stages) - 1:
                            preview_url = None
                await publish(names, stage='composite', preview_url=preview_url)

            # A second layer changes the same body region as the first one.
            changed_slots = sorted({tryon_policy.composite_slot(slot.rstrip('2'), slot_categories.get(slot, '') if slot != 'bottom' and slot != 'shoes' else '')
                                    for slot in garments})

            composite_started = time.monotonic()
            warning = None
            locked = True
            face_restored = False
            async with httpx.AsyncClient(timeout=30.0, trust_env=False) as output_client:
                if fal_model and fal_tryon.face_only():
                    # The editor's scene is kept whole; only the face is the photo's.
                    frame = last_frame or await _load_image_from_url_or_data_url(output_client, current_model)
                    restored = await asyncio.to_thread(_face_only_output_url, frame, prepared_identity, fal_tryon.MIN_ASPECT) if frame is not None else None
                    if restored:
                        locked_output_url, face_restored, locked = restored, True, False
                        print('Try-on composite: face-restored', flush=True)
                if not face_restored:
                    try:
                        locked_output_url = await _face_locked_output_url(
                            output_client, person_content, current_model, changed_slots, prepared_identity,
                            debug_context=(device, job_id), generated_image=last_frame,
                        )
                    except AlignmentRejected as exc:
                        if exc.frame is None or not _env_bool('AI_TRYON_UNLOCKED_FALLBACK', True):
                            raise
                        locked = False
                        # The scene moved, but the face alone may still fit: the
                        # user then sees their own face on the generator's frame.
                        restored = await asyncio.to_thread(_face_restored_output_url, exc.frame, prepared_identity)
                        if restored:
                            locked_output_url, face_restored = restored, True
                            print('Try-on composite: face-restored', flush=True)
                        else:
                            # The credits are spent; show the provider's frame with an
                            # explicit note rather than an error, and let the user
                            # decide whether to regenerate.
                            locked_output_url = await asyncio.to_thread(_unlocked_output_url, person_content, exc.frame)
                            warning = UNLOCKED_WARNING
                            print('Try-on composite: unlocked-fallback', flush=True)
            timings['compositeSeconds'] = round(time.monotonic() - composite_started, 2)
            # Only a look that passed the identity lock may seed later looks: a
            # frame that could not be aligned would carry its defect into every
            # look built on top of it.
            if locked and fresh_frames:
                try:
                    for index, data in fresh_frames:
                        await asyncio.to_thread(stage_cache.store, device, chain_keys[index], data)
                except Exception as exc:
                    print(f'Try-on layer cache unavailable: {type(exc).__name__}', flush=True)
            timings['totalSeconds'] = round(time.monotonic() - started, 2)
            print(f'Try-on timing: prepare={timings["prepareSeconds"]}; composite={timings["compositeSeconds"]}; total={timings["totalSeconds"]}', flush=True)
            response = {
                "status": "succeeded",
                "outputUrl": locked_output_url,
                "steps": steps,
                "tuckModeUsed": tuck_mode_normalized,
                "qualityModeUsed": quality_mode_normalized,
                "modelUsed": look_model_name,
                "timings": timings,
                "identityLocked": locked,
                "faceRestored": face_restored,
                "layersReused": reused_depth,
                "creditsCharged": cost if fal_model else (len(stages) - reused_depth) * profile.credits,
            }
            warning = ' · '.join(part for part in (warning, layer_warning) if part)
            if warning:
                response["warning"] = warning
            return response

        async def execute():
            try:
                result = await _generate_look()
            except (ValueError, HTTPException) as exc:
                result = {'error': exc.detail if isinstance(exc, HTTPException) else str(exc)}
            except Exception as exc:
                print(f'Try-on job failed: {type(exc).__name__}')
                result = {'error': 'Не удалось завершить примерку. Создай новый вариант.'}
            # Persist only the protected result, not unprotected provider URLs.
            if result.get('error'):
                result = {'status': 'failed', 'error': result['error']}
            elif result.get('steps'):
                result['steps'] = [{'step': step['step'], 'durationSeconds': step.get('durationSeconds'), 'result': {'status': step['result'].get('status')}} for step in result['steps']]
            result.update(jobId=job_id, updatedAt=int(time.time() * 1000))
            await asyncio.to_thread(jobs.finish, device, job_id, result)
            _TRYON_LOOK_INFLIGHT.pop(task_key, None)
            return result

        access.throttle(device, 'tryon', _env_int('AI_TRYON_PER_MINUTE', 6))
        if not fal_model and not await asyncio.to_thread(fashn_credits.sufficient, token, cost):
            return {"error": fashn_credits.ERROR}
        async with _TRYON_LOOK_LOCK:
            created, job = await asyncio.to_thread(jobs.start, device, job_id, cache_key, cost)
            if not created and job['status'] != 'running' and job['result']:
                return {**job['result'], 'cached': True}
            inflight_task = _TRYON_LOOK_INFLIGHT.get(task_key)
            if created:
                inflight_task = asyncio.create_task(execute())
                _TRYON_LOOK_INFLIGHT[task_key] = inflight_task
        if async_mode == 'true' or inflight_task is None:
            return JSONResponse({'status': 'processing', 'jobId': job_id}, status_code=202)
        return await asyncio.shield(inflight_task)
    except HTTPException:
        raise
    except ValueError as exc:
        return {"error": str(exc)}
    except Exception as exc:
        print(f'Try-on look failed: {type(exc).__name__}')
        return {"error": "Не удалось завершить примерку. Попробуй ещё раз."}
