"""Label audit on non-test KAGL only: measured CIELAB per baseColour and the nearest app names."""
import json, sys, numpy as np
from collections import Counter, defaultdict
from PIL import Image
sys.path.insert(0, '../../..')
import garment_colour as gc
d = np.load('data/train_feat.npz'); meta = [json.loads(x) for x in d['meta']]
by = defaultdict(list)
for m, f in zip(meta, d['fg']):
    c = gc.main_colour(Image.fromarray(f, 'RGBA'))
    if c is not None: by[m['c']].append(c)
for k, v in sorted(by.items(), key=lambda x: -len(x[1])):
    v = np.array(v); near = Counter(gc.NAMES[int(np.linalg.norm(gc.REFERENCE_LAB - x, axis=1).argmin())] for x in v)
    print(f'{k:18} n={len(v):3} Lab med {np.round(np.median(v,0)).astype(int).tolist()} IQR-L {np.round(np.subtract(*np.percentile(v[:,0],[75,25]))):.0f}  ', ', '.join(f'{a}:{b}' for a, b in near.most_common(5)))
