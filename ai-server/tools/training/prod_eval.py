"""The production path: rembg cutout + ClothingClassifier.predict, with and without the head, on held-out real photos
and the QA garments."""
import csv, io, os, random, sys
from collections import defaultdict
sys.path.insert(0, '/root/ai-stylist-mobile/ai-server'); sys.path.insert(0, '/root/claude-scratch-archive/stylist')
os.environ['AI_CATEGORY_HEAD'] = '/root/claude-scratch-archive/catdata/category_head.npz'
from PIL import Image, ImageOps
from rembg import remove, new_session
import clothing_analysis as ca
sys.path.insert(0, '/root/claude-scratch-archive/catdata')
from train import GROUPS
from wardrobe import W

session = new_session('u2net', providers=['CPUExecutionProvider'])
clf = ca.ClothingClassifier()
head = clf.head
assert head is not None
rows = [r for r in csv.DictReader(open('/root/claude-scratch-archive/catdata/grigorev/images.csv')) if r['label'] in GROUPS]
senders = sorted({r['sender_id'] for r in rows})
test = set(senders[::2])
rows = [r for r in rows if r['sender_id'] in test]
random.Random(3).shuffle(rows)
by = defaultdict(list)
for r in rows:
    if len(by[r['label']]) < 30: by[r['label']].append(r)
cases = [(f"/root/claude-scratch-archive/catdata/grigorev/images/{r['image']}.jpg", GROUPS[r['label']], r['label']) for v in by.values() for r in v]
cases += [(next(p for p in [f'/root/claude-scratch-archive/qa/items/{n}.jpg', f'/root/claude-scratch-archive/qa/items/{n}.png'] if os.path.exists(p)), {c}, 'QA')
          for n, (s, c, _) in W.items() if n != 'corduroy_tan']
score = defaultdict(lambda: [0, 0, 0, 0, 0])
for path, good, label in cases:
    content = open(path, 'rb').read()
    original = ImageOps.exif_transpose(Image.open(io.BytesIO(content))).convert('RGB')
    original.thumbnail((1024, 1024))
    buf = io.BytesIO(); original.save(buf, 'JPEG'); fg = Image.open(io.BytesIO(remove(buf.getvalue(), session=session))).convert('RGBA')
    out = []
    for h in (None, head):
        clf.head = h
        r = clf.predict(original, fg)
        out.append((r['category'] in good, r['needsReview']))
    s = score[label]; s[0] += 1; s[1] += out[0][0]; s[2] += out[1][0]; s[3] += out[0][1]; s[4] += out[1][1]
    if label == 'QA' and out[0][0] != out[1][0]:
        print('QA change', os.path.basename(path), good, 'old ok' if out[0][0] else 'new ok', flush=True)
tot = [sum(v[i] for v in score.values()) for i in range(5)]
for k, v in sorted(score.items(), key=lambda x: -x[1][0]):
    print(f'{k:11} n={v[0]:3}  old {v[1] * 100 // v[0]:3}%  new {v[2] * 100 // v[0]:3}%   review old {v[3]} new {v[4]}')
print(f'ALL n={tot[0]} old {tot[1] / tot[0] * 100:.1f}% new {tot[2] / tot[0] * 100:.1f}%  review old {tot[3]} new {tot[4]}')
