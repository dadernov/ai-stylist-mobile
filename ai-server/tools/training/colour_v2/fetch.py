"""Scan Marqo/KAGL (MIT) rows, pick a warm-tone-heavy sample excluding the test sample, embed; images are not stored.
Run from this directory; features go to data/ (not committed)."""
import io, json, random, re, shutil, time, urllib.request, os
from collections import Counter
import numpy as np
from featlib import *
API = 'https://datasets-server.huggingface.co/rows?dataset=Marqo/KAGL&config=default&split=data&offset={}&length=100'
def get(u):
    for a in range(5):
        try:
            with urllib.request.urlopen(u, timeout=60) as r:
                return r.read()
        except Exception as e:
            if getattr(e, 'code', 0) == 403:
                return None  # an expired signed link: retrying cannot help
            print('retry', a, type(e).__name__, getattr(e, 'code', ''), flush=True); time.sleep(30 * (a + 1))
    return None
norm = lambda s: re.sub(r'\W+', ' ', (s or '').lower()).strip()
test = json.load(open('/root/ai-stylist-keep/catdata/colour/kagl_list.json'))
T_rows = {x['row'] for x in test}; T_ids = {x['item_ID'] for x in test}; T_txt = {norm(x['text']) for x in test}
SKIP = {None, '', 'Multi', 'Gold', 'Bronze', 'Copper', 'Metallic', 'NA'}
WARM = {'Khaki', 'Tan', 'Beige', 'Cream', 'Brown', 'Mustard', 'Olive', 'Rust', 'Peach', 'Nude', 'Mushroom Brown', 'Off White', 'Coffee Brown', 'Skin', 'Taupe', 'Camel', 'Caramel', 'Sand'}
scan = 'data/scan.jsonl'; done = set()
if os.path.exists(scan):
    done = {json.loads(l)['o'] for l in open(scan)}
with open(scan, 'a') as f:
    for off in range(0, 44434, 100):
        if off in done:
            continue
        b = get(API.format(off))
        if b is None:
            continue
        rows = [{'i': r['row_idx'], 'c': r['row']['baseColour'], 't': r['row']['text'], 'id': r['row']['item_ID'], 'c3': r['row']['category3'], 'c1': r['row']['category1'], 'u': r['row']['image']['src']} for r in json.loads(b)['rows']]
        f.write(json.dumps({'o': off, 'r': rows}) + '\n'); f.flush(); time.sleep(1.0)
pool = [r for l in open(scan) for r in json.loads(l)['r']]
print('scanned', len(pool), Counter(r['c'] for r in pool).most_common(60), flush=True)
pool = [r for r in pool if r['c'] not in SKIP and r['i'] not in T_rows and r['id'] not in T_ids and norm(r['t']) not in T_txt and r['c1'] in ('Apparel', 'Footwear', 'Accessories')]
random.Random(7).shuffle(pool)
take, cnt = [], Counter()
for r in pool:
    cap = 160 if r['c'] in WARM else 35
    if cnt[r['c']] < cap:
        cnt[r['c']] += 1; take.append(r)
print('selected', len(take), cnt.most_common(), flush=True)
E_, F_, G, M = [], [], [], []
out = 'data/train_feat.npz'; p = 'data/train_feat.part.npz'
if os.path.exists(p):
    z = np.load(p); E_, F_, G, M = list(z['subject']), list(z['full']), list(z['fg']), [str(x) for x in z['meta']]
have = {json.loads(m)['i'] for m in M}
def save(path):
    np.savez_compressed(path, subject=np.array(E_, np.float32), full=np.array(F_, np.float32), fg=np.array(G), meta=np.array(M))
fresh = {}
for r in take:
    if r['i'] in have:
        continue
    if shutil.disk_usage('/').free < 3.3e9:
        print('disk guard stop', flush=True); break
    b = get(r['u'])
    if b is None:
        page = r['i'] // 100 * 100  # the signed link expired: fresh ones for that page, kept for its other rows
        if page not in fresh:
            bb = get(API.format(page)); time.sleep(1.0)
            fresh[page] = {x['row_idx']: x['row']['image']['src'] for x in json.loads(bb)['rows']} if bb else {}
        if r['i'] in fresh[page]:
            b = get(fresh[page][r['i']])
    if b is None:
        continue
    try:
        s, f, g = feats(Image.open(io.BytesIO(b)))
    except Exception as e:
        print('bad', r['i'], type(e).__name__); continue
    E_.append(s); F_.append(f); G.append(g); M.append(json.dumps({k: r[k] for k in ('i', 'c', 't', 'id', 'c3', 'c1')}, ensure_ascii=False))
    time.sleep(.4)
    if len(M) % 50 == 0:
        save(p); print(len(M), flush=True)
save(out); print('done', len(M), flush=True)
