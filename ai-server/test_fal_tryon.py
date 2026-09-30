"""A look in one fal call: the queue client, prices, and the real endpoint.

The fal queue is faked with httpx.MockTransport; in the endpoint tests the
call itself is faked and everything around it — budget, job, identity lock
hand-off — is the real code.
"""
import json
import os
import tempfile
import unittest
from io import BytesIO
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import UploadFile
from PIL import Image

import access
import accounts
import app
import fal_tryon


def queue(status_sequence, result=None, submit_status=200, submit_body=None, result_status=200):
    """A fake fal queue: submit, a few status polls, then the result."""
    calls = []
    statuses = list(status_sequence)

    def handler(request):
        calls.append((request.method, str(request.url), request.content))
        if request.method == 'POST':
            body = submit_body if submit_body is not None else {
                'request_id': 'req-1', 'status_url': 'https://queue.fal.run/app/requests/req-1/status',
                'response_url': 'https://queue.fal.run/app/requests/req-1', 'cancel_url': 'https://queue.fal.run/app/requests/req-1/cancel'}
            return httpx.Response(submit_status, json=body) if isinstance(body, dict) else httpx.Response(submit_status, text=body)
        if request.method == 'PUT':
            return httpx.Response(200, json={'status': 'CANCELLATION_REQUESTED'})
        if request.url.path.endswith('/status'):
            return httpx.Response(200, json=statuses.pop(0) if len(statuses) > 1 else statuses[0])
        return httpx.Response(result_status, json=result or {})
    return httpx.AsyncClient(transport=httpx.MockTransport(handler)), calls


