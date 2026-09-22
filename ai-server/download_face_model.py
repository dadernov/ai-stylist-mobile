"""Install the MIT-licensed OpenCV YuNet model; verify the upstream LFS hash."""
from pathlib import Path
import hashlib
import httpx

SHA256 = '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4'
URL = 'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx'


def download():
    target = Path(__file__).parent / 'models/face/yunet.onnx'
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == SHA256:
        return
    response = httpx.get(URL, timeout=120, follow_redirects=True)
    response.raise_for_status()
    if hashlib.sha256(response.content).hexdigest() != SHA256:
        raise ValueError('Unexpected face model checksum')
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.download')
    temporary.write_bytes(response.content)
    temporary.replace(target)


if __name__ == '__main__':
    download()
