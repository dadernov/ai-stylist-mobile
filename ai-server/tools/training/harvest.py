"""Pick labelled garment photos from a HF dataset shard by shard, embed them with the production encoder, keep
only embeddings, labels and small thumbnails (for auditing). Usage: harvest.py <source> [cap]"""
import io
import json
import math
import os
import random
import sys
import subprocess
import time
import urllib.request
from collections import Counter
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
from PIL import Image

import labels
from embedder import Embedder

HERE = Path(__file__).parent
SOURCES = {
    'polyvore': ('Marqo/polyvore', ['item_ID', 'category', 'text'], lambda r: labels.polyvore_any(r['category'], r['text'])),
    'fashion200k': ('Marqo/fashion200k', ['category1', 'category2', 'category3', 'text'],
                    lambda r: labels.fashion200k(r['category1'], r['category2'], r['category3'], r['text'])),
    'product': ('ashraq/fashion-product-images-small', ['articleType', 'productDisplayName'],
                lambda r: labels.product(r['articleType'], r['productDisplayName'])),
    'atlas': ('Marqo/atlas', ['sub-category', 'text'], lambda r: labels.atlas(r['sub-category'], r['text'])),
}


def shards(dataset):
    with urllib.request.urlopen(f'https://datasets-server.huggingface.co/parquet?dataset={dataset}', timeout=60) as response:
        return [f['url'] for f in json.load(response)['parquet_files']]


def download(url, path):
    for attempt in range(4):
        try:
            subprocess.run(['curl', '-sfL', '--retry', '3', '-m', '1800', '-o', str(path), url], check=True)
            return
        except Exception as error:
            print('retry', attempt, error, flush=True)
            time.sleep(10 * (attempt + 1))
    raise RuntimeError('download failed')


def thumb(image):
    small = image.convert('RGB')
    small.thumbnail((112, 112))
    buffer = io.BytesIO()
    small.save(buffer, 'JPEG', quality=70)
    return buffer.getvalue()


def main(source, cap):
    dataset, columns, label = SOURCES[source]
    urls = shards(dataset)
    out = HERE / 'emb'
    out.mkdir(exist_ok=True)
    per_shard = math.ceil(cap / len(urls) * 1.6)
    taken = Counter()
    embedder = Embedder()
    rng = random.Random(7)
    for number, url in enumerate(urls):
        target = out / f'{source}_{number}.npz'
        if target.exists():
            data = np.load(target, allow_pickle=True)
            taken.update(data['category'].tolist())
            continue
        path = HERE / 'shard.parquet'
        started = time.time()
        download(url, path)
        file = pq.ParquetFile(path)
        rows = file.read(columns=columns).to_pylist()
        choice = {}
        order = list(range(len(rows)))
        rng.shuffle(order)
        here = Counter()
        for index in order:
            category = label(rows[index])
            if category and here[category] < per_shard and taken[category] + here[category] < cap:
                choice[index] = category
                here[category] += 1
        print(f'{source} shard {number}: {len(rows)} rows, chose {len(choice)} in {time.time() - started:.0f}s', flush=True)
        vectors, views, cats, texts, thumbs = [], [], [], [], []
        batch, meta = [], []
        offset = 0
        for group in range(file.num_row_groups):
            table = file.read_row_group(group, columns=['image'])
            count = table.num_rows
            wanted = [i for i in range(offset, offset + count) if i in choice]
            if wanted:
                column = table.column('image')
                for i in wanted:
                    cell = column[i - offset].as_py()
                    try:
                        image = Image.open(io.BytesIO(cell['bytes'])).convert('RGB')
                    except Exception:
                        continue
                    batch.append(embedder.fit(image))
                    meta.append((choice[i], json.dumps({k: rows[i][k] for k in columns}, ensure_ascii=False)[:300], thumb(image)))
                    if len(batch) == 8:
                        vectors.append(embedder.embed(batch)); views.extend(meta); batch, meta = [], []
            offset += count
        if batch:
            vectors.append(embedder.embed(batch)); views.extend(meta)
        os.remove(path)
        if views:
            np.savez(target, vector=np.concatenate(vectors).astype(np.float16), category=np.array([v[0] for v in views]),
                     text=np.array([v[1] for v in views]), thumb=np.array([v[2] for v in views], dtype=object))
        taken.update(v[0] for v in views)
        print(f'{source} shard {number}: embedded {len(views)} in {time.time() - started:.0f}s; total {sum(taken.values())}', flush=True)
    print(source, 'done', dict(sorted(taken.items(), key=lambda x: -x[1])), flush=True)


if __name__ == '__main__':
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 250)