class FalClient(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'FAL_KEY': 'key-123', 'TRYON_PROVIDER': 'fal'})
        self.env.start()

    def tearDown(self):
        self.env.stop()

    async def run_look(self, client, model='seedream-4.5', wait=None):
        return await fal_tryon.generate(client, fal_tryon.MODELS[model], 'data:image/jpeg;base64,person',
                                        ['data:image/jpeg;base64,top', 'data:image/jpeg;base64,bottom'],
                                        'dress the person', 7, max_wait_seconds=wait, poll_seconds=0)

    async def test_a_look_goes_through_the_queue_and_returns_the_image(self):
        client, calls = queue([{'status': 'IN_QUEUE'}, {'status': 'IN_PROGRESS'}, {'status': 'COMPLETED'}],
                              {'images': [{'url': 'https://fal.media/out.png'}], 'has_nsfw_concepts': [False]})
        result = await self.run_look(client)
        self.assertEqual(result['status'], 'succeeded', result)
        self.assertEqual(result['outputUrl'], 'https://fal.media/out.png')
        self.assertEqual(result['costUsd'], 0.04)
        method, url, body = calls[0]
        self.assertEqual((method, url), ('POST', 'https://queue.fal.run/fal-ai/bytedance/seedream/v4.5/edit'))
        sent = json.loads(body)
        self.assertEqual(sent['image_urls'][0], 'data:image/jpeg;base64,person', 'the photo is image 1')
        self.assertEqual(len(sent['image_urls']), 3)
        self.assertEqual((sent['num_images'], sent['max_images'], sent['seed']), (1, 1, 7))

    async def test_photos_are_not_kept_by_fal(self):
        seen = []

        def handler(request):
            seen.append(dict(request.headers))
            return httpx.Response(500, text='down')
        await self.run_look(httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        self.assertEqual(seen[0]['x-fal-store-io'], '0')
        self.assertEqual(json.loads(seen[0]['x-fal-object-lifecycle-preference']), {'expiration_duration_seconds': 3600})

    async def test_the_key_is_sent_as_fal_expects(self):
        seen = []

        def handler(request):
            seen.append(request.headers.get('authorization'))
            return httpx.Response(401, json={'detail': 'bad key'})
        result = await self.run_look(httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        self.assertEqual(seen, ['Key key-123'])
        self.assertIn('401', result['error'])
        self.assertEqual(fal_tryon.user_error(result), fal_tryon.FAILED_ERROR)

    async def test_an_empty_balance_is_reported_as_such(self):
        client, _ = queue([], submit_status=403, submit_body={'detail': 'User is locked. Reason: Exhausted balance.'})
        result = await self.run_look(client)
        self.assertTrue(result.get('balance'), result)
        self.assertEqual(fal_tryon.user_error(result), fal_tryon.BALANCE_ERROR)

    async def test_a_model_error_is_a_failure_not_an_image(self):
        client, _ = queue([{'status': 'COMPLETED', 'error': 'CUDA out of memory', 'error_type': 'runner'}])
        result = await self.run_look(client)
        self.assertIn('error', result)
        self.assertNotIn('outputUrl', result)

    async def test_a_safety_filtered_image_is_never_used(self):
        client, _ = queue([{'status': 'COMPLETED'}], {'images': [{'url': 'https://fal.media/black.png'}], 'has_nsfw_concepts': [True]})
        result = await self.run_look(client, model='flux2-klein-9b')
        self.assertTrue(result.get('blocked'), result)
        self.assertEqual(fal_tryon.user_error(result), fal_tryon.BLOCKED_ERROR)

    async def test_a_request_that_never_finishes_is_cancelled(self):
        client, calls = queue([{'status': 'IN_QUEUE'}])
        with patch.object(fal_tryon, '_now', side_effect=[0, 1000]):
            result = await self.run_look(client, wait=5)
        self.assertTrue(result.get('timeout'), result)
        self.assertIn(('PUT', 'https://queue.fal.run/app/requests/req-1/cancel'), [(m, u) for m, u, _ in calls])

    async def test_seedream_5_lite_is_not_sent_a_seed_it_does_not_take(self):
        client, calls = queue([{'status': 'COMPLETED'}], {'images': [{'url': 'https://fal.media/out.png'}]})
        result = await self.run_look(client, model='seedream-5-lite')
        self.assertEqual(result['costUsd'], 0.035)
        method, url, body = calls[0]
        self.assertEqual(url, 'https://queue.fal.run/fal-ai/bytedance/seedream/v5/lite/edit')
        sent = json.loads(body)
        self.assertNotIn('seed', sent)
        self.assertEqual((sent['image_size'], len(sent['image_urls'])), ('auto_2K', 3))

    async def test_bria_gets_its_own_fields_and_a_single_image(self):
        client, calls = queue([{'status': 'COMPLETED'}], {'image': {'url': 'https://fal.media/bria.png'}})
        result = await self.run_look(client, model='bria-tryon')
        self.assertEqual(result['outputUrl'], 'https://fal.media/bria.png')
        sent = json.loads(calls[0][2])
        self.assertEqual(sent['person_image_url'], 'data:image/jpeg;base64,person')
        self.assertEqual(len(sent['garment_image_urls']), 2)
        self.assertNotIn('image_urls', sent)


class Choice(unittest.TestCase):
    def test_disabled_without_the_provider_or_the_key(self):
        with patch.dict(os.environ, {'TRYON_PROVIDER': 'fal', 'FAL_KEY': ''}):
            self.assertFalse(fal_tryon.enabled())
        with patch.dict(os.environ, {'TRYON_PROVIDER': 'fashn', 'FAL_KEY': 'x'}):
            self.assertFalse(fal_tryon.enabled())
        with patch.dict(os.environ, {'TRYON_PROVIDER': 'fal', 'FAL_KEY': 'x'}):
            self.assertTrue(fal_tryon.enabled())

    def test_a_look_never_splits_into_several_calls(self):
        with patch.dict(os.environ, {'TRYON_FAL_MODEL': 'bria-tryon', 'TRYON_FAL_MANY_MODEL': 'seedream-4'}):
            self.assertEqual(fal_tryon.model_for('final', 3).key, 'bria-tryon')
            self.assertEqual(fal_tryon.model_for('final', 4).key, 'seedream-4', 'four garments exceed Bria')
        with patch.dict(os.environ, {'TRYON_FAL_MODEL': 'qwen-edit-2511', 'TRYON_FAL_MANY_MODEL': 'bria-tryon'}):
            self.assertEqual(fal_tryon.model_for('final', 4).key, fal_tryon.DEFAULT_MODEL, 'the fallback must fit too')

    def test_drafts_and_finals_can_use_different_editors(self):
        with patch.dict(os.environ, {'TRYON_FAL_MODEL': 'seedream-4.5', 'TRYON_FAL_DRAFT_MODEL': 'flux2-klein-9b'}):
            self.assertEqual(fal_tryon.model_for('draft', 2).key, 'flux2-klein-9b')
            self.assertEqual(fal_tryon.model_for('final', 2).key, 'seedream-4.5')
        with patch.dict(os.environ, {'TRYON_FAL_MODEL': 'unknown-model'}):
            self.assertEqual(fal_tryon.model_for('draft', 2).key, fal_tryon.DEFAULT_MODEL)

    def test_every_editor_stays_within_five_rubles_a_look(self):
        # 5 RUB at 84 RUB/$ is $0.059. The per-megapixel models are priced for
        # the most garments they accept, inputs included where fal bills them.
        for model in fal_tryon.MODELS.values():
            with self.subTest(model=model.key):
                self.assertLessEqual(fal_tryon.estimate_usd(model, min(model.max_garments, 4)), 0.059)
        self.assertEqual(fal_tryon.estimate_usd(fal_tryon.MODELS['flux2-klein-9b'], 3), 0.055)
        self.assertEqual(fal_tryon.estimate_usd(fal_tryon.MODELS['flux2-klein-9b'], 2), 0.044)
        self.assertEqual(fal_tryon.estimate_usd(fal_tryon.MODELS['qwen-edit-2511'], 2), 0.03)

    def test_the_output_follows_the_photo_it_was_sent(self):
        klein = fal_tryon.MODELS['flux2-klein-9b']
        for frame in ((1600, 2400), (1600, 2000), (1143, 2048)):
            with self.subTest(frame=frame):
                size = fal_tryon.output_size(klein, frame)
                self.assertAlmostEqual(size['width'] / size['height'], frame[0] / frame[1], delta=.02)
                self.assertLessEqual(size['width'] * size['height'], fal_tryon.MEGAPIXEL, 'billed as one megapixel')
                self.assertEqual((size['width'] % 16, size['height'] % 16), (0, 0))
        self.assertEqual(fal_tryon.output_size(fal_tryon.MODELS['seedream-5-lite'], (1600, 2400)), 'auto_2K')

    def test_the_output_keeps_the_provider_canvas(self):
        for model in fal_tryon.MODELS.values():
            size = fal_tryon.output_size(model)
            if isinstance(size, dict):
                with self.subTest(model=model.key):
                    self.assertAlmostEqual(size['width'] / size['height'], 24 / 43, delta=24 / 43 * .012)
                    self.assertEqual((size['width'] % 16, size['height'] % 16), (0, 0))


def photo(color):
    data = BytesIO()
    Image.new('RGB', (80, 160), color).save(data, format='PNG')
    data.seek(0)
    return UploadFile(file=data, filename='photo.png')


class Endpoint(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            'AI_QUOTA_DB': self.temp.name + '/quota.sqlite3',
            'AI_ACCOUNTS_DB': self.temp.name + '/accounts.sqlite3',
            'AI_STAGE_CACHE_DIR': self.temp.name + '/stages',
            'AI_DAILY_CREDITS': '200', 'AI_GLOBAL_DAILY_CREDITS': '1000', 'AI_MAX_ACTIVE_TRYONS': '10',
            'TRYON_PROVIDER': 'fal', 'FAL_KEY': 'key-123', 'FASHN_API_KEY': '',
        })
        self.env.start()
        access.reset_state_for_tests()
        accounts.reset_state_for_tests()
        app._TRYON_LOOK_INFLIGHT.clear()
        self.generate = AsyncMock(return_value={'status': 'succeeded', 'outputUrl': 'https://fal.media/look.png',
                                                'model': 'seedream-4.5', 'costUsd': 0.04})
        self.fashn = AsyncMock(side_effect=AssertionError('FASHN must not be called'))
        self.protect = AsyncMock(return_value='data:image/png;base64,protected')
        self.published = []
        self.patches = [
            patch.object(app, '_prepare_identity_source', return_value='prepared'),
            patch.object(app.fal_tryon, 'generate', self.generate),
            patch.object(app, '_run_fashn_tryon_with_category_fallback', self.fashn),
            patch.object(app.fashn_credits, 'sufficient', side_effect=AssertionError('no FASHN balance check')),
            patch.object(app, '_face_locked_output_url', self.protect),
            patch.object(app, '_load_image_from_url_or_data_url', AsyncMock(return_value=Image.new('RGB', (64, 128)))),
            patch.object(app.access, 'throttle'),
            patch.object(app.jobs, 'progress', side_effect=lambda owner, job_id, payload: self.published.append(payload['progress'])),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in self.patches:
            item.stop()
        access.reset_state_for_tests()
        accounts.reset_state_for_tests()
        self.env.stop()
        self.temp.cleanup()

    async def look(self, quality='quality', shoes=True, outer=True, request='request_000000000001'):
        return await app.tryon_generate_look(
            person_file=photo('white'), top_file=photo('red'), bottom_file=photo('blue'),
            shoes_file=photo('black') if shoes else None, outer_file=photo('navy') if outer else None,
            tuck_mode='tucked', compare_mode='false', quality_mode=quality,
            top_category='Футболка', outer_category='Тренч' if outer else '',
            request_id=request, async_mode='false', fresh='false', device='masha')

    async def test_the_whole_look_is_one_call_and_one_unit(self):
        result = await self.look()
        self.assertEqual(result['status'], 'succeeded', result)
        self.assertEqual(self.generate.await_count, 1)
        self.assertEqual(result['outputUrl'], 'data:image/png;base64,protected', 'only the locked frame is returned')
        self.assertEqual(result['modelUsed'], f'fal:{fal_tryon.DEFAULT_MODEL}')
        self.assertEqual(result['creditsCharged'], 1)
        self.assertEqual(access.spent_today('masha'), 1)
        self.assertEqual([step['step'] for step in result['steps']], ['outfit'])

    async def test_the_photo_comes_first_then_garments_in_prompt_order(self):
        await self.look()
        _client, model, person_url, garment_urls, prompt, _seed = self.generate.await_args.args
        self.assertEqual(model.key, fal_tryon.DEFAULT_MODEL)
        self.assertTrue(person_url.startswith('data:image/jpeg'))
        self.assertEqual(len(garment_urls), 4)
        for index, name in enumerate(('top: a t-shirt', 'lower-body garment', 'outerwear: a trench coat', 'pair of shoes'), start=2):
            self.assertIn(f'image {index} is the {name}', prompt)
        self.assertIn('Fully tuck the top', prompt)
        self.assertIn('never shorten it', prompt)

    async def test_the_identity_lock_gets_every_changed_slot(self):
        await self.look()
        changed = self.protect.await_args.args[3]
        self.assertEqual(changed, sorted(['top', 'bottom', 'shoes', 'long_outer']))

    async def test_progress_names_one_outfit_stage(self):
        await self.look(shoes=False, outer=False)
        self.assertEqual([entry['stage'] for entry in self.published], ['outfit', 'composite'])
        self.assertEqual(self.published[0]['total'], 1)

    async def test_an_empty_balance_fails_with_a_clear_message(self):
        self.generate.return_value = {'error': 'fal submit failed (403)', 'balance': True}
        result = await self.look()
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['error'], fal_tryon.BALANCE_ERROR)
        self.protect.assert_not_awaited()

    async def test_by_default_only_the_face_comes_from_the_photo(self):
        # Pasting the photo's floor back around a re-rendered body leaves seams;
        # the editor's scene is kept and only the face is restored.
        with patch.object(app, '_face_only_output_url', return_value='data:image/png;base64,face') as face_only:
            result = await self.look()
        self.assertEqual(result['outputUrl'], 'data:image/png;base64,face')
        self.protect.assert_not_awaited()
        self.assertEqual((result['identityLocked'], result['faceRestored']), (False, True))
        self.assertNotIn('warning', result)
        self.assertEqual(face_only.call_count, 1)

    async def test_when_the_face_does_not_fit_the_full_lock_is_tried(self):
        with patch.object(app, '_face_only_output_url', return_value=None):
            result = await self.look()
        self.assertEqual(result['outputUrl'], 'data:image/png;base64,protected')
        self.assertEqual((result['identityLocked'], result['faceRestored']), (True, False))

    async def test_scene_restore_can_be_brought_back(self):
        with patch.dict(os.environ, {'TRYON_FAL_RESTORE': 'scene'}), \
                patch.object(app, '_face_only_output_url', side_effect=AssertionError('face-only must be skipped')):
            result = await self.look()
        self.assertEqual(result['outputUrl'], 'data:image/png;base64,protected')

    async def test_a_moved_scene_still_gets_the_users_own_face(self):
        frame = Image.new('RGB', (64, 128))
        with patch.object(app, '_face_only_output_url', return_value=None), \
                patch.object(app, '_face_locked_output_url', AsyncMock(side_effect=app.AlignmentRejected('moved', frame))), \
                patch.object(app, '_face_restored_output_url', return_value='data:image/png;base64,restored') as restore:
            result = await self.look()
        self.assertEqual(result['outputUrl'], 'data:image/png;base64,restored')
        self.assertNotIn('warning', result, 'the face is the photo\'s own: nothing to warn about')
        self.assertEqual((result['identityLocked'], result['faceRestored']), (False, True))
        self.assertIs(restore.call_args.args[0], frame)

    async def test_when_even_the_face_does_not_fit_the_frame_comes_with_a_warning(self):
        frame = Image.new('RGB', (64, 128))
        with patch.object(app, '_face_only_output_url', return_value=None), \
                patch.object(app, '_face_locked_output_url', AsyncMock(side_effect=app.AlignmentRejected('moved', frame))), \
                patch.object(app, '_face_restored_output_url', return_value=None), \
                patch.object(app, '_unlocked_output_url', return_value='data:image/png;base64,unlocked'):
            result = await self.look()
        self.assertEqual(result['outputUrl'], 'data:image/png;base64,unlocked')
        self.assertEqual(result['warning'], app.UNLOCKED_WARNING)
        self.assertEqual((result['identityLocked'], result['faceRestored']), (False, False))

    async def layered_look(self, **extra):
        return await app.tryon_generate_look(
            person_file=photo('white'), top_file=photo('red'), bottom_file=photo('blue'), shoes_file=photo('black'),
            outer_file=photo('navy'), top2_file=photo('green'), outer2_file=extra.get('outer2', photo('gray')),
            tuck_mode='auto', compare_mode='false', quality_mode='quality', top_category='Футболка', outer_category='Пиджак',
            top2_category='Лонгслив', outer2_category='Плащ', request_id=extra.get('request', 'request_000000000009'),
            async_mode='false', fresh='false', device='masha')

    async def test_a_layered_look_is_one_call_by_default(self):
        result = await self.layered_look()
        self.assertEqual(result['status'], 'succeeded', result)
        self.assertEqual(self.generate.await_count, 1)
        self.assertEqual(len(self.generate.await_args.args[3]), 6)
        self.assertEqual(result['creditsCharged'], 1)

    async def test_the_layer_pass_puts_the_layers_over_the_base_look(self):
        os.environ['TRYON_FAL_LAYER_PASS'] = 'layered'
        self.generate.side_effect = [
            {'status': 'succeeded', 'outputUrl': 'https://fal.media/base.png', 'model': 'seedream-5-lite', 'costUsd': 0.035},
            {'status': 'succeeded', 'outputUrl': 'https://fal.media/layers.png', 'model': 'seedream-5-lite', 'costUsd': 0.035}]
        result = await self.layered_look()
        self.assertEqual(result['status'], 'succeeded', result)
        self.assertEqual(self.generate.await_count, 2)
        base_call, layer_call = self.generate.await_args_list
        self.assertEqual(len(base_call.args[3]), 3, 'the base is top, bottom and shoes')
        self.assertNotIn('outerwear', base_call.args[4])
        self.assertEqual(layer_call.args[2], 'https://fal.media/base.png', 'the layers go over the base look')
        self.assertEqual(len(layer_call.args[3]), 3)
        prompt = layer_call.args[4]
        self.assertIn('Put 3 extra layers on this person', prompt)
        self.assertIn('first a long-sleeve t-shirt from image 2, worn over a t-shirt', prompt)
        self.assertIn('then a blazer from image 3, unbuttoned and open over a long-sleeve t-shirt', prompt)
        self.assertIn('then a raincoat from image 4', prompt)
        self.assertIn('The garment in image 4 is long', prompt)
        self.assertEqual(result['creditsCharged'], 2)
        self.assertEqual(access.spent_today('masha'), 2)
        self.assertEqual([step['step'] for step in result['steps']], ['outfit', 'layers'])
        self.assertEqual([entry['stage'] for entry in self.published][:2], ['outfit', 'layers'])
        self.assertNotIn('warning', result)

    async def test_when_the_layers_fail_the_base_look_is_shown_with_a_note(self):
        os.environ['TRYON_FAL_LAYER_PASS'] = 'layered'
        self.generate.side_effect = [
            {'status': 'succeeded', 'outputUrl': 'https://fal.media/base.png', 'model': 'seedream-5-lite', 'costUsd': 0.035},
            {'error': 'fal model error'}]
        result = await self.layered_look()
        self.assertEqual(result['status'], 'succeeded', result)
        self.assertEqual(result['warning'], app.LAYERS_WARNING)
        self.assertEqual(self.protect.await_args.args[2] if self.protect.await_count else 'https://fal.media/base.png', 'https://fal.media/base.png')

    async def test_a_layer_sent_over_http_is_read(self):
        # FastAPI hands the endpoint Starlette's UploadFile, not its own subclass;
        # a layer checked against the subclass was silently dropped.
        from starlette.datastructures import UploadFile as StarletteUploadFile
        data = BytesIO(); Image.new('RGB', (80, 160), 'green').save(data, format='PNG'); data.seek(0)
        plain = StarletteUploadFile(file=data, filename='layer.png')
        self.assertNotIsInstance(plain, UploadFile)
        result = await app.tryon_generate_look(
            person_file=photo('white'), top_file=photo('red'), bottom_file=photo('blue'), shoes_file=None, outer_file=photo('navy'),
            top2_file=plain, outer2_file=None, tuck_mode='auto', compare_mode='false', quality_mode='quality',
            top_category='Футболка', outer_category='Пиджак', top2_category='Лонгслив', outer2_category='',
            request_id='request_000000000032', async_mode='false', fresh='false', device='masha')
        self.assertEqual(result['status'], 'succeeded', result)
        self.assertEqual(len(self.generate.await_args.args[3]), 4, 'the layer read over HTTP reaches the editor')

    async def test_one_upper_layer_stays_one_call_unless_asked(self):
        result = await self.look()
        self.assertEqual(self.generate.await_count, 1)
        self.assertEqual(result['creditsCharged'], 1)
        with patch.dict(os.environ, {'TRYON_FAL_LAYER_PASS': 'always'}):
            self.generate.side_effect = None
            result = await self.look(request='request_000000000021')
        self.assertEqual(self.generate.await_count, 3, 'a single coat over the top went as a second call')
        self.assertEqual(result['creditsCharged'], 2)
        with patch.dict(os.environ, {'TRYON_FAL_LAYER_PASS': 'off'}):
            await self.layered_look(request='request_000000000022')
        self.assertEqual(self.generate.await_count, 4, 'off: a layered look is one call')

    async def test_fashn_refuses_a_layered_look_instead_of_dropping_a_garment(self):
        with patch.dict(os.environ, {'TRYON_PROVIDER': 'fashn', 'FASHN_API_KEY': 'key'}):
            result = await app.tryon_generate_look(
                person_file=photo('white'), top_file=photo('red'), bottom_file=None, shoes_file=None, outer_file=None,
                top2_file=photo('green'), outer2_file=None, tuck_mode='auto', compare_mode='false', quality_mode='quality',
                top_category='Футболка', outer_category='', top2_category='Лонгслив', outer2_category='',
                request_id='request_000000000010', async_mode='false', fresh='false', device='masha')
        self.assertEqual(result, {'error': 'Многослойные образы доступны только в новой примерке.'})
        self.fashn.assert_not_awaited()

    async def test_a_narrow_photo_goes_without_side_bands(self):
        # Side bands made Seedream redraw the person larger and stretched.
        narrow = BytesIO(); Image.new('RGB', (100, 260), 'white').save(narrow, format='PNG')
        url = app._prepare_provider_frame(narrow.getvalue(), 1344, 92, fal_tryon.MIN_ASPECT)
        width, height = Image.open(BytesIO(app._data_url_to_bytes(url)[0])).size
        self.assertAlmostEqual(width / height, 100 / 260, delta=.01, msg='the photo keeps its own aspect')
        extreme = BytesIO(); Image.new('RGB', (100, 400), 'white').save(extreme, format='PNG')
        size = Image.open(BytesIO(app._data_url_to_bytes(app._prepare_provider_frame(extreme.getvalue(), 1344, 92, fal_tryon.MIN_ASPECT))[0])).size
        self.assertAlmostEqual(size[0] / size[1], 1 / 3, delta=.01, msg='only a photo narrower than 1:3 is padded, to 1:3')

    async def test_bria_is_sent_its_short_instruction(self):
        with patch.dict(os.environ, {'TRYON_FAL_MODEL': 'bria-tryon'}):
            result = await self.look(outer=False)
        self.assertEqual(result['modelUsed'], 'fal:bria-tryon')
        prompt = self.generate.await_args.args[4]
        self.assertNotIn('image 2', prompt)
        self.assertIn('Fully tuck the top', prompt)

    async def test_fashn_stays_the_default(self):
        with patch.dict(os.environ, {'TRYON_PROVIDER': 'fashn', 'FASHN_API_KEY': ''}):
            result = await self.look()
        self.assertEqual(result, {'error': 'FASHN_API_KEY is not set'})
        self.generate.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()
