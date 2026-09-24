"""Layer reuse and draft/final pricing through the real try-on endpoint.

The provider is faked; everything between the request and the provider call —
planning, the layer cache, budget reservation and refunds — is the real code.
"""
import os
import tempfile
import unittest
from io import BytesIO
from unittest.mock import AsyncMock, patch

from fastapi import UploadFile
from PIL import Image

import access
import accounts
import app
import stage_cache
import tryon_policy

FINAL = tryon_policy.profile('final').credits
DRAFT = tryon_policy.profile('draft').credits


def photo(color):
    data = BytesIO()
    Image.new('RGB', (80, 160), color).save(data, format='PNG')
    data.seek(0)
    return UploadFile(file=data, filename='photo.png')


class LayerReuse(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            'AI_QUOTA_DB': self.temp.name + '/quota.sqlite3',
            'AI_ACCOUNTS_DB': self.temp.name + '/accounts.sqlite3',
            'AI_STAGE_CACHE_DIR': self.temp.name + '/stages',
            'FASHN_API_KEY': 'test', 'AI_DAILY_CREDITS': '200', 'AI_GLOBAL_DAILY_CREDITS': '1000',
            'AI_MAX_ACTIVE_TRYONS': '10',
        })
        self.env.start()
        access.reset_state_for_tests()
        accounts.reset_state_for_tests()
        app._TRYON_LOOK_INFLIGHT.clear()
        self.calls = 0

        async def provider(*args, **kwargs):
            self.calls += 1
            return {'status': 'succeeded', 'outputUrl': f'https://provider.test/frame-{self.calls}.png'}

        async def download(_client, url):
            # A distinct frame per provider call, so a reused frame is recognisable.
            shade = int(url.rsplit('-', 1)[-1].split('.')[0]) * 20 if 'frame-' in url else 0
            return Image.new('RGB', (64, 128), (shade % 256, 90, 140))

        self.provider = AsyncMock(side_effect=provider)
        self.protect = AsyncMock(return_value='data:image/png;base64,protected')
        self.patches = [
            patch.object(app, '_prepare_identity_source', return_value='prepared'),
            patch.object(app, '_run_fashn_tryon_with_category_fallback', self.provider),
            patch.object(app, '_face_locked_output_url', self.protect),
            patch.object(app, '_load_image_from_url_or_data_url', AsyncMock(side_effect=download)),
            patch.object(app, '_stage_preview_url', return_value='data:image/jpeg;base64,preview'),
            patch.object(app.access, 'throttle'),
        ]
        for item in self.patches:
            item.start()
        self.request = 0

    def tearDown(self):
        for item in self.patches:
            item.stop()
        access.reset_state_for_tests()
        accounts.reset_state_for_tests()
        self.env.stop()
        self.temp.cleanup()

    async def look(self, outer='navy', quality='quality', fresh='false', person='white', bottom='blue', top='red', device='masha'):
        self.request += 1
        return await app.tryon_generate_look(
            person_file=photo(person), top_file=photo(top) if top else None, bottom_file=photo(bottom) if bottom else None,
            shoes_file=None, outer_file=photo(outer) if outer else None,
            tuck_mode='auto', compare_mode='false', quality_mode=quality,
            top_category='Футболка', outer_category='Куртка' if outer else '',
            request_id=f'request_{self.request:012d}', async_mode='false', fresh=fresh, device=device)

    async def test_a_new_jacket_over_the_same_base_pays_only_for_the_jacket(self):
        first = await self.look(outer='navy')
        self.assertEqual(first['status'], 'succeeded', first)
        self.assertEqual(first['layersReused'], 0)
        self.assertEqual(self.calls, 3)

        second = await self.look(outer='olive')
        self.assertEqual(second['status'], 'succeeded', second)
        self.assertEqual(self.calls, 4, 'bottom and top came from the first look')
        self.assertEqual(second['layersReused'], 2)
        self.assertEqual(second['creditsCharged'], FINAL)
        self.assertEqual(access.spent_today('masha'), 3 * FINAL + FINAL)
        # Dressing continues on the stored frame, sent as a photo, not a provider URL.
        self.assertTrue(self.provider.call_args_list[-1].args[3].startswith('data:image/jpeg'))
        self.assertEqual([step['step'] for step in second['steps']], ['bottom', 'top', 'outer'])
        self.assertEqual([step['result']['status'] for step in second['steps'][:2]], ['reused', 'reused'])

    async def test_the_same_garments_again_redo_only_the_outermost_layer(self):
        await self.look(outer='navy')
        again = await self.look(outer='navy')
        self.assertEqual(self.calls, 4)
        self.assertEqual(again['layersReused'], 2)

    async def test_fresh_redoes_every_layer(self):
        # The user disliked the result; any layer may be the culprit.
        await self.look(outer='navy')
        again = await self.look(outer='navy', fresh='true')
        self.assertEqual(self.calls, 6)
        self.assertEqual(again['layersReused'], 0)
        self.assertEqual(again['creditsCharged'], 3 * FINAL)

    async def test_fresh_result_becomes_the_base_for_later_looks(self):
        await self.look(outer='navy')                 # frames 1-3
        await self.look(outer='navy', fresh='true')   # frames 4-6 replace them
        await self.look(outer='olive')
        reused = self.provider.call_args_list[-1].args[3]
        red = Image.open(BytesIO(app._data_url_to_bytes(reused)[0])).convert('RGB').getpixel((32, 64))[0]
        # Frame N is drawn with red = 20·N: the base must be the fresh top layer
        # (frame 5, red 100), not the one it replaced (frame 2, red 40).
        self.assertAlmostEqual(red, 100, delta=6)

    async def test_a_draft_costs_one_credit_per_layer_and_reuses_drafts(self):
        first = await self.look(quality='fast')
        self.assertEqual(first['creditsCharged'], 3 * DRAFT)
        second = await self.look(outer='olive', quality='fast')
        self.assertEqual(second['layersReused'], 2)
        self.assertEqual(access.spent_today('masha'), 3 * DRAFT + DRAFT)

    async def test_a_final_never_builds_on_draft_layers(self):
        await self.look(quality='fast')
        final = await self.look(quality='quality')
        self.assertEqual(final['layersReused'], 0)
        self.assertEqual(final['creditsCharged'], 3 * FINAL)

    async def test_another_photo_of_the_person_starts_from_scratch(self):
        await self.look(person='white')
        other = await self.look(person='gray', outer='olive')
        self.assertEqual(other['layersReused'], 0)

    async def test_layers_are_private_to_the_account(self):
        await self.look(device='masha')
        other = await self.look(device='petya', outer='olive')
        self.assertEqual(other['layersReused'], 0)

    async def test_an_unlocked_result_does_not_seed_later_looks(self):
        rejected = app.AlignmentRejected('no lock', Image.new('RGB', (64, 128), 'green'))
        with patch.object(app, '_face_locked_output_url', AsyncMock(side_effect=rejected)), \
             patch.object(app, '_unlocked_output_url', return_value='data:image/png;base64,unlocked'):
            first = await self.look(outer='navy')
        self.assertFalse(first['identityLocked'])
        second = await self.look(outer='olive')
        self.assertEqual(second['layersReused'], 0, 'a frame that could not be aligned must not spread')

    async def test_a_failed_look_caches_nothing(self):
        async def failing(*args, **kwargs):
            self.calls += 1
            if self.calls == 2:
                return {'error': 'provider down'}
            return {'status': 'succeeded', 'outputUrl': f'https://provider.test/frame-{self.calls}.png'}
        self.provider.side_effect = failing
        failed = await self.look(outer='navy')
        self.assertEqual(failed['status'], 'failed')
        self.provider.side_effect = None
        self.provider.return_value = {'status': 'succeeded', 'outputUrl': 'https://provider.test/frame-9.png'}
        second = await self.look(outer='olive')
        self.assertEqual(second['layersReused'], 0)

    async def test_a_broken_cache_never_fails_the_paid_look(self):
        with patch.object(stage_cache, 'store', side_effect=OSError('disk full')):
            result = await self.look()
        self.assertEqual(result['status'], 'succeeded')

    async def test_single_garment_looks_are_never_served_from_the_cache(self):
        await self.look(outer=None, bottom=None)
        again = await self.look(outer=None, bottom=None)
        self.assertEqual(again['layersReused'], 0)
        self.assertEqual(self.calls, 2)

    async def test_the_reused_base_is_shown_before_the_first_new_layer(self):
        await self.look(outer='navy')
        published = []
        with patch.object(app.jobs, 'progress', side_effect=lambda owner, job_id, payload: published.append(payload['progress'])):
            await self.look(outer='olive')
        first = published[0]
        self.assertEqual(first['done'], ['bottom', 'top'])
        self.assertEqual(first['stage'], 'outer')
        self.assertIn('previewUrl', first)

    async def test_account_deletion_removes_cached_layers(self):
        await self.look(outer='navy')
        self.assertTrue(any(stage_cache._owner_dir('masha').iterdir()))
        await app.auth_delete_account(login='masha')
        self.assertFalse(stage_cache._owner_dir('masha').exists())


if __name__ == '__main__':
    unittest.main()
