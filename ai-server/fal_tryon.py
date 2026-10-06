"""A whole look in one call to an image editor hosted on fal.ai.

tryon-max dresses one garment per call at 1-4 FASHN credits of $0.075: a
three-piece final is 12 credits, about 76 RUB at 84 RUB/$. The editors below
take the photo and every garment in one request for a few cents per look:

    key             model on fal                           price per look
    seedream-5-lite ByteDance Seedream 5.0 Lite edit       $0.035 flat, up to 9 garments
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
import json
import math
import os
import time
from typing import NamedTuple

import httpx

QUEUE_URL = 'https://queue.fal.run'
# The order garments follow the photo in, inner to outer and top to bottom:
# the prompt names each image by this position.
# Further tops or outer layers (`top2`..`top4`, `outer2`) are worn over the first one.
# Upper layers follow the bottom from the inside out: an editor ignored a
# "second top" placed right after the first, but layers outerwear reliably.
LOOK_ORDER = ('top', 'bottom', 'top2', 'top3', 'top4', 'outer', 'outer2', 'legwear', 'shoes')
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
    # Seedream 5.0 Lite takes no seed; an unknown field may fail the request.
    seeded: bool = True


MODELS = {model.key: model for model in (
    Model('seedream-5-lite', 'fal-ai/bytedance/seedream/v5/lite/edit', 'seedream', 9, flat_usd=0.035, seeded=False),
    # Measured 2026-10-06: 20-25 s against Lite's 40-110 s; not yet compared for quality across looks.
    Model('seedream-5-flash', 'bytedance/seedream/v5/flash/edit', 'seedream', 9, flat_usd=0.027, seeded=False),
    Model('bria-tryon', 'bria/fibo-edit-1.5/virtual-try-on', 'bria', 3, flat_usd=0.04),
    Model('seedream-4.5', 'fal-ai/bytedance/seedream/v4.5/edit', 'seedream', 9, flat_usd=0.04),
    Model('seedream-4', 'fal-ai/bytedance/seedream/v4/edit', 'seedream', 9, flat_usd=0.03),
    Model('flux2-klein-9b', 'fal-ai/flux-2/klein/9b/edit', 'flux2', 3, usd_per_mp=0.011, inputs_billed=True),
    Model('qwen-edit-2511', 'fal-ai/qwen-image-edit-2511', 'qwen', 2, usd_per_mp=0.03),
)}
# The newest Seedream is also the cheapest, and it is the one measured against a
# specialised try-on model (Tstars-Tryon, arXiv 2604.19748): 9.30 vs 9.37 of 10
# on one garment, 8.91 vs 9.17 on a whole outfit.
DEFAULT_MODEL = 'seedream-5-lite'
# The photo goes as it is: side bands made Seedream redraw the person larger
# and stretched. Only a photo narrower than 1:3 is padded to 1:3.
MIN_ASPECT = 1 / 3


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


def face_only():
    """Restore only the face from the photo, keep the editor's whole scene.

    A general editor redraws the room faithfully but relit and a few pixels
    off. Pasting the photo's floor and furniture back around the body then
    shows as a seam: a dark arc between the feet, a doubled slipper. So by
    default only the face comes from the photo; TRYON_FAL_RESTORE=scene brings
    back the full lock that also restores the background.
    """
    return os.getenv('TRYON_FAL_RESTORE', 'face').strip().lower() != 'scene'


# Layers worn over the base top, from the inside out.
UPPER_LAYERS = ('top2', 'top3', 'top4', 'outer', 'outer2')


def layer_pass(slots):
    """True when the upper layers go in a second call over the finished base look.

    One call keeps a T-shirt, a shirt and a trench coat together (three runs of
    three), so that is the default. The second call, twice the price and time,
    shows every layer more openly: TRYON_FAL_LAYER_PASS=layered uses it for two
    or more upper layers, `always` for a single one too.
    """
    mode = os.getenv('TRYON_FAL_LAYER_PASS', 'off').strip().lower()
    upper = [slot for slot in UPPER_LAYERS if slot in slots]
    base = [slot for slot in slots if slot not in UPPER_LAYERS]
    if mode == 'off' or not base or not upper:
        return False
    return len(upper) >= 2 or (mode == 'always' and 'top' in slots)


def units():
    """What one look takes from the daily budgets, which count FASHN credits."""
    try:
        return max(1, int(os.getenv('TRYON_FAL_UNITS', '1')))
    except ValueError:
        return 1


def _fit(frame_size, megapixels):
    """The frame's aspect at about `megapixels`, in multiples of 16."""
    width, height = frame_size
    scale = (megapixels * MEGAPIXEL / (width * height)) ** .5
    fitted = [max(16, int(side * scale) // 16 * 16) for side in (width, height)]
    return {'width': fitted[0], 'height': fitted[1]}


def output_size(model, frame_size=None):
    """An output with the photo's own aspect, so the identity lock maps it back 1:1."""
    if model.family in ('flux2', 'qwen'):
        return _fit(frame_size, 1) if frame_size else dict(CANVAS_1MP)
    if model.key == 'seedream-4':
        return _fit(frame_size, 2) if frame_size else dict(CANVAS_2MP)
    # Seedream 4.5 and 5.0 take only large custom sizes; their preset follows the photo.
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


def payload(model, person_url, garment_urls, prompt, seed, frame_size=None):
    safety = os.getenv('TRYON_FAL_SAFETY', 'true').strip().lower() not in ('0', 'false', 'no', 'off')
    if model.family == 'bria':
        # Bria has its own try-on instruction; ours is appended to it.
        body = {'person_image_url': person_url, 'garment_image_urls': list(garment_urls), 'seed': seed}
        if prompt:
            body['instruction'] = prompt
        return body
    body = {'prompt': prompt, 'image_urls': [person_url, *garment_urls], 'num_images': 1,
            'enable_safety_checker': safety}
    if model.seeded:
        body['seed'] = seed
    size = output_size(model, frame_size)
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


def privacy_headers():
    """By default fal keeps request payloads for 30 days and generated files
    forever at a public URL. Neither may happen to a user's photo: payloads are
    not stored, and the result expires shortly after the server fetched it."""
    lifetime = max(300, int(os.getenv('TRYON_FAL_MEDIA_TTL_SECONDS', '3600')))
    return {'X-Fal-Store-IO': '0',
            'X-Fal-Object-Lifecycle-Preference': json.dumps({'expiration_duration_seconds': lifetime})}


def _now():
    return time.monotonic()


def race_size():
    """How many identical requests one look starts with (TRYON_FAL_RACE, 1 to switch the race off)."""
    try:
        return min(3, max(1, int(os.getenv('TRYON_FAL_RACE', '2'))))
    except ValueError:
        return 2


def hedge_seconds():
    """When none of them is back yet, one more goes out (TRYON_FAL_HEDGE_SECONDS, 0 for never)."""
    try:
        return max(0., float(os.getenv('TRYON_FAL_HEDGE_SECONDS', '0')))
    except ValueError:
        return 0.


async def generate(client, model, person_url, garment_urls, prompt, seed, max_wait_seconds=None, poll_seconds=1.0,
                   frame_size=None):
    """One look from the first of several identical requests to come back.

    Seedream 5.0 Lite's own run time spread from 40 to 110 seconds on the same
    look (2026-10-06, queue time about 1 s): the spread is the model's, not
    ours. Two requests go out at once and the first image back is taken
    (54-70 s over six live looks). A third sent after 55 s never came first:
    it starts too late, so `hedge_seconds` is off by default. A started request
    cannot be cancelled at fal, so each one is paid: a look costs about twice.
    A request that fails does not end the race while another still runs.
    """
    count, hedge = race_size(), hedge_seconds()
    run = lambda: asyncio.ensure_future(_generate_one(client, model, person_url, garment_urls, prompt, seed, max_wait_seconds,
                                                      poll_seconds, frame_size))
    if count == 1 and not hedge:
        return await run()
    started = _now()
    pending = {run() for _ in range(count)}
    sent, hedged, failure = count, False, None
    try:
        while pending:
            timeout = None if hedged or not hedge else max(0., started + hedge - _now())
            done, pending = await asyncio.wait(pending, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
            if not done:
                hedged, sent = True, sent + 1
                pending.add(run())
                continue
            for task in done:
                result = task.result()
                if result.get('status') == 'succeeded':
                    result['costUsd'] = round((result.get('costUsd') or 0) * sent, 4)
                    result['raced'] = sent
                    return result
                # Out of balance or blocked: the others will be too, and are not waited for.
                if result.get('balance') or result.get('blocked'):
                    return result
                failure = failure or result
        return failure or {'error': 'fal returned no image'}
    finally:
        for task in pending:
            task.cancel()


async def _generate_one(client, model, person_url, garment_urls, prompt, seed, max_wait_seconds=None, poll_seconds=1.0,
                        frame_size=None):
    """Submit one look to the fal queue and wait for its image URL.

    Returns {'status': 'succeeded', 'outputUrl', 'costUsd', 'model'} or
    {'error', ...} with 'balance', 'blocked' or 'timeout' set when known.
    """
    max_wait_seconds = max_wait_seconds or int(os.getenv('TRYON_FAL_MAX_WAIT_SECONDS', '180'))
    # Time in fal's own queue is not the model being slow: it has its own, longer limit.
    max_queue_seconds = max(max_wait_seconds, int(os.getenv('TRYON_FAL_MAX_QUEUE_SECONDS', '600')))
    headers = {'Authorization': f'Key {api_key()}', 'Content-Type': 'application/json'}
    body = payload(model, person_url, garment_urls, prompt, seed, frame_size)
    try:
        submitted = await client.post(f'{QUEUE_URL}/{model.endpoint}', headers={**headers, **privacy_headers()}, json=body)
    except httpx.HTTPError as exc:
        return {'error': f'fal submit failed: {type(exc).__name__}'}
    if submitted.status_code >= 400:
        return _failure(submitted, 'submit')
    queued = submitted.json()
    status_url, response_url = queued.get('status_url'), queued.get('response_url')
    if not status_url or not response_url:
        return {'error': 'fal submit returned no status URL'}
    submitted_at = _now()
    started_at = None
    network_errors = 0
    # The last queue state tells a slow queue (IN_QUEUE) from a slow model (IN_PROGRESS).
    last_state = None
    while True:
        await asyncio.sleep(poll_seconds)
        now = _now()
        if (now > started_at + max_wait_seconds) if started_at is not None else (now > submitted_at + max_queue_seconds):
            cancel_url = queued.get('cancel_url')
            if cancel_url:
                try:
                    # Only a request still in the queue can be cancelled; a
                    # running one is billed either way.
                    await client.put(cancel_url, headers=headers)
                except httpx.HTTPError:
                    pass
            print(f'fal timeout: last status {last_state}', flush=True)
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
        last_state = state.get('status')
        if last_state == 'IN_PROGRESS' and started_at is None:
            started_at = now
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
    done_at = _now()
    # Waiting in fal's queue and the model's own work, apart: a slow look is one or the other.
    queue_seconds = round((started_at if started_at is not None else done_at) - submitted_at, 1)
    return {'status': 'succeeded', 'outputUrl': url, 'model': model.key,
            'costUsd': estimate_usd(model, len(garment_urls)), 'requestId': queued.get('request_id'),
            'queueSeconds': queue_seconds, 'runSeconds': round(done_at - submitted_at - queue_seconds, 1)}


def user_error(result):
    """The message a user sees for a failed call; details stay in the logs."""
    if result.get('balance'):
        return BALANCE_ERROR
    if result.get('blocked'):
        return BLOCKED_ERROR
    if result.get('timeout'):
        return TIMEOUT_ERROR
    return FAILED_ERROR
