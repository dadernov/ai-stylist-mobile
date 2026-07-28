#!/usr/bin/env bash
# Разворачивает AI-сервер (FastAPI) на чистой Ubuntu 22.04/24.04.
# Идемпотентно: повторный запуск просто обновляет код и зависимости.
#
#   curl/scp этот репозиторий на сервер и:
#     sudo APP_DIR=/opt/wardrobe/ai-server PORT=8000 bash deploy/install.sh
#
# Переменные окружения приложения (FASHN_API_KEY и т.д.) НЕ прописываются здесь —
# скопируй deploy/env.example в /etc/wardrobe-ai.env и заполни (см. DEPLOY.md).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/wardrobe/ai-server}"
PORT="${PORT:-8000}"
SERVICE_NAME="${SERVICE_NAME:-wardrobe-ai}"
ENV_FILE="${ENV_FILE:-/etc/wardrobe-ai.env}"
WITH_CLIP="${WITH_CLIP:-1}"        # 1 = ставить torch+transformers (CLIP-классификация)
INSTALL_SYSTEMD="${INSTALL_SYSTEMD:-1}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> APP_DIR=$APP_DIR PORT=$PORT SERVICE=$SERVICE_NAME WITH_CLIP=$WITH_CLIP"

# 1. Системные пакеты
if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq python3 python3-venv python3-pip curl ca-certificates
fi

# 2. Код
mkdir -p "$APP_DIR"
for f in app.py requirements.txt README.md; do
  [ -f "$SRC_DIR/$f" ] && cp "$SRC_DIR/$f" "$APP_DIR/$f"
done
cp -r "$SRC_DIR/deploy" "$APP_DIR/deploy"

# 3. venv + зависимости
python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --quiet --upgrade pip wheel
"$APP_DIR/.venv/bin/pip" install --quiet -r "$APP_DIR/requirements.txt"

if [ "$WITH_CLIP" = "1" ]; then
  # CPU-сборка torch: venv выходит ~1.6 ГБ вместо 5.4 ГБ на CUDA-колёсах, GPU на VPS нет.
  # Версии — те, на которых прогон проверялся 28.07.2026; TORCH_SPEC/TRANSFORMERS_SPEC
  # можно переопределить, если понадобятся свежие.
  "$APP_DIR/.venv/bin/pip" install --quiet \
    --index-url https://download.pytorch.org/whl/cpu "${TORCH_SPEC:-torch==2.13.0}"
  "$APP_DIR/.venv/bin/pip" install --quiet "${TRANSFORMERS_SPEC:-transformers==5.14.1}"
fi

# 4. Прогрев моделей: rembg (u2net.onnx, ~170 МБ) и CLIP (~600 МБ) скачиваются
#    ОДИН раз здесь, чтобы первый запрос пользователя не ждал загрузку.
echo "==> прогрев моделей"
U2NET_HOME="${U2NET_HOME:-$HOME/.u2net}" "$APP_DIR/.venv/bin/python" - <<'PY'
from PIL import Image
from io import BytesIO
from rembg import remove
buf = BytesIO(); Image.new("RGB", (64, 64), (120, 90, 60)).save(buf, format="PNG")
remove(buf.getvalue())
print("rembg ok")
PY
if [ "$WITH_CLIP" = "1" ]; then
  "$APP_DIR/.venv/bin/python" - <<'PY'
from transformers import CLIPModel, CLIPProcessor
mid = "openai/clip-vit-base-patch32"
CLIPModel.from_pretrained(mid); CLIPProcessor.from_pretrained(mid)
print("clip ok")
PY
fi

# 5. systemd
if [ "$INSTALL_SYSTEMD" = "1" ]; then
  [ -f "$ENV_FILE" ] || { cp "$SRC_DIR/deploy/env.example" "$ENV_FILE"; chmod 600 "$ENV_FILE"; \
    echo "!! создан $ENV_FILE из шаблона — впиши FASHN_API_KEY"; }
  sed -e "s#__APP_DIR__#$APP_DIR#g" -e "s#__PORT__#$PORT#g" -e "s#__ENV_FILE__#$ENV_FILE#g" \
    "$SRC_DIR/deploy/wardrobe-ai.service" > "/etc/systemd/system/${SERVICE_NAME}.service"
  systemctl daemon-reload
  systemctl enable --now "$SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"
fi

# 6. Проверка
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/docs" || true)
  [ "$code" = "200" ] && { echo "==> OK: http://127.0.0.1:$PORT/docs отвечает 200"; exit 0; }
  sleep 2
done
echo "!! сервис не поднялся, смотри: journalctl -u $SERVICE_NAME -n 50 --no-pager" >&2
exit 1
