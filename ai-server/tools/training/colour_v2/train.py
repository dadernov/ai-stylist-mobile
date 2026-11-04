"""Fine-tune the shipped head (its 65k training vectors are gone) on corrected KAGL labels; L2 pulls towards the shipped W.
Selection on DEV only. train.py select <base.npz> | train.py final <base.npz> <lambda> <out.npz>"""
import hashlib, json, os, re, sys
from collections import Counter
import numpy as np
from PIL import Image
os.environ['OMP_NUM_THREADS'] = '1'
sys.path.insert(0, '../../..')
import garment_colour as gc
from mapping import KAGL_OLD, KAGL_AUDITED, MEASURED, MAX_DE
SHIPPED = sys.argv[2]
IDX = {n: i for i, n in enumerate(gc.NAMES)}
d = np.load('data/train_feat.npz'); meta = [json.loads(x) for x in d['meta']]
X = d['subject'] + d['full']; X = (X / np.linalg.norm(X, axis=1, keepdims=True)).astype(np.float32)
y = np.full(len(meta), -1); drop = Counter(); got = Counter()
for i, m in enumerate(meta):
    c = m['c']
    if c not in KAGL_OLD:
        drop[c] += 1; continue
    if c in MEASURED:
        lab = gc.main_colour(Image.fromarray(d['fg'][i], 'RGBA')); allowed = sorted(MEASURED[c])
        de = np.array([np.linalg.norm(gc.REFERENCE_LAB[IDX[n]] - lab) for n in allowed]) if lab is not None else np.array([1e9])
        if de.min() > MAX_DE:
            drop[c] += 1; continue
        y[i] = IDX[allowed[int(de.argmin())]]; got[c, allowed[int(de.argmin())]] += 1
    else:
        y[i] = IDX[KAGL_OLD[c][0]]
norm = lambda s: re.sub(r'\W+', ' ', (s or '').lower()).strip()
is_dev = np.array([int(hashlib.md5(norm(m['t']).encode()).hexdigest(), 16) % 5 == 0 for m in meta]); keep = y >= 0
base = np.load(SHIPPED); W0 = base['W'].astype(np.float32); b0 = base['b'].astype(np.float32)


def fit(tr, lam, epochs=60, lr=.1):
    Xt, yt = X[tr], y[tr]; c = Counter(yt.tolist()); w = np.array([1 / np.sqrt(c[i]) for i in yt], np.float32); w /= w.sum()
    W, b = W0.copy(), b0.copy(); ms = [np.zeros_like(a) for a in (W, W, b, b)]; step = 0; rng = np.random.default_rng(0)
    for _ in range(epochs):
        order = rng.permutation(len(yt))
        for s in range(0, len(yt), 128):
            i = order[s:s + 128]; z = Xt[i] @ W + b; z -= z.max(1, keepdims=True); p = np.exp(z); p /= p.sum(1, keepdims=True)
            p[np.arange(len(i)), yt[i]] -= 1; p *= (w[i] / w[i].sum())[:, None]
            gW = Xt[i].T @ p + lam * (W - W0); gb = p.sum(0) + lam * (b - b0); step += 1
            for P, g, m, v in ((W, gW, ms[0], ms[1]), (b, gb, ms[2], ms[3])):
                m[:] = .9 * m + .1 * g; v[:] = .999 * v + .001 * g * g
                P -= lr * (m / (1 - .9 ** step)) / (np.sqrt(v / (1 - .999 ** step)) + 1e-8)
    return W, b


def save(path, W, b):
    np.savez(path, W=W.astype(np.float16), b=b.astype(np.float32), names=np.array(gc.NAMES))


def devscore(path, veto):
    from heldout import set_veto, names
    os.environ['AI_COLOUR_HEAD'] = os.path.abspath(path); set_veto(veto)
    dv = np.flatnonzero(is_dev & keep); kn = names(X[dv], d['fg'][dv])
    warm = {'Khaki', 'Tan', 'Beige', 'Cream', 'Brown', 'Mustard', 'Olive', 'Rust', 'Peach', 'Off White', 'Skin', 'Nude', 'Mushroom Brown'}
    ok = np.array([n in KAGL_AUDITED[meta[i]['c']][1] for n, i in zip(kn, dv)]); w = np.array([meta[i]['c'] in warm for i in dv])
    s = np.load('data/dev_swatch.npz'); sn = names(s['emb'], s['fg']); tr = [set(t.split(',')) for t in s['truth']]; sok = np.array([n in t for n, t in zip(sn, tr)])
    return ok[w].mean(), ok[~w].mean(), sok.mean()


if sys.argv[1] == 'select':
    print('kept', keep.sum(), 'dev', (is_dev & keep).sum(), 'dropped', drop.most_common()); print('measured labels', sorted(got.items(), key=lambda x: (x[0][0], -x[1])))
    print('shipped warmK/otherK/devSwatch', {v: tuple(np.round(devscore(SHIPPED, v), 3).tolist()) for v in ('on', 'soft', 'off')}, flush=True)
    for lam in (1e-1, 3e-2, 1e-2, 3e-3, 1e-3, 1e-4):
        W, b = fit(keep & ~is_dev, lam); p = f'data/c_{lam}.npz'; save(p, W, b)
        print('lam', lam, 'dW', round(float(np.linalg.norm(W - W0) / np.linalg.norm(W0)), 3), {v: tuple(np.round(devscore(p, v), 3).tolist()) for v in ('on', 'soft', 'off')}, flush=True)
else:
    W, b = fit(keep, float(sys.argv[3])); save(sys.argv[4], W, b); print('wrote', sys.argv[4])
