"""A whole look in one call to an image editor hosted on fal.ai.

tryon-max dresses one garment per call at 1-4 FASHN credits of $0.075: a
three-piece final is 12 credits, about 76 RUB at 84 RUB/$. The editors below
take the photo and every garment in one request for a few cents per look:

    key             model on fal                           price per look
    bria-tryon      Bria FIBO-Edit 1.5 virtual try-on      $0.04 flat, up to 3 garments
    seedream-4.5    ByteDance Seedream 4.5 edit            $0.04 flat, up to 9 garments
    seedream-4      ByteDance Seedream 4.0 edit            $0.03 flat
    flux2-klein-9b  FLUX.2 [klein] 9B edit                 $0.011 per MP, inputs included
    qwen-edit-2511  Qwen-Image-Edit-2511                   $0.03 per output MP

The result is trusted no more than a FASHN frame: it goes through the same
identity lock, so the face, hair and background stay the user's own pixels.
The provider is a server setting (TRYON_PROVIDER=fal with FAL_KEY) and can be
switched back to FASHN without an app release.
"""
import asyncio
import math
import os
import time
from typing import NamedTuple

import httpx

QUEUE_URL = 'https://queue.fal.run'
# The order garments follow the photo in, inner to outer and top to bottom:
# the prompt names each image by this position.
LOOK_ORDER = ('top', 'bottom', 'outer', 'shoes')
BALANCE_ERROR = 'Примерочная временно недоступна: закончился баланс генерации. Попробуй позже.'
BLOCKED_ERROR = 'Генератор отклонил фото. Попробуй другое фото или другие вещи.'
TIMEOUT_ERROR = 'Генерация заняла слишком много времени. Попробуй ещё раз.'
FAILED_ERROR = 'Не удалось сгенерировать примерку.'
# Sizes on the provider canvas of tryon_frame (24:43): the result is a plain
# resize of what was sent. fal bills a megapixel as 1024x1024 and rounds up,
# so 752x1344 is exactly one.
MEGAPIXEL = 1024 * 1024
CANVAS_1MP = {'width': 752, 'height': 1344}
CANVAS_2MP = {'width': 1152, 'height': 2064}


class Model(NamedTuple):
    key: str
    endpoint: str
    family: str
    max_garments: int
    flat_usd: float = 0.0
    usd_per_mp: float = 0.0
    inputs_billed: bool = False


MODELS = {model.key: model for model in (
    Model('bria-tryon', 'bria/fibo-edit-1.5/virtual-try-on', 'bria', 3, flat_usd=0.04),
    Model('seedream-4.5', 'fal-ai/bytedance/seedream/v4.5/edit', 'seedream', 9, flat_usd=0.04),
    Model('seedream-4', 'fal-ai/bytedance/seedream/v4/edit', 'seedream', 9, flat_usd=0.03),
    Model('flux2-klein-9b', 'fal-ai/flux-2/klein/9b/edit', 'flux2', 3, usd_per_mp=0.011, inputs_billed=True),
    Model('qwen-edit-2511', 'fal-ai/qwen-image-edit-2511', 'qwen', 2, usd_per_mp=0.03),
)}
DEFAULT_MODEL = 'seedream-4.5'


def enabled():
    return os.getenv('TRYON_PROVIDER', 'fashn').strip().lower() == 'fal' and bool(api_key())


def api_key():
    key = os.getenv('FAL_KEY', '').strip()
    return key if key.isascii() else ''


def _model(env_name, default):
    return MODELS.get(os.getenv(env_name, '').strip().lower()) or MODELS[default]


def model_for(profile_name, garment_count):
    """The editor for a draft or a final, and one that can take every garment.

    A look is always one call: when the configured editor accepts fewer
    garments than were chosen, the look goes to TRYON_FAL_MANY_MODEL instead
    of being split into several paid calls.
    """
    final = _model('TRYON_FAL_MODEL', DEFAULT_MODEL)
    model = _model('TRYON_FAL_DRAFT_MODEL', final.key) if profile_name == 'draft' else final
    if garment_count > model.max_garments:
        model = _model('TRYON_FAL_MANY_MODEL', DEFAULT_MODEL)
    if garment_count > model.max_garments:
        model = MODELS[DEFAULT_MODEL]
    return model


def units():
    """What one look takes from the daily budgets, which count FASHN credits."""
    try:
        return max(1, int(os.getenv('TRYON_FAL_UNITS', '1')))
    except ValueError:
        return 1


def output_size(model):
    if model.family in ('flux2', 'qwen'):
        return dict(CANVAS_1MP)
    if model.key == 'seedream-4':
        return dict(CANVAS_2MP)
    # Seedream 4.5 takes only large custom sizes; its preset follows the photo.
    return 'auto_2K' if model.family == 'seedream' else None


