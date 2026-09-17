# AI Server (MVP)

MVP AI: background removal + dominant color + palette + базовая классификация вещи + адаптивная статичная примерка по фото + аватарный режим примерки.

## Run locally

```bash
cd ai-server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python download_analysis_model.py
uvicorn app:app --host 0.0.0.0 --port 8000
```

Опционально для детекции позы (распознавание одежды её не требует):

```bash
pip install -r requirements-ml.txt
```

## Endpoint

`POST /analyze` (multipart form: `file`, optional `section_hint`: `Верх`, `Низ`, `Обувь`, `Сумки`, `Верхняя одежда`).

Recognition runs locally on Marqo's fashion SigLIP (quantized ONNX, Apache-2.0),
without torch or an external image API. On a benchmark of 42 labelled garment
photos it names the right category in 93% of cases and has the right one in its
top three every time; the general-purpose CLIP it replaced scored 76% and 93%.

Weights are pinned by `download_analysis_model.py`; set `AI_ANALYSIS_MODEL_DIR`
to override the default `models/clip` directory. Missing weights return a
partial result with `analysisSource: "unavailable"`, never a made-up category.

The installer computes `text_features.npy` once with the quantized text model;
only the vision model and that small table are loaded at runtime. The file is
fingerprinted with the prompt set it was built from, so a stale one makes the
server refuse to start rather than answer from mismatched prompts — re-run the
downloader after changing the category or prompt dictionary.
For photographs of people, the dominant colour is left unset: the foreground
mask can include skin and other garments, not just the target item.

Responses include `categoryCandidates`, `needsReview`, `warnings`,
`backgroundRemoved` and `analysisSource`. Category, pattern and dominant colour
may be null. Candidate scores are relative similarities, not calibrated
probabilities. Season is a category-based suggestion, not fabric analysis.
The client preserves the original photo and lets users confirm or correct
results. Upload limit: 15 MB / 25 megapixels; a busy analyser returns 503.

Tests: `python -m unittest test_analysis.py` from this directory.

Response:
```json
{
  "dominantColor": "#aabbcc",
  "palette": ["#...", "#..."],
  "bgRemovedBase64": "data:image/png;base64,...",
  "category": "Футболка",
  "season": "Демисезон",
  "pattern": "Однотонный"
}
```

`POST /tryon-model` (multipart form: `file`)

Response:
```json
{
  "neutralModelBase64": "data:image/png;base64,...",
  "personMaskBase64": "data:image/png;base64,...",
  "pose": {
    "leftShoulder": { "x": 0.42, "y": 0.2, "v": 0.9 },
    "rightShoulder": { "x": 0.57, "y": 0.21, "v": 0.88 },
    "leftHip": { "x": 0.44, "y": 0.52, "v": 0.8 },
    "rightHip": { "x": 0.56, "y": 0.53, "v": 0.79 },
    "leftAnkle": { "x": 0.45, "y": 0.91, "v": 0.76 },
    "rightAnkle": { "x": 0.55, "y": 0.91, "v": 0.77 },
    "nose": { "x": 0.5, "y": 0.08, "v": 0.95 }
  },
  "orientation": "front",
  "torsoAngleDeg": -2.1,
  "sourceWidth": 1080,
  "sourceHeight": 1920
}
```

`POST /tryon-avatar` (multipart form: `file`) - рекомендуемый endpoint для мобильного preview.

Response:
```json
{
  "avatarModelBase64": "data:image/png;base64,...",
  "personMaskBase64": "data:image/png;base64,...",
  "pose": {
    "leftShoulder": { "x": 0.42, "y": 0.2, "v": 0.9 },
    "rightShoulder": { "x": 0.57, "y": 0.21, "v": 0.88 },
    "leftHip": { "x": 0.44, "y": 0.52, "v": 0.8 },
    "rightHip": { "x": 0.56, "y": 0.53, "v": 0.79 },
    "leftAnkle": { "x": 0.45, "y": 0.91, "v": 0.76 },
    "rightAnkle": { "x": 0.55, "y": 0.91, "v": 0.77 },
    "nose": { "x": 0.5, "y": 0.08, "v": 0.95 }
  },
  "orientation": "front",
  "torsoAngleDeg": -2.1,
  "sourceWidth": 1080,
  "sourceHeight": 1920
}
```

`POST /tryon-generate` (multipart form: `person_file`, `garment_file`) - генеративная примерка через FASHN API.

`POST /tryon-generate-look` (multipart form: `person_file`, `top_file?`, `bottom_file?`, `shoes_file?`) -
генерирует полный образ в одной итоговой картинке (слои применяются последовательно: верх -> низ -> обувь).

Нужны переменные окружения:

```bash
export FASHN_API_KEY=...
export FASHN_MODEL_NAME=tryon-v1.6
# для tryon-v1.6:
export FASHN_MODE=balanced
export FASHN_CATEGORY=auto
export FASHN_GARMENT_PHOTO_TYPE=auto
export FASHN_SEGMENTATION_FREE=false
export FASHN_NUM_SAMPLES=1
export FASHN_CATEGORY_TOP_CANDIDATES=tops,auto
export FASHN_CATEGORY_BOTTOM_CANDIDATES=bottoms,auto
export FASHN_CATEGORY_SHOES_CANDIDATES=auto
# для полного лука (tryon-generate-look) рекомендуем:
export FASHN_LOOK_MODEL_NAME=tryon-max
export FASHN_LOOK_MODE=quality
# если используешь tryon-max:
# export FASHN_LOOK_GENERATION_MODE=balanced
# для tryon-max (опционально):
# export FASHN_MODEL_NAME=tryon-max
# export FASHN_GENERATION_MODE=balanced
# export FASHN_RESOLUTION=1k
```

Рекомендуемые настройки для мобильного preview:

```bash
# быстрый режим: целимся примерно в 15 секунд для верха+низа
export FASHN_FAST_LOOK_MODEL_NAME=tryon-v1.6
export FASHN_FAST_MODE=performance
export FASHN_FAST_MAX_WAIT_SECONDS=30
export FASHN_FAST_POLL_INTERVAL_SECONDS=0.75
export FASHN_FAST_IMAGE_MAX_SIDE=1280
export FASHN_FAST_JPEG_QUALITY=86

# режим качества: медленнее, но лучше детализация
export FASHN_LOOK_MODEL_NAME=tryon-max
export FASHN_LOOK_GENERATION_MODE=balanced
export FASHN_RESOLUTION=1k

# защита лица: backend накладывает голову/лицо из исходного фото поверх результата
export FASHN_FACE_LOCK=true
export FASHN_FACE_LOCK_JPEG_QUALITY=92
```

Response:
```json
{
  "status": "succeeded",
  "predictionId": "....",
  "outputUrl": "https://...",
  "webUrl": "https://..."
}
```
