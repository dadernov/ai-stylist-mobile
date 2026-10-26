import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi import HTTPException

import access
import accounts
import app
import fashn_credits
import jobs


class ReleaseGuards(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        os.environ['AI_QUOTA_DB'] = os.path.join(self.directory.name, 'quota.sqlite3')
        os.environ['AI_ACCOUNTS_DB'] = os.path.join(self.directory.name, 'accounts.sqlite3')
        os.environ['AI_CLIENT_TOKENS'] = 'good-token'
        access.reset_state_for_tests(); accounts.reset_state_for_tests(); access.reset_throttle_for_tests(); fashn_credits.reset_for_tests()
        self.token = accounts.register('masha', 'very-long-password')['token']

    def tearDown(self):
        access.reset_state_for_tests(); accounts.reset_state_for_tests(); access.reset_throttle_for_tests(); fashn_credits.reset_for_tests()
        for name in ('AI_QUOTA_DB', 'AI_ACCOUNTS_DB', 'AI_CLIENT_TOKENS', 'FASHN_CREDITS_GUARD'):
            os.environ.pop(name, None)
        self.directory.cleanup()

    async def test_account_deletion_removes_user_sessions_results_and_usage(self):
        jobs.start('masha', 'job-1', 'fp', 1)
        jobs.finish('masha', 'job-1', {'status': 'succeeded', 'outputUrl': 'data:image/png;base64,AA'})
        jobs.start('other', 'job-2', 'fp', 1)
        app._IDENTITY_SOURCES[b'masha-photo'] = [None, [], None, app._identity_now(), {'masha'}]
        app._IDENTITY_SOURCES[b'other-photo'] = [None, [], None, app._identity_now(), {'other'}]
        result = await app.auth_delete_account(login='masha')
        self.assertEqual(list(app._IDENTITY_SOURCES), [b'other-photo'], 'the photo kept for her looks is forgotten')
        app._IDENTITY_SOURCES.clear()
        self.assertEqual(result, {'deleted': True, 'login': 'masha'})
        self.assertIsNone(accounts.session_owner(self.token), 'sessions are revoked')
        self.assertIsNone(accounts.profile('masha'))
        self.assertIsNone(jobs.get('masha', 'job-1'), 'stored results are gone')
        self.assertEqual(access.spent_today('masha'), 0)
        self.assertIsNotNone(jobs.get('other', 'job-2'), 'other accounts are untouched')
        with self.assertRaises(HTTPException) as denied:
            access.require_account(authorization='Bearer good-token', x_session_token=self.token)
        self.assertEqual(denied.exception.status_code, 401)
        self.assertFalse((await app.auth_delete_account(login='masha'))['deleted'], 'a second call is harmless')

    def test_retention_sweep_drops_images_after_a_day_and_tombstones_after_90_days(self):
        import time
        jobs.start('masha', 'fresh', 'fp', 1); jobs.finish('masha', 'fresh', {'outputUrl': 'data:image/png;base64,AA'})
        jobs.start('masha', 'old', 'fp', 1); jobs.finish('masha', 'old', {'outputUrl': 'data:image/png;base64,BB'})
        now = time.time()
        self.assertEqual(jobs.expire(now + 2 * 3600)[0], 0)
        jobs.expire(now + 25 * 3600)
        self.assertEqual(jobs.get('masha', 'old')['result']['status'], 'expired', 'image removed, tombstone kept')
        jobs.expire(now + 91 * 86400)
        self.assertIsNone(jobs.get('masha', 'old'))

    def test_provider_inputs_never_carry_exif_location(self):
        import base64
        from io import BytesIO
        from PIL import Image
        image = Image.new('RGB', (64, 128), 'red')
        exif = Image.Exif(); exif[0x8825] = {2: (55.0, 45.0, 0.0)}
        buffer = BytesIO(); image.save(buffer, format='JPEG', exif=exif.tobytes())
        for url in (app._prepare_tryon_image_data_url(buffer.getvalue(), 'image/jpeg', 2048, 90),
                    app._prepare_provider_frame(buffer.getvalue(), 2048, 90)):
            sent = Image.open(BytesIO(base64.b64decode(url.split(',', 1)[1])))
            self.assertNotIn(0x8825, sent.getexif())
        with self.assertRaises(ValueError):
            app._prepare_tryon_image_data_url(b'not an image', 'image/jpeg', 2048, 90)

    def test_per_account_throttle_is_independent_of_ip(self):
        for _ in range(3):
            access.throttle('masha', 'tryon', 3)
        with self.assertRaises(HTTPException) as limited:
            access.throttle('masha', 'tryon', 3)
        self.assertEqual(limited.exception.status_code, 429)
        access.throttle('other', 'tryon', 3)
        access.throttle('masha', 'analyze', 3)

    def test_credits_guard_is_opt_in_fail_open_and_blocks_only_when_short(self):
        with patch.object(fashn_credits, 'balance') as balance:
            self.assertTrue(fashn_credits.sufficient('key', 3))
            balance.assert_not_called()
            os.environ['FASHN_CREDITS_GUARD'] = '1'
            balance.return_value = None
            self.assertTrue(fashn_credits.sufficient('key', 3), 'unknown balance never blocks')
            balance.return_value = 11
            # A three-layer final costs 3 x 4 = 12 credits; the same draft costs 3.
            self.assertFalse(fashn_credits.sufficient('key', 12), '11 credits cannot pay a three-layer final')
            self.assertTrue(fashn_credits.sufficient('key', 3), 'but they pay the same look as a draft')

    async def test_look_is_refused_before_reserving_quota_when_balance_is_short(self):
        os.environ['FASHN_CREDITS_GUARD'] = '1'
        from io import BytesIO
        from PIL import Image
        from fastapi import UploadFile
        def upload():
            data = BytesIO(); Image.new('RGB', (80, 160), 'white').save(data, format='PNG'); data.seek(0)
            return UploadFile(file=data, filename='photo.png')
        with patch.dict(os.environ, {'FASHN_API_KEY': 'test-key'}), patch.object(fashn_credits, 'balance', return_value=3), \
             patch.object(app, '_prepare_identity_source') as prepare:
            result = await app.tryon_generate_look(person_file=upload(), top_file=upload(), bottom_file=None, shoes_file=None, outer_file=None,
                tuck_mode='auto', compare_mode='false', quality_mode='quality', top_category='Футболка', outer_category='',
                request_id='request_000000000001', async_mode='true', device='masha')
        self.assertEqual(result.get('error'), fashn_credits.ERROR)
        prepare.assert_not_called()
        self.assertEqual(access.spent_today('masha'), 0)


if __name__ == '__main__':
    unittest.main()
