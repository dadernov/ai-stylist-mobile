"""Install pinned SegFormer B0 clothing weights (upstream model card: MIT)."""
import hashlib
from pathlib import Path

import httpx

REVISION = 'a2489ea8e7ec1ee912190546bad31a4906ccca76'
SHA256 = '02e6f1545475bc549184b6710487555b4b73eb08354cc3a480fb4fab1473a9d3'
URL = f'https://huggingface.co/Xenova/segformer_b0_clothes/resolve/{REVISION}/onnx/model.onnx'


def download():
    target = Path(__file__).parent / 'models/parsing/clothes.onnx'
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == SHA256:
        return
    response = httpx.get(URL, timeout=120, follow_redirects=True)
    response.raise_for_status()
    if hashlib.sha256(response.content).hexdigest() != SHA256:
        raise ValueError('Unexpected clothing parsing model checksum')
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.download')
    temporary.write_bytes(response.content)
    temporary.replace(target)


if __name__ == '__main__':
    download()
