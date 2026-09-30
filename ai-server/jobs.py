"""Durable, account-scoped idempotency and budget reservations for try-on jobs.

Budgets are counted in FASHN credits, not in provider calls: a draft layer
costs one credit and a final one four, and counting calls would let drafts eat
the daily limit as if they were finals.
"""
import json
import os
import time

from fastapi import HTTPException

import access

_schema_connection = None


def _database():
    global _schema_connection
    db = access._database()
    if _schema_connection is not db:
        db.execute("""CREATE TABLE IF NOT EXISTS tryon_jobs (
            owner TEXT NOT NULL, id TEXT NOT NULL, fingerprint TEXT NOT NULL,
            day TEXT NOT NULL, reserved INTEGER NOT NULL, attempted INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL, result TEXT, created REAL NOT NULL, updated REAL NOT NULL,
            PRIMARY KEY(owner, id))""")
        db.commit()
        _schema_connection = db
    return db


def _get(db, owner, job_id):
    row = db.execute("SELECT fingerprint, status, result, created FROM tryon_jobs WHERE owner=? AND id=?",
                     (owner, job_id)).fetchone()
    if row is None:
        return None
    result = json.loads(row[2]) if row[2] else None
    if row[1] in ('succeeded', 'failed') and result is None:
        result = {'status': 'expired', 'error': 'Результат больше не хранится на сервере. Создай новую примерку.'}
    return {'fingerprint': row[0], 'status': row[1], 'result': result, 'created': row[3]}


def get(owner, job_id):
    with access._DB_LOCK:
        return _get(_database(), owner, job_id)


# Four layers at the most expensive tryon-max price (quality 4k, 5 credits).
MAX_JOB_CREDITS = 20


def start(owner, job_id, fingerprint, cost):
    """Return (created, job). Reservation and idempotency are one transaction."""
    if not 1 <= cost <= MAX_JOB_CREDITS:
        raise ValueError('Invalid job cost')
    with access._DB_LOCK:
        db = _database()
        db.execute('BEGIN IMMEDIATE')
        try:
            existing = _get(db, owner, job_id)
            if existing:
                if existing['fingerprint'] != fingerprint:
                    raise HTTPException(409, 'Этот запрос уже относится к другой примерке.')
                db.commit()
                return False, existing
            day = access._today()
            spent = db.execute('SELECT spent FROM usage WHERE device=? AND day=?', (owner, day)).fetchone()
            limit = access.daily_credits()
            if limit >= 0 and (spent[0] if spent else 0) + cost > limit:
                raise HTTPException(429, f'Для этой примерки недостаточно дневного лимита ({limit}). Попробуй завтра.')
            global_limit = access.global_daily_credits()
            total = db.execute('SELECT COALESCE(SUM(spent),0) FROM usage WHERE day=?', (day,)).fetchone()[0]
            if total + cost > global_limit:
                raise HTTPException(429, 'Дневной лимит сервиса исчерпан. Попробуй завтра.')
            # A look waits its turn instead of being refused (app._TryOnQueue runs
            # AI_MAX_ACTIVE_TRYONS at once); only a full queue or one person
            # holding several places turns a new one away.
            own = db.execute("SELECT COUNT(*) FROM tryon_jobs WHERE status='running' AND owner=?", (owner,)).fetchone()[0]
            per_user = max(1, int(os.getenv('AI_MAX_TRYONS_PER_USER', '3')))
            if own >= per_user:
                raise HTTPException(429, 'Слишком много примерок сразу. Дождись, пока одна из них закончится.')
            waiting = db.execute("SELECT COUNT(*) FROM tryon_jobs WHERE status='running'").fetchone()[0]
            if waiting >= max(1, int(os.getenv('AI_MAX_QUEUED_TRYONS', '40'))):
                raise HTTPException(429, 'Сейчас очень много примерок. Попробуй через пару минут.')
            db.execute('INSERT INTO usage(device,day,spent) VALUES(?,?,?) ON CONFLICT(device,day) DO UPDATE SET spent=spent+excluded.spent', (owner, day, cost))
            now = time.time()
            db.execute('INSERT INTO tryon_jobs(owner,id,fingerprint,day,reserved,status,created,updated) VALUES(?,?,?,?,?,?,?,?)',
                       (owner, job_id, fingerprint, day, cost, 'running', now, now))
            db.commit()
            return True, _get(db, owner, job_id)
        except BaseException:
            db.rollback()
            raise


