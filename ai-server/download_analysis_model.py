"""Download the pinned, CPU-friendly recognition weights used by clothing_analysis.

Marqo's fashion SigLIP, quantized ONNX, published by the same account that
trained the model. Apache-2.0, ~94 MB for the vision tower that serves requests
and ~111 MB for the text tower, which is only needed here to precompute the
prompt features and can be deleted afterwards.
"""
from pathlib import Path
import argparse
from huggingface_hub import hf_hub_download

REPO = "Marqo/marqo-fashionSigLIP"
REVISION = "c56244cc94f92419e8369fa71efdaf403b124ce8"
FILES = ["tokenizer.json", "preprocessor_config.json", "onnx/text_model_quantized.onnx", "onnx/vision_model_quantized.onnx"]


def download(destination: Path):
    for name in FILES:
        hf_hub_download(REPO, filename=name, revision=REVISION, local_dir=destination)
        print(f"Ready: {name}", flush=True)
    # An upgrade from a previous model leaves its weights behind — hundreds of
    # megabytes of dead files on a small VPS.
    keep = {Path(name).name for name in FILES}
    for stale in (destination / "onnx").glob("*.onnx"):
        if stale.name not in keep:
            stale.unlink()
            print(f"Removed stale: {stale.name}", flush=True)
    from clothing_analysis import build_text_features
    build_text_features(destination)
    print("Ready: text_features.npy", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, default=Path(__file__).parent / "models" / "clip")
    download(parser.parse_args().directory)
