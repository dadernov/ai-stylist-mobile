"""Outfit compatibility learned from Polyvore outfits (items worn together by real people), over the production
SigLIP embeddings.

Each item maps to a small style space z = normalise(P x + E[section]); an outfit's harmony is how close its items
are there. Trained like the fill-in-the-blank task: from the rest of an outfit, pick its real item among others of
the same section. Evaluated on held-out outfits: FITB accuracy (4 candidates; chance 25%) and real vs. shuffled
outfit AUC.
"""
import glob
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
SRC = open('/root/ai-stylist-mobile/ai-server/clothing_analysis.py').read()
ns = {}
exec(SRC[SRC.index('CATEGORIES = ['):SRC.index('PATTERNS = [')], ns)
SECTION_OF = {c[0]: c[1] for c in ns['CATEGORIES']}
SECTIONS = ['Верх', 'Низ', 'Верхняя одежда', 'Обувь', 'Сумки', 'Аксессуары']
ONE_PIECE = {'Платье', 'Сарафан', 'Комбинезон'}


def slot(category):
    """The role in an outfit: one-pieces apart from tops."""
    if category.startswith('?'):
        return category[1:]
    return 'Цельное' if category in ONE_PIECE else SECTION_OF[category]


SLOTS = SECTIONS + ['Цельное']


def load_outfits():
    vectors, slots, outfit_of = [], [], []
    for path in sorted(glob.glob(str(HERE / 'emb/polyvore_*.npz'))):
        d = np.load(path, allow_pickle=True)
        for vector, category, text in zip(d['vector'], d['category'], d['text']):
            try:
                item_id = json.loads(text)['item_ID']
            except (ValueError, KeyError):
                continue
            vectors.append(vector.astype(np.float32)); slots.append(SLOTS.index(slot(category)))
            outfit_of.append(item_id.rsplit('_', 1)[0])
    vectors, slots = np.array(vectors), np.array(slots)
    outfits = defaultdict(list)
    for index, outfit in enumerate(outfit_of):
        outfits[outfit].append(index)
    # An outfit worth learning from: three pieces or more, a top or one-piece among them, no slot twice except tops.
    keep = []
    for members in outfits.values():
        s = [slots[i] for i in members]
        if len(members) >= 3 and (SLOTS.index('Верх') in s or SLOTS.index('Цельное') in s) \
                and all(s.count(k) == 1 for k in set(s) if SLOTS[k] not in ('Верх', 'Аксессуары')):
            keep.append(members)
    return vectors, slots, keep


def normalise(a):
    return a / np.maximum(np.linalg.norm(a, axis=-1, keepdims=True), 1e-8)


class Model:
    def __init__(self, d=768, k=64, seed=0):
        rng = np.random.default_rng(seed)
        self.P = (rng.standard_normal((d, k)) / np.sqrt(d)).astype(np.float32)
        self.E = np.zeros((len(SLOTS), k), np.float32)
        self.t = np.float32(10.0)

    def embed(self, x, s):
        return normalise(x @ self.P + self.E[s])


def fitb_batch(vectors, slots, outfits, by_slot, rng, negatives=3):
    """(context items, answer, candidates) for one blank per outfit."""
    tasks = []
    for members in outfits:
        answer = members[rng.integers(len(members))]
        rest = [m for m in members if m != answer]
        pool = by_slot[slots[answer]]
        candidates = [answer] + list(rng.choice(pool, negatives))
        tasks.append((rest, candidates))
    return tasks


def score(model, vectors, slots, rest, candidates):
    context = model.embed(vectors[rest], slots[rest]).mean(0)
    return model.embed(vectors[candidates], slots[candidates]) @ context


def evaluate(model, vectors, slots, outfits, by_slot, raw=False, seed=5):
    rng = np.random.default_rng(seed)
    hits = 0
    tasks = fitb_batch(vectors, slots, outfits, by_slot, rng)
    for rest, candidates in tasks:
        if raw:
            s = normalise(vectors[candidates]) @ normalise(vectors[rest].mean(0))
        else:
            s = score(model, vectors, slots, rest, candidates)
        hits += int(np.argmax(s) == 0)
    # Real outfits against the same outfits with every piece but the first swapped for a random one of its slot.
    real, fake = [], []
    for members in outfits:
        swapped = [members[0]] + [rng.choice(by_slot[slots[m]]) for m in members[1:]]
        for group, sink in ((members, real), (swapped, fake)):
            z = normalise(vectors[group]) if raw else model.embed(vectors[group], slots[group])
            g = z @ z.T
            sink.append((g.sum() - len(group)) / (len(group) * (len(group) - 1)))
    real, fake = np.array(real), np.array(fake)
    auc = (real[:, None] > fake[None, :]).mean()
    return hits / len(tasks), auc


