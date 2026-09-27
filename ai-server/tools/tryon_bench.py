"""Compare the fal editors on the same looks, side by side, before switching.

Run on the server from ai-server/:

    FAL_KEY=... .venv/bin/python tools/tryon_bench.py CASES OUT [--models a,b] [--lock]

CASES holds one folder per look: person.jpg plus any of top, bottom, outer,
shoes (.jpg, .jpeg, .png or .webp) and an optional case.json such as
{"top_category": "Футболка", "outer_category": "Тренч", "tuck": "auto"}.
OUT receives every frame, results.json and index.html to compare by eye.

Each look is prepared and prompted exactly as the app's request would be
(app._run_fal_look). --lock also applies the identity lock the app shows the
user (face and background from the photo); it loads the face and parsing
models, about 0.5 GB of memory.

The photos go to fal and the model vendors: use your own or stock photos,
never other users' photos.
"""
import argparse
import asyncio
import base64
import html
import json
import os
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app  # noqa: E402
import fal_tryon  # noqa: E402
import tryon_policy  # noqa: E402

SLOTS = ('top', 'bottom', 'outer', 'shoes')
EXTENSIONS = ('.jpg', '.jpeg', '.png', '.webp')
RUB_PER_USD = 84.3


def _find(folder, name):
    for extension in EXTENSIONS:
        path = folder / f'{name}{extension}'
        if path.exists():
            return path
    return None


def load_case(folder):
    person = _find(folder, 'person')
    if person is None:
        return None
    garments = {}
    for slot in SLOTS:
        path = _find(folder, slot)
        if path:
            garments[slot] = (path.read_bytes(), 'image/png' if path.suffix == '.png' else 'image/jpeg')
    meta_path = folder / 'case.json'
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    return {'name': folder.name, 'person': person.read_bytes(), 'garments': garments,
            'top_category': meta.get('top_category', ''), 'outer_category': meta.get('outer_category', ''),
            'tuck': meta.get('tuck', 'auto'), 'inputs': {'person': person, **{slot: _find(folder, slot) for slot in garments}}}


def _save_data_url(data_url, path):
    path.write_bytes(base64.b64decode(data_url.split(',', 1)[1]))


async def run_one(client, case, model, out, lock):
    record = {'case': case['name'], 'model': model.key, 'usd': fal_tryon.estimate_usd(model, len(case['garments']))}
    if len(case['garments']) > model.max_garments:
        record['skipped'] = f'takes at most {model.max_garments} garments'
        return record
    started = time.monotonic()
    result = await app._run_fal_look(client, model, case['person'], case['garments'], case['top_category'],
                                     case['outer_category'], case['tuck'], seed=42)
    record['seconds'] = round(time.monotonic() - started, 1)
    if result.get('error'):
        record['error'] = result['error'] + (f": {result['detail'][:200]}" if result.get('detail') else '')
        return record
    raw = out / f'{model.key}.png'
    response = await client.get(result['outputUrl'])
    response.raise_for_status()
    raw.write_bytes(response.content)
    record['raw'] = raw.name
    if lock:
        changed = sorted(tryon_policy.composite_slot(slot, case['outer_category'] if slot == 'outer' else case['top_category'])
                         for slot in case['garments'])
        try:
            prepared = await asyncio.to_thread(app._prepare_identity_source, case['person'])
            frame = await asyncio.to_thread(app._working_image, response.content)
            locked = await app._face_locked_output_url(client, case['person'], result['outputUrl'], changed, prepared,
                                                       generated_image=frame)
            _save_data_url(locked, out / f'{model.key}-locked.png')
            record['locked'] = f'{model.key}-locked.png'
        except app.AlignmentRejected:
            record['lock'] = 'rejected: the person moved, the app would show the raw frame with a warning'
        except ValueError as exc:
            record['lock'] = f'failed: {exc}'
    return record


def write_page(out, cases, models, records):
    by_key = {(record['case'], record['model']): record for record in records}
    rows = []
    for case in cases:
        folder = out / case['name']
        inputs = ''.join(f'<figure><img src="{html.escape(case["name"])}/input-{name}{path.suffix}"><figcaption>{name}</figcaption></figure>'
                         for name, path in case['inputs'].items())
        cells = []
        for model in models:
            record = by_key.get((case['name'], model.key), {})
            images = ''.join(f'<img src="{html.escape(case["name"])}/{record[kind]}">' for kind in ('raw', 'locked') if record.get(kind))
            note = record.get('skipped') or record.get('error') or record.get('lock') or ''
            price = f'${record.get("usd", 0):.3f} ≈ {record.get("usd", 0) * RUB_PER_USD:.1f} ₽'
            timing = f' · {record["seconds"]} s' if 'seconds' in record else ''
            cells.append(f'<td><b>{model.key}</b><br><small>{price}{timing}</small><div class="pair">{images}</div>'
                         f'<small class="note">{html.escape(note)}</small></td>')
        rows.append(f'<tr><td class="inputs">{inputs}</td>{"".join(cells)}</tr>')
        for name, path in case['inputs'].items():
            (folder / f'input-{name}{path.suffix}').write_bytes(path.read_bytes())
    page = f'''<!doctype html><meta charset="utf-8"><title>Try-on comparison</title>
<style>body{{font:14px system-ui;margin:16px}}table{{border-collapse:collapse}}td{{vertical-align:top;border:1px solid #ddd;padding:8px}}
img{{height:420px;margin:4px}}.inputs img{{height:120px}}figure{{margin:0;display:inline-block;text-align:center}}.note{{color:#a33}}</style>
<p>Left of each pair: the editor's frame. Right: what the app shows after the identity lock.</p>
<table>{"".join(rows)}</table>'''
    (out / 'index.html').write_text(page, encoding='utf-8')


async def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('cases', type=Path)
    parser.add_argument('out', type=Path)
    parser.add_argument('--models', default=','.join(fal_tryon.MODELS))
    parser.add_argument('--lock', action='store_true')
    args = parser.parse_args()
    if not fal_tryon.api_key():
        sys.exit('Set FAL_KEY.')
    models = [fal_tryon.MODELS[key.strip()] for key in args.models.split(',') if key.strip()]
    cases = [case for case in (load_case(folder) for folder in sorted(args.cases.iterdir()) if folder.is_dir()) if case]
    if not cases:
        sys.exit(f'No cases with a person photo in {args.cases}.')
    records = []
    async with httpx.AsyncClient(timeout=120.0, trust_env=False) as client:
        for case in cases:
            folder = args.out / case['name']
            folder.mkdir(parents=True, exist_ok=True)
            for model in models:
                record = await run_one(client, case, model, folder, args.lock)
                print(json.dumps(record, ensure_ascii=False), flush=True)
                records.append(record)
    (args.out / 'results.json').write_text(json.dumps(records, ensure_ascii=False, indent=1), encoding='utf-8')
    write_page(args.out, cases, models, records)
    spent = sum(record['usd'] for record in records if 'raw' in record or 'error' in record)
    print(f'{len(records)} runs, about ${spent:.2f} ({spent * RUB_PER_USD:.0f} RUB). Open {args.out / "index.html"}')


if __name__ == '__main__':
    asyncio.run(main())
