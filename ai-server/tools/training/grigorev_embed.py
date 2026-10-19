"""Embed the real-life photos (Grigorev clothing dataset, CC0): both production views, padded and centre-cropped."""
import csv
import numpy as np
from pathlib import Path
from PIL import Image, ImageOps
from embedder import Embedder

HERE = Path(__file__).parent
rows = [r for r in csv.DictReader(open(HERE / 'grigorev/images.csv')) if r['label'] not in ('Not sure', 'Skip', 'Other')]
e = Embedder()
pad, crop, keep = [], [], []
batch = []
def flush():
    global batch
    if not batch: return
    a = e.embed([e.fit(i) for i in batch]); b = e.embed([e.full(i) for i in batch])
    pad.append(a); crop.append(b); batch = []
for n, r in enumerate(rows):
    path = HERE / 'grigorev/images' / (r['image'] + '.jpg')
    try:
        image = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    except Exception:
        continue
    batch.append(image); keep.append(r)
    if len(batch) == 8: flush()
    if n % 500 == 0: print('grigorev', n, len(rows), flush=True)
flush()
np.savez(HERE / 'emb/grigorev.npz', pad=np.concatenate(pad).astype(np.float16), crop=np.concatenate(crop).astype(np.float16),
         label=np.array([r['label'] for r in keep]), sender=np.array([r['sender_id'] for r in keep]),
         image=np.array([r['image'] for r in keep]), kids=np.array([r['kids'] for r in keep]))
print('grigorev done', len(keep), flush=True)
