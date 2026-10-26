import asyncio
"""A look in one fal call: the queue client, prices, and the real endpoint.

The fal queue is faked with httpx.MockTransport; in the endpoint tests the
call itself is faked and everything around it — budget, job, identity lock
hand-off — is the real code.
"""
import json
import os
import tempfile
import time
import unittest
from io import BytesIO
from unittest.mock import AsyncMock, Mock, patch

import httpx
from fastapi import UploadFile
from PIL import Image

import access
import accounts
import app
import fal_tryon
import tryon_policy

REAL_PREPARE = app._prepare_identity_source


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


class Race(unittest.IsolatedAsyncioTestCase):
    """Two identical requests, the first image back wins; a third if neither is back in time."""

    async def race(self, outcomes, env):
        calls = []

        async def one(*args, **kwargs):
            delay, result = outcomes[len(calls)]
            calls.append(delay)
            await asyncio.sleep(delay)
            return dict(result)
        with patch.dict(os.environ, env), patch.object(fal_tryon, '_generate_one', side_effect=one):
            result = await fal_tryon.generate(None, fal_tryon.MODELS['seedream-5-lite'], 'p', ['g'], 'prompt', 1)
        return result, calls

    async def test_the_first_image_back_is_taken_and_both_are_paid(self):
        ok = {'status': 'succeeded', 'outputUrl': 'u', 'costUsd': 0.035}
        result, calls = await self.race([(0.2, {**ok, 'outputUrl': 'slow'}), (0.05, {**ok, 'outputUrl': 'fast'})],
                                        {'TRYON_FAL_RACE': '2', 'TRYON_FAL_HEDGE_SECONDS': '5'})
        self.assertEqual(result['outputUrl'], 'fast')
        self.assertEqual(result['costUsd'], 0.07)
        self.assertEqual(len(calls), 2)

    async def test_a_third_goes_out_when_neither_is_back_in_time(self):
        ok = {'status': 'succeeded', 'outputUrl': 'u', 'costUsd': 0.035}
        result, calls = await self.race([(1., ok), (1., ok), (0.01, {**ok, 'outputUrl': 'third'})],
                                        {'TRYON_FAL_RACE': '2', 'TRYON_FAL_HEDGE_SECONDS': '0.05'})
        self.assertEqual(result['outputUrl'], 'third')
        self.assertEqual(len(calls), 3)

    async def test_a_failed_request_does_not_end_the_race_but_an_empty_balance_does(self):
        ok = {'status': 'succeeded', 'outputUrl': 'u', 'costUsd': 0.035}
        result, _ = await self.race([(0.01, {'error': 'fal model error'}), (0.05, ok)], {'TRYON_FAL_RACE': '2', 'TRYON_FAL_HEDGE_SECONDS': '0'})
        self.assertEqual(result['outputUrl'], 'u')
        result, _ = await self.race([(0.01, {'error': 'fal balance', 'balance': True}), (0.5, ok)], {'TRYON_FAL_RACE': '2', 'TRYON_FAL_HEDGE_SECONDS': '0'})
        self.assertTrue(result.get('balance'))


