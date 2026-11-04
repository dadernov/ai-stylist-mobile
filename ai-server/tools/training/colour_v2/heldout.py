"""The frozen test of PROTOCOL.md: heldout.py <head.npz> <on|off|soft> [out.json]. Truth sets as in the session's ev.py."""
import json, os, sys, warnings
from collections import Counter
import numpy as np
from PIL import Image
warnings.filterwarnings('ignore')
os.environ['OMP_NUM_THREADS'] = '1'
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', '..'))
import garment_colour as gc
from mapping import KAGL_OLD, KAGL_AUDITED
C = '/root/ai-stylist-keep/catdata/colour/'
SP = '/tmp/claude-0/-root/6094b43c-07b7-4694-91b7-5951b3c5be38/scratchpad/'
COLOURS = {
    'caramel': {'Карамельный'}, 'caramel2': {'Карамельный'}, 'caramel_dk': {'Карамельный', 'Коричневый'}, 'camel': {'Карамельный'},
    'tan': {'Карамельный', 'Песочный'}, 'cognac': {'Коричневый', 'Карамельный', 'Терракотовый'}, 'terracotta': {'Терракотовый', 'Оранжевый'},
    'rust': {'Терракотовый', 'Коричневый', 'Оранжевый'}, 'mustard': {'Горчичный'}, 'mustard2': {'Горчичный'}, 'khaki': {'Хаки', 'Оливковый'},
    'khaki2': {'Хаки', 'Оливковый'}, 'olive': {'Оливковый', 'Хаки'}, 'olive_dk': {'Оливковый', 'Хаки'}, 'greygreen': {'Хаки', 'Серый', 'Оливковый'},
    'sage': {'Хаки', 'Оливковый', 'Серый', 'Зеленый'}, 'sand': {'Песочный', 'Бежевый'}, 'brown': {'Коричневый'}, 'beige': {'Бежевый', 'Песочный', 'Кремовый'},
    'grey': {'Серый'}, 'navy': {'Синий деним', 'Синий', 'Черный', 'Графит'}, 'red': {'Красный'}, 'pink': {'Пудровый', 'Розовый'}, 'green': {'Зеленый'}}
WARM_SW = {'caramel', 'caramel2', 'caramel_dk', 'camel', 'tan', 'cognac', 'terracotta', 'rust', 'brown', 'sand'}
OTHER_SW = {'mustard', 'mustard2', 'khaki', 'khaki2', 'olive', 'olive_dk', 'beige'}
WARM_K = {'Khaki', 'Tan', 'Beige', 'Cream', 'Brown', 'Mustard', 'Olive', 'Rust', 'Peach', 'Nude', 'Mushroom Brown', 'Off White'}
VETOES = {'on': {}, 'off': {'VETO_MIN_CHROMA': 1e9}, 'soft': {'VETO_HUE_MARGIN': 18.0, 'VETO_LIGHTNESS_GAP': 20.0, 'VETO_HEAD_CERTAIN': 0.99}}


def set_veto(kind):
    defaults = {'VETO_MIN_CHROMA': 10.0, 'VETO_HUE_MARGIN': 12.0, 'VETO_LIGHTNESS_GAP': 15.0, 'VETO_HEAD_CERTAIN': 0.999}
    for k, v in {**defaults, **VETOES[kind]}.items():
        setattr(gc, k, v)


def names(emb, fg):
    return [gc.name_colour(e, Image.fromarray(f, 'RGBA'))['colorName'] for e, f in zip(emb, fg)]


