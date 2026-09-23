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
INSTALL_SYSTEMD="${INSTALL_SYSTEMD:-1}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> APP_DIR=$APP_DIR PORT=$PORT SERVICE=$SERVICE_NAME"

# 1. Системные пакеты
if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq python3 python3-venv python3-pip curl ca-certificates
fi

# 2. Пользователь сервиса и код
# Системный пользователь без домашней папки и без оболочки: сервису нужен
# только свой каталог.
SERVICE_USER="${SERVICE_USER:-wardrobe}"
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

mkdir -p "$APP_DIR"
for f in app.py access.py accounts.py jobs.py request_guard.py clothing_analysis.py tryon_composite.py face_guard.py footwear_guard.py tryon_policy.py image_color.py garment_guard.py tryon_matte.py tryon_reference.py tryon_debug.py download_face_model.py download_parsing_model.py download_analysis_model.py requirements.txt README.md; do
  [ -f "$SRC_DIR/$f" ] && cp "$SRC_DIR/$f" "$APP_DIR/$f"
done
cp -r "$SRC_DIR/deploy" "$APP_DIR/deploy"

# 3. venv + зависимости
# Venv помнит путь к интерпретатору, которым создан. Если тот жил во временном
# каталоге и исчез, venv остаётся на месте, но любой его скрипт падает с
# «No such file or directory» — служба при этом бесконечно перезапускается.
# Поэтому окружение проверяется и при негодности пересоздаётся.
if [ -x "$APP_DIR/.venv/bin/python" ] && ! "$APP_DIR/.venv/bin/python" -c "import sys" >/dev/null 2>&1; then
  echo "==> venv сломан (интерпретатор недоступен), пересоздаю"
  rm -rf "$APP_DIR/.venv"
fi
python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --quiet --upgrade pip wheel
"$APP_DIR/.venv/bin/pip" install --quiet -r "$APP_DIR/requirements.txt"
# Скачивает модель распознавания и пересобирает текстовые признаки под текущие
# промпты. Обязательный шаг: сервер откажется стартовать с признаками от другого
# набора промптов, чтобы не отвечать молча мимо.
"$APP_DIR/.venv/bin/python" "$APP_DIR/download_analysis_model.py"
"$APP_DIR/.venv/bin/python" "$APP_DIR/download_face_model.py"
"$APP_DIR/.venv/bin/python" "$APP_DIR/download_parsing_model.py"

# 4. Прогрев моделей: rembg (u2net.onnx, ~170 МБ) скачивается ОДИН раз здесь,
#    чтобы первый запрос пользователя не ждал загрузку.
echo "==> прогрев моделей"
# Тот же каталог, что и в systemd-юните: иначе прогретая модель осталась бы
# в домашней папке root, а сервису под своим пользователем пришлось бы качать
# её заново на первом запросе.
U2NET_HOME="$APP_DIR/.u2net" "$APP_DIR/.venv/bin/python" - <<'PY'
from PIL import Image
from io import BytesIO
from rembg import remove
buf = BytesIO(); Image.new("RGB", (64, 64), (120, 90, 60)).save(buf, format="PNG")
remove(buf.getvalue())
print("rembg ok")
PY
# 4b. Права: каталог целиком отдаётся пользователю сервиса, иначе он не сможет
# ни дочитать модели, ни вести учёт квот.
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"

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
