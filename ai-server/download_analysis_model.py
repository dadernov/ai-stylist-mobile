"""Download the pinned, CPU-friendly CLIP weights used by clothing_analysis."""
from pathlib import Path
import argparse
from huggingface_hub import hf_hub_download

REVISION = "d15189d"
FILES = ["tokenizer.json", "preprocessor_config.json", "onnx/text_model_fp16.onnx", "onnx/vision_model_quantized.onnx"]


def download(destination: Path):
    for name in FILES:
        hf_hub_download("Xenova/clip-vit-base-patch32", filename=name, revision=REVISION, local_dir=destination)
        print(f"Ready: {name}", flush=True)
    from clothing_analysis import build_text_features
    build_text_features(destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, default=Path(__file__).parent / "models" / "clip")
    download(parser.parse_args().directory)