class FalClient(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        # One request per look here; the race of several is tried on its own (Race).
        self.env = patch.dict(os.environ, {'FAL_KEY': 'key-123', 'TRYON_PROVIDER': 'fal', 'TRYON_FAL_RACE': '1', 'TRYON_FAL_HEDGE_SECONDS': '0'})
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

    async def test_seedreams_image_comes_inside_its_result(self):
        inline = 'data:image/jpeg;base64,' + 'A' * 64
        client, calls = queue([{'status': 'COMPLETED'}], {'images': [{'url': inline, 'content_type': 'image/jpeg'}]})
        result = await self.run_look(client, model='seedream-5-lite')
        self.assertTrue(json.loads(calls[0][2])['sync_mode'])
        self.assertEqual(result['outputUrl'], inline)
        with patch.dict(os.environ, {'TRYON_FAL_INLINE': 'off'}):
            client, calls = queue([{'status': 'COMPLETED'}], {'images': [{'url': 'https://fal.media/out.jpg'}]})
            await self.run_look(client, model='seedream-5-lite')
        self.assertNotIn('sync_mode', json.loads(calls[0][2]))
        client, calls = queue([{'status': 'COMPLETED'}], {'image': {'url': 'https://fal.media/bria.png'}})
        await self.run_look(client, model='bria-tryon')
        self.assertNotIn('sync_mode', json.loads(calls[0][2]), 'only Seedream is asked for it')

    def streamed(self, events, stream_status=200, result=None, statuses=({'status': 'COMPLETED'},), close_early=0):
        """A fal queue whose status stream sends `events`; plain polls answer `statuses`."""
        calls, opened = [], []
        statuses = list(statuses)

        def handler(request):
            calls.append((request.method, request.url.path))
            if request.method == 'POST':
                return httpx.Response(200, json={
                    'request_id': 'req-1', 'status_url': 'https://queue.fal.run/app/requests/req-1/status',
                    'response_url': 'https://queue.fal.run/app/requests/req-1', 'cancel_url': 'https://queue.fal.run/app/requests/req-1/cancel'})
            if request.url.path.endswith('/status/stream'):
                opened.append(1)
                if stream_status != 200:
                    return httpx.Response(stream_status, text='no stream')
                sent = events[:1] if len(opened) <= close_early else events
                body = ''.join(f'data: {json.dumps(event)}\n\n' for event in sent)
                return httpx.Response(200, text=body, headers={'content-type': 'text/event-stream'})
            if request.url.path.endswith('/status'):
                return httpx.Response(200, json=statuses.pop(0) if len(statuses) > 1 else statuses[0])
            return httpx.Response(200, json=result or {'images': [{'url': 'https://fal.media/out.png'}]})
        return httpx.AsyncClient(transport=httpx.MockTransport(handler)), calls, opened

    async def test_the_status_stream_reports_the_finished_image_without_polling(self):
        client, calls, _ = self.streamed([{'status': 'IN_QUEUE'}, {'status': 'IN_PROGRESS'}, {'status': 'COMPLETED'}])
        result = await self.run_look(client)
        self.assertEqual(result['outputUrl'], 'https://fal.media/out.png', result)
        self.assertEqual([call for call in calls if call[1].endswith('/status')], [], 'no status polls')
        self.assertIn(('GET', '/app/requests/req-1/status/stream'), calls)

    async def test_a_model_error_on_the_stream_is_a_failure(self):
        client, _, _ = self.streamed([{'status': 'COMPLETED', 'error': 'CUDA out of memory', 'error_type': 'runner'}])
        result = await self.run_look(client)
        self.assertIn('runner', result['error'])
        self.assertNotIn('outputUrl', result)

    async def test_without_the_stream_the_status_is_polled(self):
        client, calls, _ = self.streamed([], stream_status=405)
        result = await self.run_look(client)
        self.assertEqual(result['outputUrl'], 'https://fal.media/out.png', result)
        self.assertTrue(any(call[1].endswith('/status') for call in calls))

    async def test_a_stream_that_breaks_off_is_opened_again(self):
        client, calls, opened = self.streamed([{'status': 'IN_PROGRESS'}, {'status': 'COMPLETED'}], close_early=1)
        result = await self.run_look(client)
        self.assertEqual(result['outputUrl'], 'https://fal.media/out.png', result)
        self.assertEqual(len(opened), 2)
        self.assertEqual([call for call in calls if call[1].endswith('/status')], [])

    async def test_a_stream_that_never_completes_falls_back_to_polling(self):
        client, calls, opened = self.streamed([{'status': 'IN_QUEUE'}], close_early=99)
        result = await self.run_look(client)
        self.assertEqual(result['outputUrl'], 'https://fal.media/out.png', result)
        self.assertEqual(len(opened), 3)
        self.assertTrue(any(call[1].endswith('/status') for call in calls))

    async def test_an_event_without_a_status_keeps_the_last_one(self):
        client, _, _ = self.streamed([{'status': 'IN_PROGRESS'}, {'logs': []}], close_early=99)
        followed = await fal_tryon._follow_status(client, 'https://queue.fal.run/app/requests/req-1/status', {}, 60, 600)
        self.assertEqual(followed['last_state'], 'IN_PROGRESS')

    async def test_a_stream_that_cannot_connect_falls_back_to_polling(self):
        opened = []

        def handler(request):
            if request.url.path.endswith('/status/stream'):
                opened.append(1)
                raise httpx.ConnectTimeout('no route', request=request)
            return httpx.Response(200, json={})
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        followed = await fal_tryon._follow_status(client, 'https://queue.fal.run/app/requests/req-1/status', {}, 60, 600)
        self.assertIsNone(followed['final'])
        self.assertNotIn('timeout', followed)
        self.assertEqual(len(opened), 3, 'counted as breaks, then polled')

    async def test_a_silent_stream_is_opened_again_until_it_completes(self):
        opened = []

        def handler(request):
            opened.append(1)
            if len(opened) < 4:
                raise httpx.ReadTimeout('silent', request=request)
            return httpx.Response(200, text='data: {"status": "COMPLETED"}\n\n', headers={'content-type': 'text/event-stream'})
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        followed = await fal_tryon._follow_status(client, 'https://queue.fal.run/app/requests/req-1/status', {}, 60, 600)
        self.assertEqual(followed['final'], {'status': 'COMPLETED'})
        self.assertEqual(len(opened), 4, 'a read timeout is not a break')

    async def test_the_result_is_asked_for_once_more_after_a_failure(self):
        answers = [httpx.Response(502, text='bad gateway'), httpx.Response(200, json={'images': [{'url': 'https://fal.media/out.png'}]})]
        client, _, _ = self.streamed([{'status': 'COMPLETED'}])
        handler = client._transport.handler

        def flaky(request):
            if request.method == 'GET' and request.url.path == '/app/requests/req-1':
                return answers.pop(0)
            return handler(request)
        client = httpx.AsyncClient(transport=httpx.MockTransport(flaky))
        result = await self.run_look(client)
        self.assertEqual(result['outputUrl'], 'https://fal.media/out.png', result)
        self.assertEqual(answers, [])

    async def test_a_result_that_fails_twice_is_a_failure(self):
        client, _, _ = self.streamed([{'status': 'COMPLETED'}])
        handler = client._transport.handler
        asked = []

        def broken(request):
            if request.method == 'GET' and request.url.path == '/app/requests/req-1':
                asked.append(1)
                raise httpx.ConnectError('down', request=request)
            return handler(request)
        client = httpx.AsyncClient(transport=httpx.MockTransport(broken))
        result = await self.run_look(client)
        self.assertIn('result failed', result['error'])
        self.assertEqual(len(asked), 2)

    async def test_polling_can_be_brought_back(self):
        client, calls, opened = self.streamed([{'status': 'COMPLETED'}])
        with patch.dict(os.environ, {'TRYON_FAL_STATUS_STREAM': 'off'}):
            result = await self.run_look(client)
        self.assertEqual(result['status'], 'succeeded', result)
        self.assertEqual(opened, [])

    async def test_a_request_that_runs_too_long_on_the_stream_is_cancelled(self):
        async def stuck(*args, **kwargs):
            return {'started_at': 1.0, 'last_state': 'IN_PROGRESS', 'final': None, 'timeout': True}
        client, calls, _ = self.streamed([{'status': 'IN_PROGRESS'}])
        with patch.object(fal_tryon, '_follow_status', side_effect=stuck):
            result = await self.run_look(client)
        self.assertTrue(result.get('timeout'), result)
        self.assertIn(('PUT', '/app/requests/req-1/cancel'), calls)

    async def test_the_stream_keeps_the_run_limit(self):
        # A model still running past its limit ends the wait on the stream itself.
        class Slow(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield b'data: {"status": "IN_PROGRESS"}\n\n'
                await asyncio.sleep(5)
                yield b'data: {"status": "COMPLETED"}\n\n'

        def handler(request):
            if request.url.path.endswith('/status/stream'):
                return httpx.Response(200, stream=Slow(), headers={'content-type': 'text/event-stream'})
            return httpx.Response(200, json={})
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        started = asyncio.get_running_loop().time()
        followed = await fal_tryon._follow_status(client, 'https://queue.fal.run/app/requests/req-1/status', {}, 0.2, 600)
        self.assertTrue(followed.get('timeout'))
        self.assertEqual(followed['last_state'], 'IN_PROGRESS')
        self.assertLess(asyncio.get_running_loop().time() - started, 2)

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
        self.traits = Mock(return_value={})
        self.patches = [
            patch.object(app, '_prepare_identity_source', return_value='prepared'),
            patch.object(app.fal_tryon, 'generate', self.generate),
            patch.object(app, '_run_fashn_tryon_with_category_fallback', self.fashn),
            patch.object(app.fashn_credits, 'sufficient', side_effect=AssertionError('no FASHN balance check')),
            patch.object(app, '_face_locked_output_url', self.protect),
            patch.object(app, '_load_image_from_url_or_data_url', AsyncMock(return_value=Image.new('RGB', (64, 128)))),
            patch.object(app.access, 'throttle'),
            # The garment reader is tried on its own below; here no garment photo is read.
            patch.object(app, 'read_garment', self.traits),
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
        self.assertIn('neither shorten nor lengthen it', prompt)

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

    async def test_a_photo_that_cannot_be_protected_is_refused_before_paying(self):
        with patch.object(app, '_prepare_identity_source', side_effect=ValueError('Для защищённой примерки нужно фото одного человека')):
            result = await self.look()
        self.assertIn('одного человека', result['error'])
        self.generate.assert_not_awaited()

    async def test_source_parser_failure_stops_before_paid_generation(self):
        # The real preparation: a photo whose parsing fails is refused before the paid call.
        with patch.object(app, '_prepare_identity_source', REAL_PREPARE), \
             patch.object(app.face_guard, 'detect_faces', return_value=['face']), \
             patch.object(app.footwear_guard, 'parse', side_effect=RuntimeError('model unavailable')):
            result = await self.look()
        self.assertIn('защиту лица и обуви', result['error'])
        self.generate.assert_not_awaited()

    def ordered(self, order):
        def prepare(content, photo=None, faces_only=False, cached=False, owner=None):
            order.append('faces' if faces_only else 'parse')
            return 'photo' if faces_only else 'prepared'

        async def generate(*args, **kwargs):
            order.append('generate')
            await asyncio.sleep(0.05)
            return self.generate.return_value
        return prepare, generate

    async def test_a_new_photo_is_parsed_before_the_paid_call(self):
        order = []
        prepare, generate = self.ordered(order)
        with patch.object(app, '_prepare_identity_source', side_effect=prepare), \
             patch.object(app.fal_tryon, 'generate', side_effect=generate), \
             patch.object(app, '_face_only_output_url', return_value='data:image/png;base64,face') as face_only:
            result = await self.look()
        self.assertEqual(result['status'], 'succeeded', result)
        self.assertEqual(order, ['parse', 'generate'])
        self.assertEqual(face_only.call_args.args[1], 'prepared')

    async def test_a_photo_read_before_is_finished_while_the_editor_works(self):
        order = []
        prepare, generate = self.ordered(order)
        with patch.object(app, '_identity_known', return_value=True), \
             patch.object(app, '_prepare_identity_source', side_effect=prepare), \
             patch.object(app.fal_tryon, 'generate', side_effect=generate), \
             patch.object(app, '_face_only_output_url', return_value='data:image/png;base64,face') as face_only:
            result = await self.look()
        self.assertEqual(result['status'], 'succeeded', result)
        self.assertEqual(order, ['faces', 'generate', 'parse'])
        self.assertEqual(face_only.call_args.args[1], 'prepared')

    async def test_a_paid_frame_is_shown_with_a_note_when_the_photo_fails_after_the_call(self):
        def prepare(content, photo=None, faces_only=False, cached=False, owner=None):
            if faces_only:
                return 'photo'
            raise ValueError('Не удалось отделить человека от фона. Выбери более чёткое фото.')
        with patch.object(app, '_identity_known', return_value=True), \
             patch.object(app, '_prepare_identity_source', side_effect=prepare), \
             patch.object(app, '_face_only_output_url') as face_only:
            result = await self.look()
        self.assertEqual(result['status'], 'succeeded', result)
        self.assertTrue(result['outputUrl'].startswith('data:image/jpeg;base64,'))
        self.assertEqual(result['warning'], app.UNLOCKED_WARNING)
        self.assertEqual((result['identityLocked'], result['faceRestored']), (False, False))
        self.assertEqual(self.generate.await_count, 1)
        face_only.assert_not_called()
        self.protect.assert_not_awaited()

    async def test_the_cpu_slot_is_taken_after_the_frame_is_downloaded(self):
        app._CPU_STAGES = None
        held = []

        async def load(client, source):
            # The first download fails: the composite fetches the frame again.
            held.append(app._cpu_stage().locked())
            return Image.new('RGB', (64, 128)) if len(held) > 1 else None
        try:
            with patch.dict(os.environ, {'AI_TRYON_CPU_STAGES': '1'}), \
                 patch.object(app, '_load_image_from_url_or_data_url', side_effect=load), \
                 patch.object(app, '_face_only_output_url', return_value='data:image/png;base64,face'):
                result = await self.look()
        finally:
            app._CPU_STAGES = None
        self.assertEqual(result['status'], 'succeeded', result)
        self.assertEqual(held, [False, False], 'no download while holding the slot')

    async def test_heavy_photo_work_of_two_looks_goes_one_at_a_time(self):
        app._CPU_STAGES = None
        running, most = [0], [0]

        def restore(*args, **kwargs):
            running[0] += 1
            most[0] = max(most[0], running[0])
            time.sleep(0.05)
            running[0] -= 1
            return 'data:image/png;base64,face'
        try:
            with patch.dict(os.environ, {'AI_TRYON_CPU_STAGES': '1'}), \
                 patch.object(app, '_face_only_output_url', side_effect=restore):
                results = await asyncio.gather(self.look(request='request_000000000001'), self.look(request='request_000000000002'))
        finally:
            app._CPU_STAGES = None
        self.assertEqual([result['status'] for result in results], ['succeeded', 'succeeded'])
        self.assertEqual(most[0], 1)

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
        # Unread, a raincoat keeps the length of its photo; only one read as long is told so.
        self.assertIn('Keep the length of the garment in image 4 exactly as in its photo: neither shorten nor lengthen it.', prompt)
        self.assertNotIn('The garment in image 4 is long', prompt)
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

    async def test_the_inner_top_shows_at_the_neck_never_below_the_hem(self):
        # The user: the inner top may peek out at the neck, never below the hem.
        await self.layered_look(request='request_000000000051')
        prompt = self.generate.await_args.args[4]
        self.assertIn('The top in image 2 is worn under the garment in image 4: it may show only at the neckline', prompt)
        self.assertIn('below that hem only the trousers show', prompt)
        self.assertIn('Remove any necklace, chain or pendant', prompt)

    async def test_two_tops_layer_in_their_natural_order(self):
        # The user picked the long-sleeve first and the T-shirt second, meaning a
        # T-shirt under a long-sleeve: the order comes from the garments, not the taps.
        await app.tryon_generate_look(
            person_file=photo('white'), top_file=photo('black'), bottom_file=photo('blue'), shoes_file=None, outer_file=None,
            top2_file=photo('white'), outer2_file=None, tuck_mode='auto', compare_mode='false', quality_mode='quality',
            top_category='Лонгслив', outer_category='', top2_category='Футболка', outer2_category='',
            request_id='request_000000000061', async_mode='false', fresh='false', device='masha')
        prompt = self.generate.await_args.args[4]
        self.assertIn('image 2 is the top: a t-shirt', prompt)
        self.assertIn('image 4 is the outerwear: a long-sleeve t-shirt', prompt)
        self.assertIn('The top in image 2 is worn under the garment in image 4: it may show only at the neckline', prompt)

    async def four_layers(self, request, **layers):
        fields = dict(top_file=None, top2_file=None, top3_file=None, top4_file=None, outer_file=None, outer2_file=None,
                      top_category='', top2_category='', top3_category='', top4_category='', outer_category='', outer2_category='')
        fields.update(layers)
        return await app.tryon_generate_look(
            person_file=photo('white'), bottom_file=photo('blue'), shoes_file=None, tuck_mode='auto', compare_mode='false',
            quality_mode='quality', request_id=request, async_mode='false', fresh='false', device='masha', **fields)

    @patch.object(tryon_policy, 'PRINTS_STAY', False)  # the print rule is tried on its own below
    @patch.object(tryon_policy, 'HOOD_DOWN', False)  # the hood rule is tried on its own
    async def test_four_upper_layers_go_on_inside_out_whatever_the_taps(self):
        # The user: two layers of tops is too few; a T-shirt, a long-sleeve,
        # a hoodie and a jacket make one look, picked in any order.
        result = await self.four_layers(
            'request_000000000071', top_file=photo('gray'), top_category='Худи', top2_file=photo('white'), top2_category='Футболка',
            top3_file=photo('black'), top3_category='Лонгслив', outer_file=photo('navy'), outer_category='Куртка')
        self.assertEqual(result['status'], 'succeeded', result)
        self.assertEqual(self.generate.await_count, 1, 'four layers are still one call')
        self.assertEqual(len(self.generate.await_args.args[3]), 5)
        prompt = self.generate.await_args.args[4]
        self.assertIn('image 2 is the top: a t-shirt, with short sleeves ending above the elbow, hidden under the jacket: nothing of it shows at the wrists; image 3 is the lower-body garment; '
                      'image 4 is the outerwear: a long-sleeve t-shirt, its sleeves hidden inside the sleeves of the jacket all the way: no cuff or band of it shows below them at the wrists; '
                      'image 5 is the second layer, worn over the outerwear: a hoodie, its sleeves hidden inside the sleeves of the jacket all the way: no cuff or band of it shows below them at the wrists; '
                      'image 6 is the outermost layer, worn over everything: a jacket, its sleeves long: both end at the same height, right at the wrist bones, as in its photo', prompt)
        self.assertIn('The result must show all 5 garments at once', prompt)
        self.assertIn('Wear the second layer from image 5 pulled on over the layers beneath it: '
                      'they may show only at its neckline and never below its hem.', prompt)
        self.assertIn('From the body outwards the upper layers are: the t-shirt (image 2), the long-sleeve t-shirt (image 4), '
                      'the hoodie (image 5), the jacket (image 6).', prompt)
        # Under a hoodie a layer is closed: an open one ended up over the sweatshirt in a real run.
        self.assertIn('The long-sleeve t-shirt from image 4 is worn closed under the hoodie from image 5', prompt)
        self.assertNotIn('Wear the outerwear fully open', prompt)
        self.assertIn('Wear the jacket from image 6 open over the hoodie', prompt)

    @patch.object(tryon_policy, 'PRINTS_STAY', False)  # the print rule is tried on its own below
    async def test_two_outer_layers_go_on_inside_out(self):
        await self.four_layers('request_000000000072', top_file=photo('white'), top_category='Футболка',
                               outer_file=photo('gray'), outer_category='Пальто', outer2_file=photo('navy'), outer2_category='Пиджак')
        prompt = self.generate.await_args.args[4]
        self.assertIn('image 4 is the outerwear: a blazer, its sleeves hidden inside the sleeves of the overcoat all the way: no cuff or band of it shows below them at the wrists; image 5 is the second layer, worn over the outerwear: an overcoat, its sleeves long: both end at the same height, right at the wrist bones, as in its photo', prompt)

    async def test_more_than_four_upper_layers_are_refused_before_paying(self):
        result = await self.four_layers(
            'request_000000000073', top_file=photo('white'), top_category='Футболка', top2_file=photo('black'), top2_category='Лонгслив',
            top3_file=photo('gray'), top3_category='Худи', outer_file=photo('navy'), outer_category='Куртка',
            outer2_file=photo('green'), outer2_category='Пальто')
        self.assertEqual(result, {'error': 'Можно надеть не больше 4 слоёв верха.'})
        self.generate.assert_not_awaited()

    def test_up_to_three_layers_over_the_top_read_as_before(self):
        self.assertEqual(tryon_policy.upper_roles(2), tryon_policy.UPPER_ROLES[:2])
        self.assertEqual(tryon_policy.upper_roles(3), tryon_policy.UPPER_ROLES)
        self.assertEqual(tryon_policy.upper_roles(4)[2], 'third layer, worn over the second layer')

    def test_the_person_always_faces_the_camera_in_their_own_size(self):
        # A back-print T-shirt turned the body round; a bulky coat in the photo made everything broad.
        prompt = tryon_policy.look_prompt(['top', 'bottom', 'shoes'], 'Футболка', '', 'auto', {}, {})
        self.assertIn('Never turn the person or show them from behind', prompt)
        self.assertIn('its back print, back pockets and back seams stay on the person\'s back', prompt)
        self.assertIn('never make the person broader', prompt)
        # Hands clasped at the waist came out as arms folded on the chest.
        self.assertIn('hands held together in front stay together at the same height', prompt)
        # A shirt's neck label came out on the front of the neck.
        self.assertIn('no label or tag shows anywhere on the person, least of all at the front of the neck', prompt)
        self.assertIn('no label or tag shows', tryon_policy.layer_prompt(['top2'], {'top2': 'Рубашка'}, {}), 'the layer pass too')
        self.assertIn('the arms are never folded, crossed or moved to another place', prompt)

    async def options_look(self, request, options, bottom=True, **layers):
        fields = dict(top_file=None, top2_file=None, top3_file=None, top4_file=None, outer_file=None, outer2_file=None,
                      top_category='', top2_category='', top3_category='', top4_category='', outer_category='', outer2_category='')
        fields.update(layers)
        await app.tryon_generate_look(
            person_file=photo('white'), bottom_file=photo('blue') if bottom else None, shoes_file=None, tuck_mode='auto', compare_mode='false',
            quality_mode='quality', request_id=request, async_mode='false', fresh='false', device='masha',
            garment_options=options if isinstance(options, str) else json.dumps(options), **fields)
        return self.generate.await_args.args[4]

    async def test_a_garment_is_buttoned_or_opened_as_the_user_chose(self):
        # The shirt was picked first and goes over the T-shirt: its choice goes with it.
        prompt = await self.options_look('request_000000000081', {'top': {'fasten': 'closed'}, 'outer': {'fasten': 'closed'}},
                                         top_file=photo('white'), top_category='Рубашка', top2_file=photo('black'), top2_category='Футболка',
                                         outer_file=photo('navy'), outer_category='Тренч')
        # Told with the outfit, naming what each one closes over.
        self.assertIn('The button-up shirt from image 4 is worn fully closed over the t-shirt, zipped or buttoned all the way up', prompt)
        self.assertIn('The trench coat from image 5 is worn fully closed over the button-up shirt', prompt)
        self.assertIn('any print on the button-up shirt stays covered', prompt)
        self.assertLess(prompt.index('worn fully closed over'), prompt.index('Replace the matching original clothes'))
        self.assertIn('image 5 is the second layer, worn over the outerwear: a trench coat, worn fastened shut', prompt)
        self.assertNotIn('Wear the outerwear fully open and unfastened', prompt)

    async def test_a_coat_worn_open_and_a_shirt_tucked_in(self):
        prompt = await self.options_look('request_000000000082', {'top': {'tuck': 'tucked'}, 'top2': {'tuck': 'untucked'}, 'outer': {'fasten': 'open'}},
                                         top_file=photo('black'), top_category='Футболка', top2_file=photo('white'), top2_category='Рубашка',
                                         outer_file=photo('navy'), outer_category='Куртка')
        self.assertIn('Fully tuck the top into the trousers', prompt)
        self.assertIn('Wear the button-up shirt from image 4 untucked', prompt)
        self.assertIn('The jacket from image 5 is worn open: every button or the zip is undone', prompt)

    async def test_a_tuck_under_a_closed_coat_is_not_asked_for(self):
        # It does not show, and asked for anyway it made the editor open the coat.
        prompt = await self.options_look('request_000000000087', {'top': {'tuck': 'tucked'}, 'outer': {'fasten': 'closed'}},
                                         top_file=photo('white'), top_category='Рубашка', outer_file=photo('navy'), outer_category='Тренч')
        self.assertNotIn('Fully tuck the top', prompt)
        self.assertIn('worn fully closed over the button-up shirt', prompt)

    def test_layers_over_the_top_keep_full_sleeves(self):
        # A jacket over a long-sleeve came out with sleeves ending mid-forearm.
        prompt = tryon_policy.look_prompt(['top', 'bottom', 'outer', 'shoes'], 'Лонгслив', 'Куртка', 'auto', {}, {})
        self.assertIn('The sleeves of the garment in image 4 keep their full length down to the wrists', prompt)
        vest = tryon_policy.look_prompt(['top', 'bottom', 'top2', 'shoes'], 'Рубашка', '', 'auto', {}, {'top2': 'Жилет'})
        self.assertNotIn('sleeves of the garment in image 4', vest, 'a vest has no sleeves')

    async def test_choices_that_make_no_sense_are_ignored(self):
        plain = await self.options_look('request_000000000083', {}, top_file=photo('white'), top_category='Футболка')
        self.assertEqual(await self.options_look('request_000000000084', {'top': {'fasten': 'closed'}, 'x': 'y'},
                                                 top_file=photo('white'), top_category='Футболка'), plain, 'a T-shirt has nothing to fasten')
        self.assertEqual(await self.options_look('request_000000000085', 'not json', top_file=photo('white'), top_category='Футболка'), plain)
        no_trousers = await self.options_look('request_000000000086', {'top': {'tuck': 'tucked'}}, bottom=False,
                                              top_file=photo('white'), top_category='Футболка')
        self.assertNotIn('tuck the top', no_trousers.lower(), 'nothing to tuck into without trousers')

    async def test_a_buttoned_blazer_closes_at_the_waist_under_open_lapels(self):
        # Told to close "up to the collar", a blazer stayed wide open over the top.
        prompt = await self.options_look('request_000000000088', {'outer': {'fasten': 'closed'}},
                                         top_file=photo('black'), top_category='Топ', outer_file=photo('navy'), outer_category='Пиджак')
        self.assertIn('The blazer from image 4 is worn buttoned over the top: its front button is fastened at the waist', prompt)
        self.assertIn('the lapels open in a V that shows only the neckline of the top', prompt)
        self.assertNotIn('zipped or buttoned all the way up', prompt)

    def test_the_outermost_sleeves_are_long_in_the_outfit_itself(self):
        # Said at the end only, a jacket over a long-sleeve came out with sleeves at the elbow.
        prompt = tryon_policy.look_prompt(['top', 'bottom', 'outer', 'shoes'], 'Лонгслив', 'Куртка', 'auto', app._CATEGORY_NOUNS, {})
        self.assertIn('a long-sleeve t-shirt, its sleeves hidden inside the sleeves of the jacket all the way: no cuff or band of it shows below them at the wrists; ', prompt)
        self.assertIn('the outerwear: a jacket, its sleeves long: both end at the same height, right at the wrist bones, as in its photo', prompt)
        shirt = tryon_policy.look_prompt(['top', 'bottom', 'top2', 'shoes'], 'Футболка', '', 'auto', app._CATEGORY_NOUNS, {'top2': 'Рубашка'})
        self.assertNotIn('reaching the wrists', shirt, 'a shirt may be short-sleeved: its length comes from its photo')
        vest = tryon_policy.look_prompt(['top', 'bottom', 'top2', 'outer', 'shoes'], 'Рубашка', 'Пиджак', 'auto', app._CATEGORY_NOUNS, {'top2': 'Жилет'})
        self.assertNotIn('a vest, its sleeves', vest, 'a vest has no sleeves to hide')

    def test_a_t_shirt_under_a_coat_keeps_its_short_sleeves(self):
        # Told its sleeves were inside the coat's, a T-shirt came out as a long-sleeve with cuffs at the wrists.
        for category in ('Футболка', 'Поло'):
            prompt = tryon_policy.look_prompt(['top', 'bottom', 'outer', 'shoes'], category, 'Плащ', 'auto', app._CATEGORY_NOUNS, {})
            self.assertIn('with short sleeves ending above the elbow, hidden under the raincoat: nothing of it shows at the wrists', prompt)
            self.assertNotIn('sleeves hidden inside the sleeves', prompt)
            self.assertIn('the outerwear: a raincoat, its sleeves long: both end at the same height, right at the wrist bones, as in its photo', prompt)

    def test_sleeves_follow_each_garments_photo_not_its_category(self):
        names = app._CATEGORY_NOUNS
        read = lambda sleeves: {slot: {'sleeves': value} for slot, value in sleeves.items()}
        look = lambda top, outer, sleeves, top2=None: tryon_policy.look_prompt(
            ['top', 'bottom', *(['top2'] if top2 else []), 'outer', 'shoes'], top, outer, 'auto', names,
            {'top2': top2} if top2 else {}, {}, read(sleeves))
        # A short-sleeved shirt under a blazer keeps its short sleeves; a long-sleeved one tucks them into the blazer's.
        self.assertIn('a button-up shirt, with short sleeves ending above the elbow, hidden under the blazer',
                      look('Рубашка', 'Пиджак', {'top': 'short', 'outer': 'long'}))
        self.assertIn('a button-up shirt, its sleeves hidden inside the sleeves of the blazer all the way: no cuff or band of it shows below them at the wrists',
                      look('Рубашка', 'Пиджак', {'top': 'long', 'outer': 'long'}))
        unsure = look('Рубашка', 'Пиджак', {'outer': 'long'})
        self.assertNotIn('a button-up shirt, with short', unsure)
        self.assertNotIn('a button-up shirt, its sleeves', unsure, 'unread, its sleeves are not guessed')
        # A long-sleeved polo is not a T-shirt.
        self.assertIn('a polo shirt, its sleeves hidden inside the sleeves of the raincoat all the way: no cuff or band of it shows below them at the wrists', look('Поло', 'Плащ', {'top': 'long'}))
        # A short-sleeved cardigan over a T-shirt: nothing is said to reach the wrists.
        cardigan = look('Футболка', '', {'top': 'short', 'top2': 'short'}, top2='Кардиган')
        self.assertNotIn('reaching the wrists', cardigan)
        self.assertNotIn('keep their full length down to the wrists', cardigan)
        self.assertIn('has short sleeves, as in its photo: never lengthen them', cardigan)
        # A garment worn on its own says what its photo shows.
        dress = tryon_policy.look_prompt(['top', 'shoes'], 'Платье', '', 'auto', names, {}, {}, {'top': {'sleeves': 'short'}})
        self.assertIn('image 2 is the top: one-piece garment, with short sleeves', dress)
        blouse = tryon_policy.look_prompt(['top', 'bottom'], 'Блуза', '', 'auto', names, {}, {}, {'top': {'sleeves': 'none'}})
        self.assertIn('a blouse, sleeveless', blouse)

    def test_length_and_front_opening_follow_each_garments_photo(self):
        names = app._CATEGORY_NOUNS
        coat = lambda length: tryon_policy.look_prompt(['top', 'bottom', 'outer', 'shoes'], 'Футболка', 'Пальто', 'auto', names, {}, {},
                                                       {'outer': {'length': length}})
        self.assertIn('The garment in image 4 is long: keep its full length below the hips', coat('long'))
        self.assertIn('The garment in image 4 is cropped: it ends at the waist, as in its photo; never lengthen it.', coat('cropped'))
        short = coat('hip')
        self.assertNotIn('is long', short, 'a hip-length coat is not lengthened')
        self.assertIn('an overcoat, hip-length, ending at the hips', short, 'said with the coat, whose name suggests a long one')
        self.assertIn('neither shorten nor lengthen it', coat(None), 'unread, its photo decides')
        # A crop top and a tunic keep their length too.
        crop = tryon_policy.look_prompt(['top', 'bottom'], 'Свитшот', '', 'auto', names, {}, {}, {'top': {'length': 'cropped'}})
        self.assertIn('The garment in image 2 is cropped', crop)
        # A zip hoodie as the third layer is worn open over what is under it; a pullover hoodie goes on over the head.
        layered = lambda opening: tryon_policy.look_prompt(['top', 'bottom', 'top2', 'top3', 'shoes'], 'Футболка', '', 'auto', names,
                                                            {'top2': 'Рубашка', 'top3': 'Худи'}, {}, {'top3': {'opening': opening}})
        self.assertNotIn('pulled on over the layers beneath it', layered('front'))
        self.assertIn('pulled on over the layers beneath it', layered('none'))
        over = tryon_policy.layer_prompt(['top2'], {'top2': 'Худи'}, names, 'Футболка', {'top2': {'opening': 'front'}})
        self.assertIn('unbuttoned and open over', over)
        self.assertEqual(tryon_policy.composite_slot('outer', 'Пальто', 'hip'), 'outer', 'a short coat leaves the legs alone')
        self.assertEqual(tryon_policy.composite_slot('outer', 'Куртка', 'long'), 'long_outer')

    def test_a_zip_hoodie_is_worn_open_as_chosen_and_a_pullover_is_not(self):
        chosen = {'top2': {'fasten': 'open'}}
        self.assertEqual(tryon_policy.garment_options(chosen, {'top2': 'Худи'}, {'top2': 'front'}), chosen)
        self.assertEqual(tryon_policy.garment_options(chosen, {'top2': 'Худи'}, {'top2': 'none'}), {})
        self.assertEqual(tryon_policy.garment_options(chosen, {'top2': 'Кардиган'}, {}), chosen, 'unread, the category decides')

    async def test_each_upper_garments_photo_is_read_for_its_sleeves(self):
        self.traits.side_effect = lambda content, category: {'Рубашка': {'sleeves': 'short'}, 'Пиджак': {'sleeves': 'long'}}.get(category, {})
        prompt = await self.options_look('request_000000000095', {}, top_file=photo('white'), top_category='Рубашка',
                                         outer_file=photo('navy'), outer_category='Пиджак')
        self.assertIn('a button-up shirt, with short sleeves ending above the elbow, hidden under the blazer', prompt)
        self.assertEqual(sorted({call.args[1] for call in self.traits.call_args_list}), ['Пиджак', 'Рубашка'], 'only the upper garments')
        # A reader that fails leaves the garment to its category; the try-on goes on.
        self.traits.side_effect = RuntimeError('model missing')
        prompt = await self.options_look('request_000000000096', {}, top_file=photo('white'), top_category='Футболка',
                                         outer_file=photo('navy'), outer_category='Плащ')
        self.assertIn('a t-shirt, with short sleeves ending above the elbow, hidden under the raincoat', prompt)

    def test_hat_scarf_gloves_and_bag_are_worn(self):
        slots = ['top', 'bottom', 'shoes', 'hat', 'scarf', 'gloves', 'bag']
        prompt = tryon_policy.look_prompt(slots, 'Футболка', '', 'auto', app._CATEGORY_NOUNS, {'bag': 'Рюкзак'}, {})
        for words in ('Put the hat from image 5 on the person', 'Wear the scarf from image 6 around the neck',
                      'Put the gloves from image 7 on both hands', 'carries the bag from image 8: worn on the back'):
            self.assertIn(words, prompt)
        self.assertNotIn('hat', tryon_policy.accessory_instruction(['top'], {'top': 2}))

    async def test_an_accessory_alone_is_a_look(self):
        prompt = await self.options_look('request_000000000097', {}, bottom=False, hat_file=photo('red'))
        self.assertIn('Put the hat from image 2', prompt)

    def test_a_hood_lies_down_behind_the_neck(self):
        prompt = tryon_policy.look_prompt(['top', 'bottom'], 'Худи', '', 'auto', app._CATEGORY_NOUNS, {}, {})
        self.assertIn('its hood down, lying flat behind the neck', prompt)
        self.assertNotIn('hood down', tryon_policy.look_prompt(['top', 'bottom'], 'Свитшот', '', 'auto', app._CATEGORY_NOUNS, {}, {}))

    def test_tuck_and_print_are_said_with_the_garment(self):
        names = app._CATEGORY_NOUNS
        look = lambda tuck: tryon_policy.look_prompt(['top', 'bottom', 'outer', 'shoes'], 'Футболка', 'Куртка', tuck, names, {},
                                                     {'outer': {'fasten': 'open'}, 'top': {'tuck': tuck}})
        self.assertIn('a t-shirt, with short sleeves ending above the elbow, hidden under the jacket: nothing of it shows at the wrists, '
                      'tucked into the trousers or skirt all around', look('tucked'))
        self.assertIn('worn untucked: its hem hangs loose outside the trousers, over the waistband, hiding the belt', look('untucked'))
        self.assertNotIn('tucked into the trousers or skirt all around', look('auto'))
        # The T-shirt's logo stays on the T-shirt, partly hidden by the open jacket, never on the jacket.
        self.assertIn('any print or lettering on it stays on it, at the same place on its front: where the jacket covers it that part is hidden',
                      look('auto'))
        closed = tryon_policy.look_prompt(['top', 'bottom', 'outer', 'shoes'], 'Футболка', 'Куртка', 'tucked', names, {}, {'outer': {'fasten': 'closed'}})
        self.assertNotIn('tucked into the trousers or skirt all around', closed, 'under a closed jacket a tuck is not asked for')

    async def test_a_top_is_not_called_a_crop_top(self):
        # Named so, a long sleeveless top was cut off at the ribs.
        prompt = await self.options_look('request_000000000089', {}, top_file=photo('black'), top_category='Топ')
        self.assertIn('image 2 is the top: a top, sleeveless', prompt)
        self.assertNotIn('crop top', prompt)

    async def test_tights_go_under_the_dress_and_into_the_shoes(self):
        result = await app.tryon_generate_look(
            person_file=photo('white'), top_file=photo('red'), bottom_file=None, shoes_file=photo('black'), outer_file=None,
            legwear_file=photo('gray'), tuck_mode='auto', compare_mode='false', quality_mode='quality',
            top_category='Платье', outer_category='', request_id='request_000000000090', async_mode='false', fresh='false', device='masha')
        self.assertEqual(result['status'], 'succeeded', result)
        _client, _model, _person, garment_urls, prompt, _seed = self.generate.await_args.args
        self.assertEqual(len(garment_urls), 3)
        self.assertIn('image 2 is the top: one-piece garment; image 3 is the pair of tights; image 4 is the pair of shoes', prompt)
        self.assertIn('The tights from image 3 are worn on both legs from the waist down to the toes', prompt)
        self.assertIn('inside the shoes', prompt)
        self.assertIn('never shortened, lifted or made see-through to show the tights', prompt)
        self.assertEqual(self.protect.await_args.args[3], ['bottom', 'one_piece', 'shoes'], 'tights change the legs')

    async def test_a_skirt_with_tights_keeps_both(self):
        await app.tryon_generate_look(
            person_file=photo('white'), top_file=photo('red'), bottom_file=photo('blue'), shoes_file=None, outer_file=None,
            legwear_file=photo('gray'), tuck_mode='auto', compare_mode='false', quality_mode='quality',
            top_category='Блуза', outer_category='', request_id='request_000000000091', async_mode='false', fresh='false', device='masha')
        prompt = self.generate.await_args.args[4]
        self.assertIn('image 3 is the lower-body garment; image 4 is the pair of tights', prompt)
        self.assertIn('over the feet', prompt, 'without shoes the tights cover the feet')

    async def test_fashn_refuses_a_layered_look_instead_of_dropping_a_garment(self):
        with patch.dict(os.environ, {'TRYON_PROVIDER': 'fashn', 'FASHN_API_KEY': 'key'}):
            result = await app.tryon_generate_look(
                person_file=photo('white'), top_file=photo('red'), bottom_file=None, shoes_file=None, outer_file=None,
                top2_file=photo('green'), outer2_file=None, tuck_mode='auto', compare_mode='false', quality_mode='quality',
                top_category='Футболка', outer_category='', top2_category='Лонгслив', outer2_category='',
                request_id='request_000000000010', async_mode='false', fresh='false', device='masha')
        self.assertEqual(result, {'error': 'Многослойные образы доступны только в новой примерке.'})
        self.fashn.assert_not_awaited()
        with patch.dict(os.environ, {'TRYON_PROVIDER': 'fashn', 'FASHN_API_KEY': 'key'}):
            tights = await app.tryon_generate_look(
                person_file=photo('white'), top_file=photo('red'), bottom_file=None, shoes_file=None, outer_file=None,
                legwear_file=photo('gray'), tuck_mode='auto', compare_mode='false', quality_mode='quality',
                top_category='Платье', outer_category='', request_id='request_000000000011', async_mode='false', fresh='false', device='masha')
        self.assertEqual(tights, {'error': 'Многослойные образы доступны только в новой примерке.'}, 'tights need the new try-on too')

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



class FaceRestore(unittest.TestCase):
    def test_a_finished_look_is_a_compact_jpeg(self):
        # A PNG of the same frame kept the phone waiting for 1-2 MB over mobile data.
        image = Image.effect_noise((600, 1600), 40).convert('RGB')
        url = app._result_data_url(image)
        self.assertTrue(url.startswith('data:image/jpeg;base64,'))
        data = app._data_url_to_bytes(url)[0]
        decoded = Image.open(BytesIO(data))
        self.assertEqual(decoded.size, (600, 1600))
        png = BytesIO(); image.save(png, format='PNG', compress_level=3)
        self.assertLess(len(data), len(png.getvalue()) / 2)

    def test_a_face_just_over_the_limit_is_tried_again_before_the_full_lock(self):
        # The full lock relit the whole frame and turned black tights green for a residual of 5.3% against 5%.
        import numpy as np
        import face_guard
        labels = np.zeros((128, 64), np.uint8)
        prepared = (Image.new('RGB', (64, 128)), None, [face_guard.Face((20, 10, 20, 24), np.zeros((5, 2)))], labels)
        calls = []

        def transplant(*args, relaxed=False, keep=()):
            calls.append(relaxed)
            if not relaxed:
                raise face_guard.AlignmentError('face-transplant-mismatch scale=0.93 angle=2.1 residual=0.053')
            return Image.new('RGB', (64, 128))
        with patch.object(app.face_guard, 'transplant_face', side_effect=transplant), \
                patch.object(app.footwear_guard, 'parse', return_value=labels):
            self.assertTrue(app._face_restored_output_url(Image.new('RGB', (64, 128)), prepared).startswith('data:image/jpeg'))
            self.assertEqual(calls, [False, True])
        calls.clear()
        with patch.object(app.face_guard, 'transplant_face', side_effect=face_guard.AlignmentError('face-not-found')), \
                patch.object(app.footwear_guard, 'parse', return_value=labels):
            self.assertIsNone(app._face_restored_output_url(Image.new('RGB', (64, 128)), prepared), 'no face is not retried')


if __name__ == '__main__':
    unittest.main()
