"""Dev swatches: hexes that are not in the test's COLOURS."""
import sys, numpy as np
sys.path.insert(0, '/tmp/claude-0/-root/6094b43c-07b7-4694-91b7-5951b3c5be38/scratchpad')
from swatch_lib import render, embed, Image
DEV = {'#CB9560': 'Карамельный', '#BC8C58': 'Карамельный,Коричневый', '#D9BC92': 'Песочный,Карамельный', '#E0CCA0': 'Песочный,Бежевый', '#7A4C2A': 'Коричневый', '#A06A3A': 'Коричневый,Карамельный',
       '#C29A22': 'Горчичный', '#BE9A30': 'Горчичный', '#73853F': 'Оливковый,Хаки', '#66744C': 'Хаки,Оливковый', '#EDE3C8': 'Бежевый,Кремовый,Молочный', '#2A8A3E': 'Зеленый', '#7C7C7C': 'Серый', '#D03035': 'Красный'}
E_, F, T = [], [], []
n = 0
for h, t in DEV.items():
    for kind in ('shaded', 'knit'):
        for li in ('neutral', 'warm', 'cool'):
            o, f = render(h, kind, li, seed=100 + n); n += 1
            E_.append(embed(o, f)); T.append(t)
            F.append(np.dstack([np.asarray(f.convert('RGB').resize((160, 160))), np.asarray(f.getchannel('A').resize((160, 160), Image.Resampling.NEAREST))]).astype(np.uint8))
np.savez_compressed('data/dev_swatch.npz', emb=np.array(E_, np.float32), fg=np.array(F), truth=np.array(T)); print('dev swatches', n)
