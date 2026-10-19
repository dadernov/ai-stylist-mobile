"""The production SigLIP image encoder with the production preprocessing (clothing_analysis.ClothingClassifier)."""
import json
from pathlib import Path
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps

D = Path('/root/ai-stylist-mobile/ai-server/models/clip')


class Embedder:
    def __init__(self, threads=1):
        config = json.loads((D / 'preprocessor_config.json').read_text())
        crop = config.get('crop_size') or config.get('size')
        self.size = crop['height'] if isinstance(crop, dict) else int(crop)
        self.mean = np.array(config['image_mean'], dtype=np.float32)
        self.std = np.array(config['image_std'], dtype=np.float32)
        o = ort.SessionOptions(); o.intra_op_num_threads = threads; o.inter_op_num_threads = 1; o.enable_cpu_mem_arena = False
        self.vision = ort.InferenceSession(str(D / 'onnx/vision_model_quantized.onnx'), sess_options=o, providers=['CPUExecutionProvider'])

    def fit(self, image):
        return ImageOps.pad(image.convert('RGB'), (self.size, self.size), method=Image.Resampling.BICUBIC, color='white')

    def full(self, image):
        return self.fit(ImageOps.fit(image.convert('RGB'), (self.size, self.size), method=Image.Resampling.BICUBIC))

    def embed(self, images):
        arrays = [(np.asarray(i, dtype=np.float32) / 255 - self.mean) / self.std for i in images]
        pixels = np.stack([a.transpose(2, 0, 1) for a in arrays]).astype(np.float32)
        v = self.vision.run(['image_embeds'], {'pixel_values': pixels})[0]
        return v / np.linalg.norm(v, axis=1, keepdims=True)
