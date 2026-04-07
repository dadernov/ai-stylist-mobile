# AI Server (MVP)

MVP AI: background removal + dominant color + palette + базовая классификация вещи.

## Run locally

```bash
cd ai-server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

Опционально (для CLIP-классификации вместо эвристик):

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
