"""What users tell the models by what they do, kept to train them further (tools/training).

Category: when an item is saved, the category the user settled on for the photo /analyze read, with that photo's
embedding (768 numbers from the encoder; the photo itself is not kept) and what the model had proposed. A correction
is the most valuable example there is: the app's own photos, labelled by the person who owns the garment.

Looks: an idea saved, tried on or put aside, with its pieces' style vectors and the situation it was built for.

Owners are stored as a hash of the login, and an account's rows go with the account (purge_owner).
"""
import hashlib
import json
import os
import sqlite3
import threading
import time
from collections import OrderedDict
from pathlib import Path

import numpy as np

_lock = threading.Lock()
_connection = None
# Embeddings of recent analyses, until the item is saved: analysis id -> (embedding, proposed category, unsure, time).
_pending = OrderedDict()
PENDING_LIMIT = 2000
PENDING_SECONDS = 24 * 3600


def _path():
    return Path(os.getenv('AI_FEEDBACK_DB', Path(__file__).parent / 'feedback.sqlite3'))


def _database():
    global _connection
    if _connection is None:
        path = _path()
        path.parent.mkdir(parents=True, exist_ok=True)
        _connection = sqlite3.connect(str(path), check_same_thread=False)
        _connection.executescript("""
            CREATE TABLE IF NOT EXISTS category_feedback (owner TEXT NOT NULL, analysis TEXT NOT NULL, embedding BLOB NOT NULL,
                proposed TEXT, chosen TEXT NOT NULL, unsure INTEGER NOT NULL, created REAL NOT NULL, PRIMARY KEY(owner, analysis));
            CREATE TABLE IF NOT EXISTS look_feedback (owner TEXT NOT NULL, action TEXT NOT NULL, data TEXT NOT NULL, created REAL NOT NULL);
        """)
        _connection.commit()
    return _connection


def owner_key(login):
    return hashlib.sha256(f'feedback:{login}'.encode()).hexdigest()[:32]


def remember_analysis(analysis_id, embedding, proposed, unsure):
    """Keep a fresh analysis's embedding until its item is saved."""
    with _lock:
        now = time.time()
        _pending[analysis_id] = (np.asarray(embedding, dtype=np.float16).tobytes(), proposed, bool(unsure), now)
        _pending.move_to_end(analysis_id)
        while len(_pending) > PENDING_LIMIT or (_pending and now - next(iter(_pending.values()))[3] > PENDING_SECONDS):
            _pending.popitem(last=False)


def category_chosen(login, analysis_id, chosen):
    """The category the user saved the analysed photo under; False when that analysis is no longer known."""
    with _lock:
        entry = _pending.get(analysis_id)
        if entry is None:
            return False
        embedding, proposed, unsure, _ = entry
        db = _database()
        with db:
            db.execute('INSERT OR REPLACE INTO category_feedback VALUES (?, ?, ?, ?, ?, ?, ?)',
                       (owner_key(login), analysis_id, embedding, proposed, chosen, int(unsure), time.time()))
    return True


def look_action(login, action, data):
    with _lock:
        db = _database()
        with db:
            db.execute('INSERT INTO look_feedback VALUES (?, ?, ?, ?)',
                       (owner_key(login), action, json.dumps(data, ensure_ascii=False), time.time()))


def purge_owner(login):
    """Account deletion: the account's examples go too."""
    if _connection is None and not _path().exists():
        return
    with _lock:
        db = _database()
        with db:
            for table in ('category_feedback', 'look_feedback'):
                db.execute(f'DELETE FROM {table} WHERE owner=?', (owner_key(login),))


def reset_state_for_tests():
    global _connection
    with _lock:
        if _connection is not None:
            _connection.close()
        _connection = None
        _pending.clear()