def real_truth(meta):
    idx = json.load(open(C + 'colour_real_idx.json')); lab = json.load(open(C + 'colour_real_labels.json'))
    truth = {i: set(lab[str(k)]) for k, i in enumerate(idx) if lab[str(k)]}
    QA = [('коричнев', ['Коричневый', 'Карамельный']), ('чёрн', ['Черный', 'Графит']), ('зелён', ['Зеленый', 'Оливковый', 'Хаки']),
          ('жёлт', ['Желтый', 'Горчичный']), ('сиренев', ['Лавандовый', 'Фиолетовый']), ('бел', ['Белый', 'Молочный']),
          ('синие', ['Синий', 'Синий деним']), ('кремов', ['Кремовый', 'Молочный', 'Белый']), ('бежев', ['Бежевый', 'Песочный', 'Карамельный']),
          ('джинсов', ['Синий', 'Синий деним', 'Голубой'])]
    for i, m in enumerate(meta):
        if m.get('label') == 'QA':
            name = m['name'].lower()
            if 'джинсовая юбка' in name:
                truth[i] = {'Белый', 'Молочный'}; continue
            for w, ok in QA:
                if w in name:
                    truth[i] = set(ok); break
    return truth


def norm(d):
    e = d['subject'] + d['full']; return e / np.linalg.norm(e, axis=1, keepdims=True)


def main():
    os.environ['AI_COLOUR_HEAD'] = sys.argv[1]; set_veto(sys.argv[2]); r = {}
    d = np.load(C + 'feat_real.npz'); meta = [json.loads(x) for x in d['meta']]; t = real_truth(meta); keys = sorted(t)
    rn = names(norm(d)[keys], d['fg'][keys]); ok = [n in t[k] for n, k in zip(rn, keys)]
    r['real'] = {'n': len(ok), 'right': sum(ok), 'hits': ok, 'names': rn}
    print(f"REAL {sum(ok)}/{len(ok)} = {np.mean(ok)*100:.1f}%")
    print('  misses', [(meta[k].get('item') or meta[k]['label'], n, sorted(t[k])[:3]) for n, k in zip(rn, keys) if n not in t[k]])
    d = np.load(C + 'feat_kagl.npz'); meta = [json.loads(x) for x in d['meta']]; kn = names(norm(d), d['fg']); base = [m['baseColour'] for m in meta]
    for label, table in (('old truth', KAGL_OLD), ('audited truth', KAGL_AUDITED)):
        ok = [n in table[b][1] for n, b in zip(kn, base)]; w = [o for o, b in zip(ok, base) if b in WARM_K]
        print(f'KAGL {label}: {sum(ok)}/{len(ok)} = {np.mean(ok)*100:.1f}%; warm {sum(w)}/{len(w)} = {np.mean(w)*100:.1f}%')
        r['kagl ' + label] = {'right': sum(ok), 'warm': sum(w), 'warm_n': len(w)}
    r['kagl_names'] = kn
    s = np.load(SP + 'swatch.npz'); sm = [m.split('|') for m in s['meta']]; sn = names(s['emb'], s['fg']); ok = [n in COLOURS[m[0]] for n, m in zip(sn, sm)]
    def sub(f):
        x = [o for o, m in zip(ok, sm) if f(m)]; return sum(x), len(x)
    a = sub(lambda m: True); w = sub(lambda m: m[0] in WARM_SW); o = sub(lambda m: m[0] in OTHER_SW)
    leak = sum(n in ('Хаки', 'Оливковый', 'Зеленый') for n, m in zip(sn, sm) if m[0] in WARM_SW)
    print(f'SWATCH all {a[0]}/{a[1]} = {a[0]/a[1]*100:.1f}%; warm colours {w[0]}/{w[1]} = {w[0]/w[1]*100:.1f}%; mustard/khaki/olive/beige {o[0]}/{o[1]} = {o[0]/o[1]*100:.1f}%; warm->green names {leak}')
    for k in COLOURS:
        c = Counter(n for n, m in zip(sn, sm) if m[0] == k); x = [o_ for o_, m in zip(ok, sm) if m[0] == k]
        print(f'  {k:11} {np.mean(x)*100:5.1f}%', ', '.join(f'{a_}:{b_}' for a_, b_ in c.most_common(5)))
    r['swatch'] = {'all': a, 'warm': w, 'other': o, 'leak': leak}
    if len(sys.argv) > 3:
        json.dump(r, open(sys.argv[3], 'w'), ensure_ascii=False)


if __name__ == '__main__':
    main()
