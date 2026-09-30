"""A user's wardrobe on the server: the items, their photos and the try-on photo.

The wardrobe used to live only on the phone: lost with it and invisible on a
second device. Now every account keeps a copy here, and the app syncs it.

Security, since these are people's photos, their own body among them:
- every row and file belongs to one login and is reached only through that
  login's session; ids are checked, and a photo id alone opens nothing;
- photos are encrypted at rest with AES-256-GCM under a key derived per
  account from AI_CLOSET_KEY, bound to the owner and the photo id, and their
  folder names do not reveal the login;
- every photo is decoded and saved anew, so no EXIF (location) survives;
- sizes, counts and the space of one account are capped;
- deleting the account deletes everything; a deleted item is kept 30 days,
  so a mistaken deletion on one device can still be undone on another.
"""
import base64
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import shutil
import sqlite3
import threading
import time
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

ID = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
MAX_ITEM_BYTES = 16 * 1024
MAX_PROFILE_BYTES = 4 * 1024
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_SIDE = 2048
TOMBSTONE_DAYS = 30
# A photo nothing refers to (replaced or of a deleted item) goes after a day.
ORPHAN_SECONDS = 86400

_lock = threading.Lock()
_connection = None


def _limit(name, default):
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default


def _root():
    return Path(os.getenv('AI_CLOSET_DIR', Path(__file__).parent / 'closet'))


def _database_path():
    return Path(os.getenv('AI_CLOSET_DB', Path(__file__).parent / 'closet.sqlite3'))


def _database():
    global _connection
    if _connection is None:
        path = _database_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        _connection = sqlite3.connect(str(path), check_same_thread=False)
        _connection.executescript("""
            CREATE TABLE IF NOT EXISTS items (owner TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
                updated REAL NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(owner, id));
            CREATE TABLE IF NOT EXISTS profile (owner TEXT PRIMARY KEY, data TEXT NOT NULL, updated REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS blobs (owner TEXT NOT NULL, id TEXT NOT NULL, mime TEXT NOT NULL,
                size INTEGER NOT NULL, created REAL NOT NULL, PRIMARY KEY(owner, id));
        """)
        _connection.commit()
    return _connection


def reset_state_for_tests():
    global _connection
    with _lock:
        if _connection is not None:
            _connection.close()
        _connection = None


def _master_key():
    raw = os.getenv('AI_CLOSET_KEY', '').strip()
    try:
        key = base64.b64decode(raw, validate=True) if raw else b''
    except ValueError:
        key = b''
    if len(key) != 32:
        # Without the key nothing is stored rather than stored in the clear.
        raise HTTPException(503, 'Хранилище гардероба недоступно.')
    return key


def _owner_key(owner):
    return hmac.new(_master_key(), b'closet-key:' + owner.encode(), hashlib.sha256).digest()


def _folder(owner):
    # Named by a keyed hash: a listing of the disk shows no logins.
    return _root() / hmac.new(_master_key(), b'closet-dir:' + owner.encode(), hashlib.sha256).hexdigest()[:32]


def _check_id(value, what='вещи'):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise HTTPException(422, f'Некорректный идентификатор {what}.')
    return value


def _encode(data, limit):
    if not isinstance(data, dict):
        raise HTTPException(422, 'Нужен объект с данными.')
    encoded = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    if len(encoded.encode()) > limit:
        raise HTTPException(413, 'Слишком много данных для одной записи.')
    return encoded


def _referenced_blobs(data):
    return {value for key, value in data.items() if key.endswith('Blob') and isinstance(value, str)}


def _check_blobs(db, owner, data):
    """An item may point only at photos of its own owner."""
    for blob_id in _referenced_blobs(data):
        _check_id(blob_id, 'фото')
        if not db.execute('SELECT 1 FROM blobs WHERE owner=? AND id=?', (owner, blob_id)).fetchone():
            raise HTTPException(422, 'Фото вещи ещё не загружено.')


def snapshot(owner, since=0.0):
    """Items and the profile changed after `since` (server time), deleted items included."""
    since = float(since or 0)
    with _lock:
        db = _database()
        items = [{'id': item_id, 'data': json.loads(data), 'updated': updated, 'deleted': bool(deleted)}
                 for item_id, data, updated, deleted in db.execute(
                     'SELECT id, data, updated, deleted FROM items WHERE owner=? AND updated>? ORDER BY updated', (owner, since))]
        row = db.execute('SELECT data, updated FROM profile WHERE owner=? AND updated>?', (owner, since)).fetchone()
    return {'items': items, 'profile': {'data': json.loads(row[0]), 'updated': row[1]} if row else None, 'now': time.time()}


def put_item(owner, item_id, data):
    _check_id(item_id)
    encoded = _encode(data, MAX_ITEM_BYTES)
    now = time.time()
    with _lock:
        db = _database()
        with db:
            exists = db.execute('SELECT 1 FROM items WHERE owner=? AND id=?', (owner, item_id)).fetchone()
            if not exists and db.execute('SELECT COUNT(*) FROM items WHERE owner=? AND deleted=0', (owner,)).fetchone()[0] >= _limit('AI_CLOSET_MAX_ITEMS', 1000):
                raise HTTPException(413, 'В гардеробе слишком много вещей.')
            _check_blobs(db, owner, data)
            db.execute('INSERT INTO items(owner, id, data, updated, deleted) VALUES(?,?,?,?,0) '
                       'ON CONFLICT(owner, id) DO UPDATE SET data=excluded.data, updated=excluded.updated, deleted=0',
                       (owner, item_id, encoded, now))
    return now