def train(model, vectors, slots, outfits, by_slot, epochs=8, lr=2e-3, negatives=15):
    rng = np.random.default_rng(1)
    params = [model.P, model.E]
    m = [np.zeros_like(p) for p in params]; v = [np.zeros_like(p) for p in params]
    step = 0
    for epoch in range(epochs):
        tasks = fitb_batch(vectors, slots, outfits, by_slot, rng, negatives)
        rng.shuffle(tasks)
        loss_sum = 0
        for start in range(0, len(tasks), 64):
            gP = np.zeros_like(model.P); gE = np.zeros_like(model.E)
            for rest, candidates in tasks[start:start + 64]:
                # forward
                xr, sr = vectors[rest], slots[rest]
                xc, sc = vectors[candidates], slots[candidates]
                hr = xr @ model.P + model.E[sr]; nr = np.linalg.norm(hr, axis=1, keepdims=True); zr = hr / nr
                hc = xc @ model.P + model.E[sc]; nc = np.linalg.norm(hc, axis=1, keepdims=True); zc = hc / nc
                ctx = zr.mean(0)
                logits = model.t * (zc @ ctx)
                p = np.exp(logits - logits.max()); p /= p.sum()
                loss_sum -= np.log(p[0] + 1e-9)
                dl = p.copy(); dl[0] -= 1; dl *= model.t
                dzc = dl[:, None] * ctx[None, :]
                dctx = (dl[:, None] * zc).sum(0)
                dzr = np.repeat(dctx[None, :] / len(rest), len(rest), 0)
                for z, n, h, dz, x, s in ((zc, nc, hc, dzc, xc, sc), (zr, nr, hr, dzr, xr, sr)):
                    dh = (dz - z * (dz * z).sum(1, keepdims=True)) / n
                    gP += x.T @ dh
                    np.add.at(gE, s, dh)
            step += 1
            for i, g in enumerate((gP / 64, gE / 64)):
                m[i] = .9 * m[i] + .1 * g; v[i] = .999 * v[i] + .001 * g * g
                params[i] -= lr * (m[i] / (1 - .9 ** step)) / (np.sqrt(v[i] / (1 - .999 ** step)) + 1e-8)
        print(f'epoch {epoch}: loss {loss_sum / len(tasks):.3f}', flush=True)


def main():
    vectors, slots, outfits = load_outfits()
    print('items', len(vectors), 'outfits', len(outfits), flush=True)
    rng = np.random.default_rng(0)
    order = rng.permutation(len(outfits))
    test = [outfits[i] for i in order[:len(outfits) // 10]]
    train_set = [outfits[i] for i in order[len(outfits) // 10:]]
    test_items = {i for o in test for i in o}
    by_slot_train = defaultdict(list); by_slot_test = defaultdict(list)
    for o in train_set:
        for i in o: by_slot_train[slots[i]].append(i)
    for o in test:
        for i in o: by_slot_test[slots[i]].append(i)
    by_slot_train = {k: np.array(v) for k, v in by_slot_train.items()}
    by_slot_test = {k: np.array(v) for k, v in by_slot_test.items()}
    model = Model()
    print('raw SigLIP  FITB %.3f  AUC %.3f' % evaluate(model, vectors, slots, test, by_slot_test, raw=True), flush=True)
    train(model, vectors, slots, train_set, by_slot_train, epochs=int(sys.argv[1]) if len(sys.argv) > 1 else 8)
    print('trained     FITB %.3f  AUC %.3f' % evaluate(model, vectors, slots, test, by_slot_test), flush=True)
    np.savez(HERE / 'compat.npz', P=model.P, E=model.E, slots=np.array(SLOTS))


if __name__ == '__main__':
    main()
