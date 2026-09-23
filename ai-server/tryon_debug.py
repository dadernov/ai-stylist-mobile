"""Opt-in, owner-scoped one-shot diagnostics; never part of generation correctness.

Deletion resumes on restart. A host-level expiry timer is required if retention
must remain bounded while the service is stopped or its configuration removed.
"""
import contextlib
import hashlib
import hmac
import io
import json
import math
import os
import re
import stat
import threading
import time

from PIL import Image

MAX_SOURCE_BYTES = 15 * 1024 * 1024
MAX_RAW_BYTES = 25 * 1024 * 1024
MAX_AGE_SECONDS = 30 * 60
_CLAIM = '.tryon-debug-claim-v1.json'
_CASE = re.compile(r'case-[0-9a-f]{64}\Z')
_FILES = ('source.image', 'raw.png', 'manifest.json')
_DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


@contextlib.contextmanager
def _root(path, create=False):
    if not isinstance(path, str) or not path.startswith('/'):
        raise ValueError('Invalid diagnostic directory')
    parts = path.split('/')[1:]
    if not parts or any(part in ('', '.', '..') for part in parts):
        raise ValueError('Invalid diagnostic directory')
    descriptor = os.open('/', _DIRECTORY_FLAGS)
    try:
        for index, part in enumerate(parts):
            try:
                child = os.open(part, _DIRECTORY_FLAGS, dir_fd=descriptor)
            except FileNotFoundError:
                if not create or index != len(parts) - 1:
                    raise
                os.mkdir(part, 0o700, dir_fd=descriptor)
                child = os.open(part, _DIRECTORY_FLAGS, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        info = os.fstat(descriptor)
        if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise ValueError('Diagnostic directory must be private')
        yield descriptor
    finally:
        os.close(descriptor)


def _write(directory, name, data):
    descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
    with os.fdopen(descriptor, 'wb') as target:
        target.write(data)


def _manifest(directory):
    descriptor = os.open('manifest.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
    with os.fdopen(descriptor, 'rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_size > 1024:
            raise ValueError('Invalid diagnostic manifest')
        value = json.loads(source.read(1025))
    created, expires = value['created'], value['expires']
    if value.get('version') != 1 or not all(type(t) in (int, float) and math.isfinite(t) for t in (created, expires)):
        raise ValueError('Invalid diagnostic expiry')
    if not created <= expires <= created + MAX_AGE_SECONDS:
        raise ValueError('Invalid diagnostic expiry')
    return expires


def _cleanup_case(path, name, *, now=None, force=False):
    """Only remove this module's regular files, without following links."""
    if not _CASE.fullmatch(name):
        return
    try:
        with _root(path) as root:
            directory = os.open(name, _DIRECTORY_FLAGS, dir_fd=root)
            try:
                info = os.fstat(directory)
                if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
                    return
                try:
                    expiry = _manifest(directory)
                except (OSError, ValueError, KeyError, TypeError):
                    expiry = 0
                if not force and expiry > (time.time() if now is None else now):
                    return
                for filename in _FILES:
                    try:
                        info = os.stat(filename, dir_fd=directory, follow_symlinks=False)
                        if stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid():
                            os.unlink(filename, dir_fd=directory)
                    except FileNotFoundError:
                        pass
            finally:
                os.close(directory)
            try:
                os.rmdir(name, dir_fd=root)
            except OSError:
                pass
    except Exception:
        pass


def _schedule(path, name, expiry):
    timer = threading.Timer(max(0, expiry - time.time()), _cleanup_case, args=(path, name), kwargs={'force': True})
    timer.daemon = True
    timer.start()


def cleanup():
    """Resume deletion timers after a restart, including expired capture windows."""
    path = os.environ.get('AI_TRYON_DEBUG_DIR')
    if not path:
        return
    try:
        now = time.time()
        with _root(path) as root:
            for name in os.listdir(root):
                if not _CASE.fullmatch(name):
                    continue
                try:
                    directory = os.open(name, _DIRECTORY_FLAGS, dir_fd=root)
                    try:
                        expiry = _manifest(directory)
                    finally:
                        os.close(directory)
                except (OSError, ValueError, KeyError, TypeError):
                    expiry = 0
                if expiry <= now:
                    _cleanup_case(path, name, now=now)
                else:
                    try:
                        _schedule(path, name, min(expiry, now + MAX_AGE_SECONDS))
                    except Exception:
                        _cleanup_case(path, name, force=True)
    except Exception:
        pass


class _BoundedBuffer(io.BytesIO):
    def write(self, data):
        if self.tell() + len(data) > MAX_RAW_BYTES:
            raise ValueError('Diagnostic image exceeds limit')
        return super().write(data)


def capture(owner: str, job_id: str, source_content: bytes, raw_image: Image.Image) -> None:
    """Best-effort capture(bytes, PIL image); never logs identity or raises."""
    path = os.environ.get('AI_TRYON_DEBUG_DIR')
    created_case = None
    try:
        expected = os.environ.get('AI_TRYON_DEBUG_OWNER_SHA256', '')
        now = time.time()
        until = float(os.environ.get('AI_TRYON_DEBUG_UNTIL', '0'))
        if not path or not re.fullmatch(r'[0-9a-f]{64}', expected) or not math.isfinite(until) or not now < until <= now + MAX_AGE_SECONDS:
            return
        if not isinstance(owner, str) or not isinstance(job_id, str) or not 0 < len(job_id) <= 512:
            return
        if not hmac.compare_digest(hashlib.sha256(owner.encode()).hexdigest(), expected):
            return
        if not isinstance(source_content, bytes) or not 0 < len(source_content) <= MAX_SOURCE_BYTES:
            return
        if not isinstance(raw_image, Image.Image) or not 0 < raw_image.width * raw_image.height <= 32_000_000:
            return
        with _root(path, create=True) as root:
            try:
                os.stat(_CLAIM, dir_fd=root, follow_symlinks=False)
                return
            except FileNotFoundError:
                pass
            with _BoundedBuffer() as buffer:
                raw_image.save(buffer, format='PNG')
                encoded = buffer.getvalue()
            if time.time() >= until:
                return
            name = 'case-' + hashlib.sha256(job_id.encode()).hexdigest()
            expiry = min(until, now + MAX_AGE_SECONDS)
            metadata = json.dumps({'version': 1, 'created': now, 'expires': expiry}).encode()
            _write(root, _CLAIM, metadata)
            os.mkdir(name, 0o700, dir_fd=root)
            created_case = name
            directory = os.open(name, _DIRECTORY_FLAGS, dir_fd=root)
            try:
                _write(directory, 'manifest.json', metadata)
                _write(directory, 'source.image', source_content)
                _write(directory, 'raw.png', encoded)
            finally:
                os.close(directory)
        _schedule(path, name, expiry)
    except Exception:
        if created_case:
            _cleanup_case(path, created_case, force=True)


cleanup()
