"""Refuse a paid look before reserving quota when the FASHN balance is gone.

Without this the credits run out silently: every user gets a generic failure
after waiting for the provider. The balance is cached for a few minutes and
the check is fail-open — an unreachable billing endpoint must not stop
generation on its own. Enabled with FASHN_CREDITS_GUARD=1.
"""
import os
import threading
import time

import httpx

_LOCK = threading.Lock()
_cache = {'at': 0.0, 'credits': None}
TTL_SECONDS = 300
ERROR = 'Примерочная временно недоступна: закончился баланс генерации. Попробуй позже.'


def enabled():
    return os.getenv('FASHN_CREDITS_GUARD', '').strip().lower() in ('1', 'true', 'yes')


def balance(token, force=False):
    """Total credits or None when unknown. Never raises."""
    with _LOCK:
        if not force and time.time() - _cache['at'] < TTL_SECONDS:
            return _cache['credits']
    credits = None
    try:
        response = httpx.get('https://api.fashn.ai/v1/credits', headers={'Authorization': f'Bearer {token}'}, timeout=10, trust_env=False)
        if response.status_code < 400:
            value = (response.json().get('credits') or {}).get('total')
            credits = int(value) if isinstance(value, (int, float)) else None
    except Exception as exc:
        print(f'FASHN credits check unavailable: {type(exc).__name__}', flush=True)
    with _LOCK:
        _cache.update(at=time.time(), credits=credits)
    return credits


def sufficient(token, needed):
    """`needed` is the credit price of the job (see tryon_policy.CREDITS)."""
    if not enabled():
        return True
    credits = balance(token)
    if credits is None:
        return True
    if credits < needed:
        print(f'FASHN credits low: {credits} < {needed}', flush=True)
        return False
    return True


def reset_for_tests():
    with _LOCK:
        _cache.update(at=0.0, credits=None)
