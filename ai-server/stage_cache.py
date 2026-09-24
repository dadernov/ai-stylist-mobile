"""Intermediate try-on frames, so the same layers are not paid for twice.

A look is dressed layer by layer — bottom, shoes, top, outerwear — and each
layer goes onto the result of the previous one. The frame after "bottom +
shoes + top" does not depend on which jacket goes on next, and people usually
try several jackets over the same base. Without this cache every new jacket
paid again for all the layers underneath it.

The key is the chain of inputs, not outputs: the person photo, the quality
profile and, for every layer, its garment and instruction. The value is one
concrete generation of that chain; any of them is a valid base for the layers
that follow.

Frames live for at most a day. That is not a tunable but a promise from the
privacy policy ("try-on results are deleted after 24 hours"): the frames show
the person's body, and keeping them longer would break the published policy.
The age counts from creation — reading a frame never extends its life.
"""
import hashlib
import os
import shutil
import tempfile
import threading
import time
from pathlib import Path

POLICY_MAX_SECONDS = 24 * 60 * 60
_LOCK = threading.Lock()


def _root():
    return Path(os.getenv('AI_STAGE_CACHE_DIR', Path(__file__).parent / 'stage-cache'))


def ttl_seconds():
    try:
        configured = int(os.getenv('AI_STAGE_CACHE_TTL_SECONDS', str(POLICY_MAX_SECONDS)))
    except ValueError:
        configured = POLICY_MAX_SECONDS
    return max(0, min(POLICY_MAX_SECONDS, configured))


def max_bytes():
    try:
        return max(0, int(os.getenv('AI_STAGE_CACHE_MAX_BYTES', str(512 * 1024 * 1024))))
    except ValueError:
        return 512 * 1024 * 1024


def _owner_dir(owner):
    # A login may contain dots; a digest can never escape the cache root.
    return _root() / hashlib.sha256(owner.encode('utf-8')).hexdigest()[:24]


def chain_keys(profile_key, person_digest, stages):
    """One key per layer: keys[i] identifies the frame after stages[0..i].

    `stages` is a list of (slot, reference_digest, prompt).
    """
    hasher = hashlib.sha256()
    hasher.update(f'{profile_key}\0{person_digest}'.encode('utf-8'))
    keys = []
    for slot, reference_digest, prompt in stages:
        hasher.update(f'\0{slot}\0{reference_digest}\0'.encode('utf-8'))
        hasher.update(hashlib.sha256(prompt.encode('utf-8')).digest())
        keys.append(hasher.copy().hexdigest())
    return keys


def _expired(path, now):
    try:
        return now - path.stat().st_mtime > ttl_seconds()
    except FileNotFoundError:
        return True


def _read(owner, key, now):
    path = _owner_dir(owner) / key
    if _expired(path, now):
        path.unlink(missing_ok=True)
        return None
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return None


def lookup(owner, keys):
    """The deepest cached *proper* prefix of the chain: (depth, frame bytes).

    The full chain is never served from here. A new job with the same garments
    means the user wants another variant, so at least the outermost layer is
    always generated anew; to redo every layer the caller skips lookup.
    """
    if ttl_seconds() == 0:
        return 0, None
    now = time.time()
    for depth in range(len(keys) - 1, 0, -1):
        data = _read(owner, keys[depth - 1], now)
        if data:
            return depth, data
    return 0, None


def store(owner, key, data):
    if ttl_seconds() == 0 or not data:
        return
    directory = _owner_dir(owner)
    with _LOCK:
        directory.mkdir(parents=True, exist_ok=True)
        # Written aside and renamed: a reader never sees half a frame.
        handle, temporary = tempfile.mkstemp(dir=directory, prefix='.tmp-')
        try:
            with os.fdopen(handle, 'wb') as out:
                out.write(data)
            os.replace(temporary, directory / key)
        except BaseException:
            Path(temporary).unlink(missing_ok=True)
            raise
    prune()


def prune():
    """Drop expired frames, then the oldest ones above the size cap."""
    root = _root()
    if not root.exists():
        return
    now = time.time()
    with _LOCK:
        entries = []
        for path in root.glob('*/*'):
            if path.name.startswith('.tmp-'):
                # A crash between write and rename leaves one of these behind.
                if now - path.stat().st_mtime > 3600:
                    path.unlink(missing_ok=True)
                continue
            try:
                stat = path.stat()
            except FileNotFoundError:
                continue
            if now - stat.st_mtime > ttl_seconds():
                path.unlink(missing_ok=True)
            else:
                entries.append((stat.st_mtime, stat.st_size, path))
        total = sum(size for _, size, _ in entries)
        for _, size, path in sorted(entries):
            if total <= max_bytes():
                break
            path.unlink(missing_ok=True)
            total -= size
        for directory in root.iterdir():
            if directory.is_dir() and not any(directory.iterdir()):
                directory.rmdir()


def purge_owner(owner):
    """Account deletion: every stored frame of this person goes away."""
    with _LOCK:
        shutil.rmtree(_owner_dir(owner), ignore_errors=True)
