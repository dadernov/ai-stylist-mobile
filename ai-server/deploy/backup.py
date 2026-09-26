#!/opt/wardrobe/ai-server/.venv/bin/python
"""Daily SQLite backups (accounts + quota/jobs) with the online backup API.
Installed as /etc/cron.daily/wardrobe-backup. Keeps 14 days."""
import gzip
import os
import shutil
import sqlite3
import time
from pathlib import Path

TARGET = Path('/var/backups/wardrobe')
SOURCES = {'accounts': '/opt/wardrobe/ai-server/accounts.sqlite3', 'quota': '/opt/wardrobe/ai-server/quota.sqlite3'}
KEEP_DAYS = 14

day = time.strftime('%Y-%m-%d')
folder = TARGET / day
folder.mkdir(parents=True, exist_ok=True, mode=0o700)
for name, source in SOURCES.items():
    if not os.path.exists(source):
        continue
    raw = folder / f'{name}.sqlite3'
    with sqlite3.connect(source) as src, sqlite3.connect(raw) as dst:
        src.backup(dst)
    if name == 'quota':
        # Backups hold accounting only: try-on images never leave the 24 h window.
        with sqlite3.connect(raw) as copy:
            copy.execute("UPDATE tryon_jobs SET result=NULL")
            copy.commit()
            copy.execute("VACUUM")
    with open(raw, 'rb') as inp, gzip.open(f'{raw}.gz', 'wb') as out:
        shutil.copyfileobj(inp, out)
    raw.unlink()
    os.chmod(f'{raw}.gz', 0o600)
cutoff = time.time() - KEEP_DAYS * 86400
for old in TARGET.iterdir():
    if old.is_dir() and old.stat().st_mtime < cutoff:
        shutil.rmtree(old, ignore_errors=True)
print(f'wardrobe backup written to {folder}')