def delete_item(owner, item_id):
    _check_id(item_id)
    now = time.time()
    with _lock:
        db = _database()
        with db:
            db.execute('UPDATE items SET deleted=1, updated=? WHERE owner=? AND id=? AND deleted=0', (now, owner, item_id))
    return now


def put_profile(owner, data):
    encoded = _encode(data, MAX_PROFILE_BYTES)
    now = time.time()
    with _lock:
        db = _database()
        with db:
            _check_blobs(db, owner, data)
            db.execute('INSERT INTO profile(owner, data, updated) VALUES(?,?,?) '
                       'ON CONFLICT(owner) DO UPDATE SET data=excluded.data, updated=excluded.updated', (owner, encoded, now))
    return now


def _clean_image(content):
    """The photo decoded and saved anew: no EXIF or other metadata survives."""
    if not content or len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, 'Нужно фото размером не больше 15 МБ.')
    try:
        with Image.open(io.BytesIO(content)) as source:
            if source.width * source.height > 40_000_000:
                raise HTTPException(413, 'Фото слишком большое.')
            image = ImageOps.exif_transpose(source)
            image.load()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(422, 'Не удалось открыть фото. Выбери JPEG, PNG или WebP.')
    image.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
    transparent = image.mode in ('RGBA', 'LA') or (image.mode == 'P' and 'transparency' in image.info)
    out = io.BytesIO()
    if transparent:
        # Cut-outs keep their transparency.
        image.convert('RGBA').save(out, format='PNG', optimize=True)
        return out.getvalue(), 'image/png'
    image.convert('RGB').save(out, format='JPEG', quality=90, optimize=True)
    return out.getvalue(), 'image/jpeg'


def put_blob(owner, content):
    data, mime = _clean_image(content)
    blob_id = secrets.token_urlsafe(24)
    sealed = _seal(owner, blob_id, data)
    with _lock:
        db = _database()
        used = db.execute('SELECT COALESCE(SUM(size), 0), COUNT(*) FROM blobs WHERE owner=?', (owner,)).fetchone()
        if used[0] + len(sealed) > _limit('AI_CLOSET_MAX_BYTES', 500 * 1024 * 1024) or used[1] >= _limit('AI_CLOSET_MAX_BLOBS', 3000):
            raise HTTPException(413, 'Место для фото гардероба закончилось.')
        folder = _folder(owner)
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = folder / blob_id
        temporary = path.with_suffix('.part')
        with open(temporary, 'wb', opener=lambda file, flags: os.open(file, flags, 0o600)) as handle:
            handle.write(sealed)
        os.replace(temporary, path)
        with db:
            db.execute('INSERT INTO blobs(owner, id, mime, size, created) VALUES(?,?,?,?,?)',
                       (owner, blob_id, mime, len(sealed), time.time()))
    return blob_id


def get_blob(owner, blob_id):
    _check_id(blob_id, 'фото')
    with _lock:
        row = _database().execute('SELECT mime FROM blobs WHERE owner=? AND id=?', (owner, blob_id)).fetchone()
    if not row:
        raise HTTPException(404, 'Фото не найдено.')
    try:
        return _open(owner, blob_id, (_folder(owner) / blob_id).read_bytes()), row[0]
    except FileNotFoundError:
        raise HTTPException(404, 'Фото не найдено.')


def _seal(owner, blob_id, data):
    nonce = secrets.token_bytes(12)
    return nonce + AESGCM(_owner_key(owner)).encrypt(nonce, data, f'{owner}/{blob_id}'.encode())


def _open(owner, blob_id, sealed):
    return AESGCM(_owner_key(owner)).decrypt(sealed[:12], sealed[12:], f'{owner}/{blob_id}'.encode())


def collect(owner, now=None):
    """Drop tombstones past 30 days and photos nothing refers to any more."""
    now = time.time() if now is None else now
    with _lock:
        db = _database()
        with db:
            db.execute('DELETE FROM items WHERE owner=? AND deleted=1 AND updated<?', (owner, now - TOMBSTONE_DAYS * 86400))
            used = set()
            for (data,) in db.execute('SELECT data FROM items WHERE owner=?', (owner,)):
                used |= _referenced_blobs(json.loads(data))
            row = db.execute('SELECT data FROM profile WHERE owner=?', (owner,)).fetchone()
            if row:
                used |= _referenced_blobs(json.loads(row[0]))
            stale = [blob_id for (blob_id,) in db.execute('SELECT id FROM blobs WHERE owner=? AND created<?', (owner, now - ORPHAN_SECONDS))
                     if blob_id not in used]
            for blob_id in stale:
                db.execute('DELETE FROM blobs WHERE owner=? AND id=?', (owner, blob_id))
    for blob_id in stale:
        (_folder(owner) / blob_id).unlink(missing_ok=True)
    return len(stale)


def purge_owner(owner):
    """Account deletion: every item, the profile and every photo go away."""
    if _connection is None and not _database_path().exists():
        return  # nothing was ever stored, and an empty store is not created for it
    with _lock:
        db = _database()
        with db:
            for table in ('items', 'profile', 'blobs'):
                db.execute(f'DELETE FROM {table} WHERE owner=?', (owner,))
    try:
        shutil.rmtree(_folder(owner), ignore_errors=True)
    except HTTPException:
        pass
