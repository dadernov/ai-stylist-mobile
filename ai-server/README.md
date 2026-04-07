# AI Server (MVP)

MVP AI: background removal + dominant color + palette + базовая классификация вещи + адаптивная статичная примерка по фото + аватарный режим примерки.

## Run locally

```bash
cd ai-server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

Опционально (для CLIP-классификации + детекции позы вместо fallback-эвристик):

```bash
pip install -r requirements-ml.txt
```

## Endpoint

`POST /analyze` (multipart form: `file`)

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
