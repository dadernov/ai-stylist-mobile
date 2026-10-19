"""Train a residual linear head over the production SigLIP embeddings and compare it with zero-shot.

logits = 100 * x·T  (the zero-shot text features, as today)  +  x·W + b  (learned, L2-pulled to zero)
A category with few examples keeps close to the zero-shot answer; one with many learns from them.
"""
import glob
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, '/root/ai-stylist-mobile/ai-server')
HERE = Path(__file__).parent
SRC = open('/root/ai-stylist-mobile/ai-server/clothing_analysis.py').read()
ns = {}
exec(SRC[SRC.index('CATEGORIES = ['):SRC.index('PATTERNS = [')], ns)
CATS = [c[0] for c in ns['CATEGORIES']]
SECTION = {c[0]: c[1] for c in ns['CATEGORIES']}
INDEX = {c: i for i, c in enumerate(CATS)}
T = np.load('/root/ai-stylist-mobile/ai-server/models/clip/text_features.npy')[:len(CATS)].astype(np.float32)

OUTER = {c for c in CATS if SECTION[c] == 'Верхняя одежда'}
SHOES = {c for c in CATS if SECTION[c] == 'Обувь'}
# Real-life photo labels -> the categories that count as right.
GROUPS = {'T-Shirt': {'Футболка'}, 'Polo': {'Поло'}, 'Longsleeve': {'Лонгслив', 'Свитер', 'Свитшот', 'Водолазка'},
          'Shirt': {'Рубашка'}, 'Blouse': {'Блуза', 'Рубашка'}, 'Top': {'Топ', 'Майка'}, 'Undershirt': {'Майка', 'Топ'},
          'Hoodie': {'Худи'}, 'Dress': {'Платье', 'Сарафан'}, 'Skirt': {'Юбка'}, 'Shorts': {'Шорты'},
          'Pants': {'Брюки', 'Джинсы', 'Джоггеры', 'Леггинсы'}, 'Blazer': {'Пиджак'}, 'Outwear': OUTER, 'Shoes': SHOES,
          'Hat': {'Шапка', 'Кепка', 'Шляпа'}, 'Body': {'Топ', 'Майка', 'Футболка', 'Лонгслив'}}
# Real-life labels clear enough to learn from.
EXACT = {'T-Shirt': 'Футболка', 'Polo': 'Поло', 'Shirt': 'Рубашка', 'Hoodie': 'Худи', 'Skirt': 'Юбка', 'Shorts': 'Шорты', 'Blazer': 'Пиджак'}


def load_hf():
    X, y, src = [], [], []
    for path in sorted(glob.glob(str(HERE / 'emb/*_*.npz'))):
        d = np.load(path, allow_pickle=True)
        keep = [i for i, c in enumerate(d['category']) if c in INDEX]
        X.append(d['vector'][keep].astype(np.float32)); y += [INDEX[c] for c in d['category'][keep]]
        src += [Path(path).stem.split('_')[0]] * len(keep)
    return np.concatenate(X), np.array(y), np.array(src)


