# Развёртывание AI-сервера на новом сервере

Сервер stateless: никакой БД и пользовательских данных на нём нет — гардероб хранится
в приложении. Значит переезд = поднять новый VPS, прогнать `deploy/install.sh`,
перевесить домен/IP в клиенте. Старый сервер можно гасить сразу после проверки.

## Что нужно

- VPS с Ubuntu 22.04 или 24.04, **2 vCPU / 4 ГБ RAM / 15 ГБ диска** (столько ест прод:
  venv с CPU-torch ~1.5 ГБ + кеши моделей ~0.8 ГБ; на CUDA-колёсах было 5.4 ГБ — не надо).
  GPU не нужен: тяжёлая генерация уходит во внешний FASHN API.
- `FASHN_API_KEY` — ключ платного API (без него `/tryon-generate*` не работают,
  `/analyze` и `/tryon-avatar` работают).
- Доступ наружу к `api.fashn.ai` и `cdn.fashn.ai`, к HuggingFace и GitHub (для установки).

## Установка (10–15 минут)

```bash
git clone git@github.com:dadernov/ai-stylist-mobile.git /root/ai-stylist
cd /root/ai-stylist/ai-server
sudo bash deploy/install.sh
```

Скрипт: ставит python3-venv, кладёт код в `/opt/wardrobe/ai-server`, создаёт venv,
ставит зависимости (torch — CPU-сборка), **заранее скачивает модели** (u2net для rembg,
CLIP), ставит и запускает systemd-юнит `wardrobe-ai`, ждёт 200 на `/docs`.

Переменные: `APP_DIR`, `PORT`, `SERVICE_NAME`, `ENV_FILE`, `WITH_CLIP=0` (без CLIP —
категории вещей определяются эвристиками), `INSTALL_SYSTEMD=0`.

Дальше вписать ключ и перезапустить:

```bash
sudo nano /etc/wardrobe-ai.env    # FASHN_API_KEY=...
sudo systemctl restart wardrobe-ai
```

Все переменные окружения с их прод-значениями — в `deploy/env.example`
(смысл каждой FASHN_* — в `README.md`).

## HTTPS

Клиент ходит по HTTPS, поэтому нужен nginx + сертификат. Своего домена у проекта нет —
на проде использовался `<IP>.nip.io`:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo sed "s/__HOST__/<НОВЫЙ_IP>.nip.io/" deploy/nginx-wardrobe-ai.conf \
  | sudo tee /etc/nginx/sites-available/wardrobe-ai
sudo ln -sf /etc/nginx/sites-available/wardrobe-ai /etc/nginx/sites-enabled/
sudo certbot --nginx -d <НОВЫЙ_IP>.nip.io     # сам дописывает 443 и редирект с 80
sudo nginx -t && sudo systemctl reload nginx
```

`client_max_body_size 30m` и таймауты 300 c в конфиге обязательны: фото большие,
генерация лука идёт до 240 c.

## Переключить приложение

Базовый URL задан в `src/constants/ai.ts` (`FALLBACK_AI_BASE_URL`) и перебивается
`EXPO_PUBLIC_AI_BASE_URL`. Поменять на `https://<НОВЫЙ_IP>.nip.io`, пересобрать клиент.

## Проверка после переезда

Наружу nginx пускает только `/analyze` и `/tryon-generate-look` (с лимитом запросов по IP).
Остальные эндпоинты и `/docs` проверяются на самом сервере напрямую в uvicorn:

```bash
curl -sf http://127.0.0.1:8000/docs -o /dev/null && echo docs ok
curl -sf -F file=@photo.jpg https://<НОВЫЙ_IP>.nip.io/analyze | head -c 300      # снаружи: категория/цвет
curl -sf -F file=@person.jpg http://127.0.0.1:8000/tryon-avatar | head -c 200
curl -sf -F person_file=@person.jpg -F garment_file=@shirt.jpg \
  http://127.0.0.1:8000/tryon-generate                                           # проверяет FASHN-ключ (1 кредит)
curl -s -o /dev/null -w '%{http_code}\n' https://<НОВЫЙ_IP>.nip.io/docs          # снаружи должно быть 404
```

## Эксплуатация

```bash
systemctl status wardrobe-ai
journalctl -u wardrobe-ai -n 50 --no-pager
systemctl restart wardrobe-ai
```

Обновление кода: `git pull && sudo bash deploy/install.sh` (идемпотентно).

## Проверено 28.07.2026

Скрипт прогнан на чистом окружении (изолированный каталог + свой venv + свои кеши
моделей, порт 8010, systemd-юнит `wardrobe-ai-test`) на Ubuntu 24.04 с python 3.12.
Результат: venv 1.6 ГБ, модели скачались (u2net 176 МБ, CLIP), сервис поднялся,
`/analyze`, `/tryon-avatar`, `/tryon-model` вернули 200 за ~1–3 c на 2 vCPU.
Ключ FASHN живой, `api.fashn.ai/v1/credits` → 200, на балансе 160 кредитов.
Тестовый стенд после проверки удалён, прод не трогали.

По ходу проверки нашлось и починено: в `requirements.txt` был `rembg` без `[cpu]`,
из-за чего не ставился `onnxruntime` и `remove()` падал на первом же запросе —
установка «по README» на чистой машине не взлетала.

Отдельная грабля старого сервера: в `/etc/environment` прописан мёртвый
`http(s)_proxy` (194.87.40.45:6614) — из-за него `pip` на этой машине не работает
без `env -u http_proxy -u https_proxy`. На новом сервере просто не прописывай прокси.

## Прод разошёлся с git (на 28.07.2026)

На сервере крутился `app.py` от 02.06.2026 21:48, а `main` ушёл вперёд (коммит от
03.06). Это разные ветки одной работы: на проде face lock через cv2 Haar-каскады,
в `main` — pose-based face lock и быстрый режим примерки. Прод-версия сохранена
в ветке `server-snapshot-2026-07-28`, чтобы не пропала вместе с сервером.
**Деплой идёт с `main`** — если после переезда примерка «потеряет лицо» хуже, чем
раньше, сравни с этой веткой: `git diff main server-snapshot-2026-07-28 -- ai-server/app.py`.

## Чего на старом сервере НЕТ (чтобы не искать при переезде)

- Никакой базы, загруженных файлов, состояния: кеш примерок — в памяти процесса,
  теряется при рестарте, это норма.
- `mediapipe` не установлен — определение позы работает через bbox-fallback.
  Ставится опционально: `pip install -r requirements-ml.txt`.
- Прокси `http(s)_proxy` в юните был прописан, но мёртв; во FASHN приложение ходит
  напрямую. На новом сервере прокси не нужен.
- Старый сервер (Aeza) был общий: на нём же крутились `x-ui` и `light-pay` — к этому
  проекту они отношения не имеют, переносить не надо.
