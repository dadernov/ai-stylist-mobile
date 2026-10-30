import os
import re
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException

import access
import app


class Response:
    def __init__(self, status, text):
        self.status_code = status
        self.text = text

    def json(self):
        return {}


class ProviderErrorsStayServerSide(unittest.IsolatedAsyncioTestCase):
    SECRET = 'body-with-secret-key fa-XYZ'

    async def test_create_failure_hides_provider_body(self):
        client = MagicMock()
        client.post = AsyncMock(return_value=Response(401, self.SECRET))
        with patch('builtins.print') as log:
            result = await app._run_fashn_tryon(client, 'token', 'tryon-v1.6', {'_poll_interval_seconds': 0})
        self.assertNotIn(self.SECRET, repr(result))
        self.assertIn('401', result['error'])
        self.assertNotIn(self.SECRET, repr(log.call_args_list))

    async def test_poll_failure_hides_provider_body(self):
        client = MagicMock()
        created = Response(200, '')
        created.json = lambda: {'id': 'p1', 'status': 'starting'}
        client.post = AsyncMock(return_value=created)
        client.get = AsyncMock(return_value=Response(500, self.SECRET))
        with patch('builtins.print'), patch.object(app.asyncio, 'sleep', AsyncMock()):
            result = await app._run_fashn_tryon(client, 'token', 'tryon-v1.6', {'_poll_interval_seconds': 0})
        self.assertNotIn(self.SECRET, repr(result))
        self.assertIn('500', result['error'])

    async def test_category_attempts_do_not_echo_provider_body(self):
        run = AsyncMock(return_value={'error': 'FASHN create failed (400)', 'detail': self.SECRET})
        with patch.object(app, '_run_fashn_tryon', run):
            result = await app._run_fashn_tryon_with_category_fallback(
                MagicMock(), 'token', 'tryon-v1.6', 'm', 'g', ['tops', 'auto'])
        self.assertNotIn(self.SECRET, repr(result))
        self.assertEqual(len(result['attempts']), 2)


class LookThrottleAndCache(unittest.TestCase):
    def setUp(self):
        access.reset_throttle_for_tests()

    def tearDown(self):
        access.reset_throttle_for_tests()

    def test_tryon_default_is_three_a_minute_per_account(self):
        source = Path(app.__file__).read_text()
        self.assertIn("_env_int('AI_TRYON_PER_MINUTE', 3)", source)
        for _ in range(3):
            access.throttle('masha', 'tryon', 3)
        with self.assertRaises(HTTPException) as caught:
            access.throttle('masha', 'tryon', 3)
        self.assertEqual(caught.exception.status_code, 429)
        access.throttle('dasha', 'tryon', 3)

    def test_cache_key_includes_owner(self):
        arguments = dict(person_content=b'p', top_content=b't', bottom_content=None, shoes_content=None,
                         outer_content=None, tuck_mode_normalized='auto', look_model_name='m', look_mode='q',
                         look_generation_mode='', base_prompt='b', quality_mode='quality')
        self.assertNotEqual(app._cache_key_for_tryon_look(owner='masha', **arguments),
                            app._cache_key_for_tryon_look(owner='dasha', **arguments))

    def test_endpoint_passes_owner_into_cache_key(self):
        source = Path(app.__file__).read_text()
        call = source[source.index('cache_key = _cache_key_for_tryon_look('):].split('\n        )', 1)[0]
        self.assertIn('owner=device', call)


class Defaults(unittest.TestCase):
    def test_active_tryons_default_two(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop('AI_MAX_ACTIVE_TRYONS', None)
            self.assertEqual(app._TryOnQueue.limit(), 2)

    def test_image_pixel_cap_fits_app_uploads(self):
        # The app downsizes to a 4096 px long side: 4096x3072 must still pass.
        self.assertLessEqual(app.MAX_IMAGE_PIXELS, 13_000_000)
        self.assertGreaterEqual(app.MAX_IMAGE_PIXELS, 4096 * 3072)

    def test_nginx_body_size(self):
        conf = (Path(app.__file__).parent / 'deploy' / 'nginx-wardrobe-ai.conf').read_text()
        server_level = re.findall(r'^    client_max_body_size (\S+);', conf, re.M)
        self.assertEqual(server_level, ['16m'])


if __name__ == '__main__':
    unittest.main()
