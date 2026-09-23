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

## Доступ

Вход и регистрация требуют только токена сборки:

```
POST /auth/register  {login, password, displayName}
POST /auth/login     {login, password}
POST /auth/logout
GET  /auth/me
Authorization: Bearer <один из AI_CLIENT_TOKENS>
```

Всё остальное требует ещё и живой сессии:

```
X-Session-Token: <токен из /auth/login>
```

Пароли хешируются scrypt из стандартной библиотеки; в базе лежит не сам токен
сессии, а его отпечаток. После пяти неверных попыток подряд аккаунт на минуту
закрывается, чтобы перебор был бессмысленно медленным. Сессия живёт год и
переживает перезапуск приложения — входить заново при каждом открытии не нужно.

Суточная квота считается по аккаунту, а не по устройству: переустановка
приложения больше не обнуляет израсходованное.

Пустой `AI_CLIENT_TOKENS` не открывает сервер, а закрывает: примерка ответит
503. Это сделано намеренно — платный эндпоинт не должен открываться из-за
забытой переменной окружения.

Токен живёт в сборке приложения, поэтому его можно оттуда извлечь. Считать его
секретом нельзя; он нужен, чтобы поднять порог и чтобы утёкший ключ можно было
отозвать здесь, не выпуская новую версию сервера. Ущерб от утёкшего токена
ограничивает `AI_DEVICE_DAILY_QUOTA` — суточное число проходов генерации на
одну установку. Учёт ведётся в SQLite и переживает перезапуск.

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

### Quality-only примерка

`POST /tryon-generate-look`: multipart `person_file`, любой из `top_file`, `bottom_file`, `shoes_file`, `outer_file`; категории `top_category` / `outer_category` и `tuck_mode`.
Одна вещь не требует полного комплекта. Параметры `quality_mode=fast` и `compare_mode` принимаются для старых клиентов, но не меняют политику: всегда `tryon-max`, `generation_mode=quality`, без дополнительных повторных проходов.

```bash
export FASHN_API_KEY=...
export FASHN_QUALITY_RESOLUTION=2k
export FASHN_QUALITY_MAX_WAIT_SECONDS=240
export FASHN_IMAGE_MAX_SIDE=2048
python download_face_model.py
```

Верхняя одежда применяется последней. Плащ, тренч и пальто получают отдельные инструкции о полной длине и маску до низа силуэта. Входной референс вещи берётся из исходного фото, а не из автоматически выделенного фрагмента. Это снижает риск потери подола, но не гарантирует физически точную посадку генеративной модели.

Защита лица обязательна. Локальный YuNet находит единственное видимое лицо до платного запроса. После генерации сравниваются пять ориентиров лица, а не размер его рамки: изменение воротника или погрешность детектора не должны отклонять готовую примерку. Небольшой сдвиг, поворот или изменение масштаба компенсируются только на сгенерированном слое через ограниченное преобразование OpenCV; исходное фото не трансформируется. Если лицо на полном кадре пропущено детектором, проверяется увеличенная область головы. Существенное смещение человека, несогласованные ориентиры и ненадёжный силуэт по-прежнему отклоняются. В журнал попадает только причина отказа, без фотографий и координат лица. Модель YuNet распространяется под MIT: [OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet). Загрузчик проверяет SHA-256.

Разница пропорций исходника и результата сама по себе не означает искажение. Если генератор добавил поля, результат вписывается в исходный кадр равномерным масштабированием и центральной обрезкой, без растягивания человека. После этого остаётся обязательная проверка ориентиров лица: обрезанный или существенно увеличенный человек не принимается автоматически.

Итог собирается в исходном размере: лицо и фон вне объединённой маски человека берутся из исходного изображения. PNG исключает повторное JPEG-сжатие защищённых пикселей. Область новой одежды может закрывать часть исходного фона. Точность её границы зависит от сегментации. Отказ выделения силуэта и отказ совмещения имеют разные сообщения; в журнале сохраняются код причины и размеры кадров, но не фотографии, URL результатов или координаты лица.

Кеш и объединение одинаковых активных запросов экономят повторные вызовы. Кеш ограничен 64 МБ (`FASHN_LOOK_CACHE_MAX_BYTES`), так как PNG крупнее JPEG. Смена версии маски инвалидирует старые результаты. Nginx и мобильный клиент допускают до 18 минут на четыре последовательных прохода, не снижая качество при долгом ответе.

Успешный ответ содержит `status=succeeded`, `outputUrl=data:image/png;base64,...`, `qualityModeUsed=quality`, `modelUsed=tryon-max`. Непроверенный результат не используется как запасной вариант.

Проверки без платного API:

```bash
python -m unittest discover -v
```
