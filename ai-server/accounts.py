"""Аккаунты: логин, пароль и долгая сессия.

Раньше вход был демонстрационным — код подтверждения генерировался и
проверялся прямо в приложении, а в боевой сборке он нигде не показывался,
то есть войти было невозможно в принципе. Теперь проверка на сервере.

Пароли хешируются scrypt из стандартной библиотеки: отдельная зависимость
ради этого не нужна, а параметры подобраны так, чтобы подбор был дорогим и на
слабой машине. В базе лежит не сам токен сессии, а его отпечаток — утечка
таблицы не должна давать готовые ключи от чужих аккаунтов.
"""
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import threading
import time
from pathlib import Path

from fastapi import HTTPException

LOGIN_PATTERN = re.compile(r"^[a-zA-Z0-9._-]{3,32}$")
MIN_PASSWORD_LENGTH = 8
SESSION_TTL_DAYS = 365
# Перебор паролей дорожает вместе с этими числами. 2**14 — компромисс: около
# сотни миллисекунд и 16 МБ на попытку, что незаметно при входе и заметно
# при переборе.
SCRYPT_N = 2 ** 14
SCRYPT_R = 8
SCRYPT_P = 1

_LOCK = threading.Lock()
_connection = None


def _database():
    global _connection
    if _connection is None:
        path = Path(os.getenv("AI_ACCOUNTS_DB", Path(__file__).parent / "accounts.sqlite3"))
        path.parent.mkdir(parents=True, exist_ok=True)
        _connection = sqlite3.connect(str(path), check_same_thread=False)
        _connection.execute(
            "CREATE TABLE IF NOT EXISTS users ("
            "login TEXT PRIMARY KEY, password TEXT NOT NULL, display_name TEXT, created_at REAL, "
            "failed_attempts INTEGER DEFAULT 0, locked_until REAL DEFAULT 0)"
        )
        _connection.execute(
            "CREATE TABLE IF NOT EXISTS sessions ("
            "token_hash TEXT PRIMARY KEY, login TEXT NOT NULL, created_at REAL, last_seen REAL)"
        )
        _connection.commit()
    return _connection


def reset_state_for_tests():
    global _connection
    _address_misses.clear()
    with _LOCK:
        if _connection is not None:
            _connection.close()
        _connection = None


def hash_password(password: str, salt: bytes | None = None):
    salt = salt or secrets.token_bytes(16)
    derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${derived.hex()}"


def password_matches(password: str, stored: str):
    try:
        algorithm, n, r, p, salt_hex, expected_hex = stored.split("$")
        if algorithm != "scrypt":
            return False
        derived = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt_hex),
                                 n=int(n), r=int(r), p=int(p), dklen=len(bytes.fromhex(expected_hex)))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(derived.hex(), expected_hex)


def _token_hash(token: str):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def normalise_login(login: str):
    return (login or "").strip().lower()


def validate_credentials(login: str, password: str):
    if not LOGIN_PATTERN.match(login or ""):
        raise HTTPException(422, "Логин: 3–32 символа, латиница, цифры, точка, дефис или подчёркивание.")
    if len(password or "") < MIN_PASSWORD_LENGTH:
        raise HTTPException(422, f"Пароль должен быть не короче {MIN_PASSWORD_LENGTH} символов.")


def _issue_session(login: str):
    token = secrets.token_urlsafe(32)
    now = time.time()
    with _LOCK:
        database = _database()
        database.execute("INSERT INTO sessions (token_hash, login, created_at, last_seen) VALUES (?, ?, ?, ?)",
                         (_token_hash(token), login, now, now))
        database.commit()
    return token


def register(login: str, password: str, display_name: str = ""):
    login = normalise_login(login)
    validate_credentials(login, password)
    with _LOCK:
        database = _database()
        exists = database.execute("SELECT 1 FROM users WHERE login = ?", (login,)).fetchone()
        if exists:
            raise HTTPException(409, "Такой логин уже занят.")
        database.execute("INSERT INTO users (login, password, display_name, created_at) VALUES (?, ?, ?, ?)",
                         (login, hash_password(password), (display_name or "").strip()[:64], time.time()))
        database.commit()
    return {"token": _issue_session(login), "login": login, "displayName": (display_name or "").strip()[:64]}