def attempt(owner, job_id, credits=1):
    # Record before calling the provider: a timeout may still mean paid work.
    with access._DB_LOCK:
        db = _database()
        with db:
            changed = db.execute("UPDATE tryon_jobs SET attempted=attempted+?, updated=? WHERE owner=? AND id=? AND status='running' AND attempted+?<=reserved",
                                 (credits, time.time(), owner, job_id, credits)).rowcount
            if not changed:
                raise RuntimeError('Job has no reserved provider operation')


def progress(owner, job_id, payload):
    """Publish an intermediate state of a running job; finish() replaces it."""
    encoded = json.dumps({'status': 'processing', 'jobId': job_id, **payload}, ensure_ascii=False)
    with access._DB_LOCK:
        db = _database()
        with db:
            db.execute("UPDATE tryon_jobs SET result=?, updated=? WHERE owner=? AND id=? AND status='running'",
                       (encoded, time.time(), owner, job_id))


def finish(owner, job_id, result):
    encoded = json.dumps(result, ensure_ascii=False)
    with access._DB_LOCK:
        db = _database()
        with db:
            row = db.execute("SELECT day,reserved,attempted FROM tryon_jobs WHERE owner=? AND id=? AND status='running'", (owner, job_id)).fetchone()
            if row is None:
                return
            db.execute('UPDATE usage SET spent=MAX(0,spent-?) WHERE device=? AND day=?', (row[1] - row[2], owner, row[0]))
            # Retain idempotency tombstones; only large image payloads expire.
            db.execute("UPDATE tryon_jobs SET result=NULL WHERE status!='running' AND updated<?", (time.time() - 86400,))
            max_bytes = max(16 * 1024 * 1024, int(os.getenv('AI_JOB_RESULT_MAX_BYTES', str(256 * 1024 * 1024))))
            total = db.execute('SELECT COALESCE(SUM(length(CAST(result AS BLOB))),0) FROM tryon_jobs').fetchone()[0]
            for old_owner, old_id, size in db.execute('SELECT owner,id,length(CAST(result AS BLOB)) FROM tryon_jobs WHERE result IS NOT NULL ORDER BY updated').fetchall():
                if total + len(encoded.encode('utf-8')) <= max_bytes:
                    break
                db.execute('UPDATE tryon_jobs SET result=NULL WHERE owner=? AND id=?', (old_owner, old_id))
                total -= size
            db.execute('UPDATE tryon_jobs SET status=?,result=?,updated=? WHERE owner=? AND id=?',
                       ('succeeded' if result.get('outputUrl') else 'failed', encoded, time.time(), owner, job_id))


RESULT_TTL_SECONDS = 24 * 3600
TOMBSTONE_TTL_SECONDS = 90 * 86400


def expire(now=None):
    """Enforce the retention promised in the privacy policy on a timer, not only
    when another job finishes: images after 24 h, job tombstones after 90 days."""
    now = time.time() if now is None else now
    with access._DB_LOCK:
        db = _database()
        with db:
            images = db.execute("UPDATE tryon_jobs SET result=NULL WHERE status!='running' AND result IS NOT NULL AND updated<?",
                                (now - RESULT_TTL_SECONDS,)).rowcount
            tombstones = db.execute("DELETE FROM tryon_jobs WHERE status!='running' AND updated<?",
                                    (now - TOMBSTONE_TTL_SECONDS,)).rowcount
            db.execute("DELETE FROM usage WHERE day<?", (time.strftime('%Y-%m-%d', time.gmtime(now - TOMBSTONE_TTL_SECONDS)),))
    return images, tombstones


def purge_owner(owner):
    """Account deletion: stored results and usage rows of this owner go away."""
    with access._DB_LOCK:
        db = _database()
        with db:
            db.execute("DELETE FROM tryon_jobs WHERE owner=?", (owner,))
            db.execute("DELETE FROM usage WHERE device=?", (owner,))


def recover_interrupted():
    """Single-worker startup: never silently replay an uncertain paid operation."""
    with access._DB_LOCK:
        db = _database()
        rows = db.execute("SELECT owner,id FROM tryon_jobs WHERE status='running'").fetchall()
    for owner, job_id in rows:
        finish(owner, job_id, {'status': 'failed', 'error': 'Сервер перезапустился во время примерки. Незавершённые шаги возвращены в лимит; создай новую примерку.'})