def estimate_usd(model, garment_count):
    """The price of one look, for logs and the benchmark, never for billing."""
    if model.flat_usd:
        return model.flat_usd
    size = output_size(model) or CANVAS_1MP
    megapixels = math.ceil(size['width'] * size['height'] / MEGAPIXEL)
    if model.inputs_billed:
        # Every input is resized to at most 1 MP and billed as at least one.
        megapixels += 1 + garment_count
    return round(model.usd_per_mp * megapixels, 4)


def payload(model, person_url, garment_urls, prompt, seed):
    safety = os.getenv('TRYON_FAL_SAFETY', 'true').strip().lower() not in ('0', 'false', 'no', 'off')
    if model.family == 'bria':
        # Bria has its own try-on instruction; ours is appended to it.
        body = {'person_image_url': person_url, 'garment_image_urls': list(garment_urls), 'seed': seed}
        if prompt:
            body['instruction'] = prompt
        return body
    body = {'prompt': prompt, 'image_urls': [person_url, *garment_urls], 'num_images': 1, 'seed': seed,
            'enable_safety_checker': safety}
    size = output_size(model)
    if size:
        body['image_size'] = size
    if model.family == 'seedream':
        body['max_images'] = 1
    else:
        body['output_format'] = 'png'
    return body


def _image_url(output):
    if not isinstance(output, dict):
        return None
    image = output.get('image')
    if isinstance(image, dict) and isinstance(image.get('url'), str):
        return image['url']
    for item in output.get('images') or []:
        if isinstance(item, dict) and isinstance(item.get('url'), str):
            return item['url']
    return None


def _failure(response, stage):
    text = response.text[:400]
    lowered = text.lower()
    result = {'error': f'fal {stage} failed ({response.status_code})', 'detail': text}
    if response.status_code in (402, 403) and ('balance' in lowered or 'locked' in lowered):
        result['balance'] = True
    return result


def _now():
    return time.monotonic()


async def generate(client, model, person_url, garment_urls, prompt, seed, max_wait_seconds=None, poll_seconds=1.0):
    """Submit one look to the fal queue and wait for its image URL.

    Returns {'status': 'succeeded', 'outputUrl', 'costUsd', 'model'} or
    {'error', ...} with 'balance', 'blocked' or 'timeout' set when known.
    """
    max_wait_seconds = max_wait_seconds or int(os.getenv('TRYON_FAL_MAX_WAIT_SECONDS', '180'))
    headers = {'Authorization': f'Key {api_key()}', 'Content-Type': 'application/json'}
    body = payload(model, person_url, garment_urls, prompt, seed)
    try:
        submitted = await client.post(f'{QUEUE_URL}/{model.endpoint}', headers=headers, json=body)
    except httpx.HTTPError as exc:
        return {'error': f'fal submit failed: {type(exc).__name__}'}
    if submitted.status_code >= 400:
        return _failure(submitted, 'submit')
    queued = submitted.json()
    status_url, response_url = queued.get('status_url'), queued.get('response_url')
    if not status_url or not response_url:
        return {'error': 'fal submit returned no status URL'}
    deadline = _now() + max_wait_seconds
    network_errors = 0
    while True:
        await asyncio.sleep(poll_seconds)
        if _now() > deadline:
            cancel_url = queued.get('cancel_url')
            if cancel_url:
                try:
                    # Only a request still in the queue can be cancelled; a
                    # running one is billed either way.
                    await client.put(cancel_url, headers=headers)
                except httpx.HTTPError:
                    pass
            return {'error': 'fal timeout', 'timeout': True}
        try:
            status = await client.get(status_url, headers=headers)
        except httpx.HTTPError as exc:
            network_errors += 1
            if network_errors >= 5:
                return {'error': f'fal status failed: {type(exc).__name__}'}
            continue
        if status.status_code >= 400:
            return _failure(status, 'status')
        state = status.json()
        if state.get('status') != 'COMPLETED':
            continue
        if state.get('error'):
            return {'error': f'fal {state.get("error_type") or "model"} error', 'detail': str(state['error'])[:400]}
        break
    try:
        response = await client.get(response_url, headers=headers)
    except httpx.HTTPError as exc:
        return {'error': f'fal result failed: {type(exc).__name__}'}
    if response.status_code >= 400:
        return _failure(response, 'result')
    output = response.json()
    if any(output.get('has_nsfw_concepts') or []):
        return {'error': 'fal safety filter', 'blocked': True}
    url = _image_url(output)
    if not url:
        return {'error': 'fal returned no image'}
    return {'status': 'succeeded', 'outputUrl': url, 'model': model.key,
            'costUsd': estimate_usd(model, len(garment_urls)), 'requestId': queued.get('request_id')}


def user_error(result):
    """The message a user sees for a failed call; details stay in the logs."""
    if result.get('balance'):
        return BALANCE_ERROR
    if result.get('blocked'):
        return BLOCKED_ERROR
    if result.get('timeout'):
        return TIMEOUT_ERROR
    return FAILED_ERROR