# Five misses from one address lock that address out of the account for a minute:
# locked for everyone, a stranger typing wrong passwords kept the owner out.
# Across all addresses the account still closes for a while after many misses.
ADDRESS_MISSES, ADDRESS_LOCK_SECONDS = 5, 60
ACCOUNT_MISSES, ACCOUNT_LOCK_SECONDS = 30, 600
_address_misses = {}


def login_user(login: str, password: str, address: str | None = None):
    login = normalise_login(login)
    key = (login, address or "")
    misses, locked_until = _address_misses.get(key, (0, 0))
    if locked_until > time.time():
        raise HTTPException(429, "Слишком много попыток. Попробуй через минуту.")
    with _LOCK:
        row = _database().execute(
            "SELECT password, display_name, locked_until, failed_attempts FROM users WHERE login = ?", (login,)
        ).fetchone()
    now = time.time()
    if row and row[2] and row[2] > now:
        raise HTTPException(429, "Слишком много попыток. Попробуй через минуту.")
    # Пароль проверяется даже для несуществующего логина, иначе по времени
    # ответа видно, какие логины заняты.
    stored = row[0] if row else hash_password(secrets.token_urlsafe(16))
    if not password_matches(password or "", stored) or not row:
        if row:
            _register_failure(login, row[3] or 0)
        misses += 1
        with _LOCK:
            _address_misses[key] = (0, time.time() + ADDRESS_LOCK_SECONDS) if misses >= ADDRESS_MISSES else (misses, 0)
            if len(_address_misses) > 20000:
                now = time.time()
                for stale in [k for k, (count, until) in _address_misses.items() if until < now and not count]:
                    del _address_misses[stale]
        raise HTTPException(401, "Неверный логин или пароль.")
    _address_misses.pop(key, None)
    _reset_failures(login)
    return {"token": _issue_session(login), "login": login, "displayName": row[1] or ""}


def _register_failure(login: str, attempts: int):
    attempts += 1
    # The account as a whole closes only after many misses from anywhere: a guess from
    # many addresses stays slow, and one stranger cannot keep the owner out.
    locked_until = time.time() + ACCOUNT_LOCK_SECONDS if attempts >= ACCOUNT_MISSES else 0
    with _LOCK:
        database = _database()
        database.execute("UPDATE users SET failed_attempts = ?, locked_until = ? WHERE login = ?",
                         (0 if locked_until else attempts, locked_until, login))
        database.commit()


def _reset_failures(login: str):
    with _LOCK:
        database = _database()
        database.execute("UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE login = ?", (login,))
        database.commit()


def session_owner(token: str | None):
    """Логин по токену сессии или None."""
    if not token:
        return None
    now = time.time()
    with _LOCK:
        database = _database()
        row = database.execute("SELECT login, created_at FROM sessions WHERE token_hash = ?", (_token_hash(token),)).fetchone()
        if not row:
            return None
        if now - row[1] > SESSION_TTL_DAYS * 86400:
            database.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))
            database.commit()
            return None
        database.execute("UPDATE sessions SET last_seen = ? WHERE token_hash = ?", (now, _token_hash(token)))
        database.commit()
    return row[0]


def forget_session(token: str | None):
    if not token:
        return
    with _LOCK:
        database = _database()
        database.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))
        database.commit()


def delete_account(login: str):
    """Удаляет пользователя и все его сессии. Возвращает True, если аккаунт был."""
    with _LOCK:
        database = _database()
        existed = database.execute("SELECT 1 FROM users WHERE login = ?", (login,)).fetchone() is not None
        database.execute("DELETE FROM sessions WHERE login = ?", (login,))
        database.execute("DELETE FROM users WHERE login = ?", (login,))
        database.commit()
    return existed


def profile(login: str):
    with _LOCK:
        row = _database().execute("SELECT login, display_name FROM users WHERE login = ?", (login,)).fetchone()
    return {"login": row[0], "displayName": row[1] or ""} if row else None
