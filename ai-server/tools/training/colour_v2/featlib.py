"""Production views without rembg (too heavy to run beside production): white catalogue background removed by a flood from the edge."""
import os, sys, numpy as np
from PIL import Image, ImageOps
from scipy import ndimage as nd
os.environ.update(OMP_NUM_THREADS='1', AI_CATEGORY_HEAD='/nonexistent', AI_ANALYSIS_MODEL_DIR='/opt/wardrobe/ai-server/models/clip')
sys.path.insert(0, '/root/ai-stylist-mobile/.claude/worktrees/agent-aef06c2711b246aa7/ai-server')
import clothing_analysis as ca
clf = ca.ClothingClassifier()
def cut(img):
    a = np.asarray(img.convert('RGB'), int)
    bgish = (a.min(2) > 235) & (a.max(2) - a.min(2) < 12)
    lab, _ = nd.label(bgish)
    edge = np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]]); edge = edge[edge > 0]
    bg = np.isin(lab, edge)
    alpha = np.where(nd.binary_opening(~bg, iterations=1), 255, 0).astype(np.uint8)
    fg = img.convert('RGBA'); fg.putalpha(Image.fromarray(alpha))
    return fg
def feats(img):
    img = img.convert('RGB'); img.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
    fg = cut(img); al = fg.getchannel('A')
    if (np.asarray(al) > 180).mean() <= .02:
        fg = img.convert('RGBA'); al = fg.getchannel('A')
    white = Image.new('RGB', fg.size, 'white'); white.paste(fg.convert('RGB'), mask=al)
    bbox = al.getbbox()
    v = clf._embed([clf._fit(white.crop(bbox) if bbox else white), clf._fit(ImageOps.fit(img, (clf.size, clf.size), method=Image.Resampling.BICUBIC))])
    small = np.dstack([np.asarray(fg.convert('RGB').resize((160, 160))), np.asarray(al.resize((160, 160), Image.Resampling.NEAREST))]).astype(np.uint8)
    return v[0], v[1], small