def softmax(z):
    z = z - z.max(1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(1, keepdims=True)


def train(X, M, weights, l2=1e-3, epochs=60, lr=3e-3, scale=100.0):
    """M: n×k mask of the categories that count as right for each example (one for a sure label, a few for a group)."""
    n, d = X.shape
    k = len(CATS)
    W = np.zeros((d, k), np.float32); b = np.zeros(k, np.float32)
    mW, vW, mb, vb = [np.zeros_like(a) for a in (W, W, b, b)]
    base = scale * X @ T.T
    rng = np.random.default_rng(0)
    step = 0
    for epoch in range(epochs):
        order = rng.permutation(n)
        for start in range(0, n, 256):
            idx = order[start:start + 256]
            p = softmax(base[idx] + X[idx] @ W + b)
            good = p * M[idx]
            p = p - good / np.maximum(good.sum(1, keepdims=True), 1e-12)
            p *= weights[idx, None] / weights[idx].sum()
            gW = X[idx].T @ p + l2 * W
            gb = p.sum(0)
            step += 1
            for param, g, m, v in ((W, gW, mW, vW), (b, gb, mb, vb)):
                m[:] = .9 * m + .1 * g; v[:] = .999 * v + .001 * g * g
                param -= lr * (m / (1 - .9 ** step)) / (np.sqrt(v / (1 - .999 ** step)) + 1e-8)
    return W, b


def predict(X, W=None, b=None):
    z = 100 * X @ T.T
    if W is not None:
        z = z + X @ W + b
    return z


def report(name, z, truth_sets):
    top = z.argmax(1)
    ok = [CATS[t] in s for t, s in zip(top, truth_sets)]
    return f'{name}: {np.mean(ok) * 100:.1f}% ({sum(ok)}/{len(ok)})'


def main():
    X, y, src = load_hf()
    rng = np.random.default_rng(1)
    test = rng.random(len(y)) < .2
    print('HF examples', len(y), Counter(src.tolist()))
    print('per category', sorted(Counter(CATS[i] for i in y).items(), key=lambda x: x[1]))

    g = np.load(HERE / 'emb/grigorev.npz', allow_pickle=True)
    gX = ((g['pad'].astype(np.float32) + g['crop'].astype(np.float32)) / 2)
    gX /= np.linalg.norm(gX, axis=1, keepdims=True)
    senders = sorted(set(g['sender'].tolist()))
    test_senders = set(senders[::2])
    g_test = np.array([s in test_senders for s in g['sender']])
    g_train = ~g_test & np.array([l in GROUPS for l in g['label']])

    Xtr = np.concatenate([X[~test], gX[g_train]])
    k = len(CATS)
    M = np.zeros((len(Xtr), k), np.float32)
    M[np.arange((~test).sum()), y[~test]] = 1
    for row, label in enumerate(g['label'][g_train], start=(~test).sum()):
        for c in GROUPS[label]:
            M[row, INDEX[c]] = 1
    key = [tuple(np.flatnonzero(m)) for m in M]
    counts = Counter(key)
    real = np.concatenate([np.zeros((~test).sum()), np.ones(g_train.sum())])
    weights = np.array([1 / np.sqrt(counts[c]) for c in key], np.float32) * np.where(real > 0, float(__import__('os').environ.get('REAL_W', '2')), 1.0)

    results = {}
    for l2 in [float(a) for a in (sys.argv[1:] or ['3e-3'])]:
        W, b = train(Xtr, M, weights, l2=l2)
        results[l2] = (W, b)
        print(f'\n== l2={l2}')
        hf_sets = [{CATS[i]} for i in y[test]]
        print(report('  HF held-out  zero-shot', predict(X[test]), hf_sets))
        print(report('  HF held-out  trained  ', predict(X[test], W, b), hf_sets))
        gl = g['label'][g_test]
        sets = [GROUPS[l] for l in gl]
        print(report('  Real photos  zero-shot', predict(gX[g_test]), sets))
        print(report('  Real photos  trained  ', predict(gX[g_test], W, b), sets))
        z0, z1 = predict(gX[g_test]).argmax(1), predict(gX[g_test], W, b).argmax(1)
        per = defaultdict(lambda: [0, 0, 0])
        for label, a, c, s in zip(gl, z0, z1, sets):
            per[label][0] += 1; per[label][1] += CATS[a] in s; per[label][2] += CATS[c] in s
        print('   ', '; '.join(f'{k} {v[1] * 100 // v[0]}→{v[2] * 100 // v[0]}% n={v[0]}' for k, v in sorted(per.items(), key=lambda x: -x[1][0])))
    np.savez(HERE / 'head.npz', **{f'W_{k}': v[0] for k, v in results.items()}, **{f'b_{k}': v[1] for k, v in results.items()})


if __name__ == '__main__':
    main()
