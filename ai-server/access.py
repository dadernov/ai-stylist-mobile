"""Кто имеет право запускать платную генерацию.

Эндпоинты примерки тратят деньги владельца: каждый вызов — списанный кредит
FASHN. До сих пор они не проверяли вызывающего вообще, и любой, кто узнал
адрес, мог выжечь баланс. Ограничение nginx по IP — это замедлитель, а не
защита: адреса меняются.

Здесь проверяются токен сборки и сессия аккаунта. Токен сборки публичный,
сам по себе он не разрешает платные операции. jobs.py атомарно резервирует
личный и общий суточный бюджет перед запуском каждой уникальной примерки.
"""
import hmac
import os
import sqlite3
import threading
import time
from pathlib import Path

from fastapi import Header, HTTPException

import accounts

_DB_LOCK = threading.Lock()
_connection = None


def configured_tokens():
    raw = os.getenv("AI_CLIENT_TOKENS", "")
    return [token.strip() for token in raw.split(",") if token.strip()]


def daily_quota():
    try:
        return int(os.getenv("AI_DEVICE_DAILY_QUOTA", "20"))
    except ValueError:
        return 20


def _database():
    global _connection
    if _connection is None:
        path = Path(os.getenv("AI_QUOTA_DB", Path(__file__).parent / "quota.sqlite3"))
        path.parent.mkdir(parents=True, exist_ok=True)
        _connection = sqlite3.connect(str(path), check_same_thread=False)
        _connection.execute("CREATE TABLE IF NOT EXISTS usage (device TEXT, day TEXT, spent INTEGER, PRIMARY KEY (device, day))")
        _connection.commit()
    return _connection


def reset_state_for_tests():
    global _connection
    with _DB_LOCK:
        if _connection is not None:
            _connection.close()
        _connection = None


def _today():
    return time.strftime("%Y-%m-%d", time.gmtime())


def spent_today(device: str):
    with _DB_LOCK:
        row = _database().execute("SELECT spent FROM usage WHERE device = ? AND day = ?", (device, _today())).fetchone()
    return row[0] if row else 0


def charge(device: str, cost: int = 1):
    """Записывает потраченное. Вызывается после успешной генерации."""
    with _DB_LOCK:
        database = _database()
        database.execute(
            "INSERT INTO usage (device, day, spent) VALUES (?, ?, ?) "
            "ON CONFLICT(device, day) DO UPDATE SET spent = spent + excluded.spent",
            (device, _today(), cost)
        )
        database.commit()


def token_is_known(presented: str):
    known = configured_tokens()
    # Сравнение постоянного времени: иначе по скорости ответа можно подобрать
    # токен посимвольно. Сравниваются байты, а не строки: compare_digest
    # отказывается работать со строкой, где есть не-ASCII, и подставленный
    # кем-то заголовок с кириллицей ронял бы запрос с 500 вместо честного 401.
    presented_bytes = presented.encode("utf-8", "surrogatepass")
    return any(hmac.compare_digest(presented_bytes, token.encode("utf-8")) for token in known)


def require_app(authorization: str | None = Header(default=None)):
    """Пропускает запрос от известной сборки приложения.

    Этого достаточно для входа и регистрации: пользователя там ещё нет.
    """
    known = configured_tokens()
    if not known:
        # Закрыто по умолчанию: пустой список — это не «пускать всех», а
        # незавершённая настройка. Платный эндпоинт не должен открываться
        # из-за забытой переменной окружения.
        raise HTTPException(503, "Сервер не настроен: не задан AI_CLIENT_TOKENS.")
    presented = ""
    if authorization and authorization.lower().startswith("bearer "):
        presented = authorization[7:].strip()
    if not token_is_known(presented):
        raise HTTPException(401, "Нужен действующий токен приложения.")
    return True


def require_account(
    authorization: str | None = Header(default=None),
    x_session_token: str | None = Header(default=None)
):
    """Всё, что тратит ресурсы, требует вошедшего пользователя.

    Квота считается по аккаунту, а не по устройству: переустановка приложения
    больше не обнуляет израсходованное, а один человек не может умножить свою
    норму, переставив приложение.
    """
    require_app(authorization)
    login = accounts.session_owner((x_session_token or "").strip() or None)
    if not login:
        raise HTTPException(401, "Нужно войти в аккаунт.")

    # Authentication must also work after the generation budget is exhausted.
    # Paid jobs reserve their full cost atomically in jobs.start().
    return login
