import asyncio
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

import access
import app
import jobs
from test_tryon_quality import upload


class JobBudget(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'AI_QUOTA_DB': self.temp.name + '/quota.sqlite3', 'AI_DEVICE_DAILY_QUOTA': '4',
            'AI_GLOBAL_DAILY_QUOTA': '8', 'AI_MAX_ACTIVE_TRYONS': '10'})
        self.env.start(); access.reset_state_for_tests()

    def tearDown(self):
        access.reset_state_for_tests(); self.env.stop(); self.temp.cleanup()

    def test_atomic_admission(self):
        with patch.dict(os.environ, {'AI_DEVICE_DAILY_QUOTA': '1'}):
            def start(i):
                try: return jobs.start('a', str(i), str(i), 1)[0]
                except HTTPException as e: return e.status_code
            with ThreadPoolExecutor(4) as executor:
                admitted = list(executor.map(start, range(4)))
        self.assertEqual(admitted.count(True), 1)
        self.assertEqual(admitted.count(429), 3)
        self.assertEqual(access.spent_today('a'), 1)

    def test_reserves_whole_outfit(self):
        access.charge('a', 2)
        with self.assertRaises(HTTPException): jobs.start('a', 'outfit', 'fingerprint', 3)
        self.assertEqual(access.spent_today('a'), 2)

    def test_refunds_only_unattempted_steps(self):
        jobs.start('a', 'outfit', 'fingerprint', 4)
        jobs.attempt('a', 'outfit')
        jobs.finish('a', 'outfit', {'error': 'identity lock rejected'})
        self.assertEqual(access.spent_today('a'), 1)
        jobs.finish('a', 'outfit', {'error': 'same error'})
        self.assertEqual(access.spent_today('a'), 1)

    def test_invalid_source_refunds_all(self):
        jobs.start('a', 'outfit', 'fingerprint', 2)
        jobs.finish('a', 'outfit', {'error': 'no face'})
        self.assertEqual(access.spent_today('a'), 0)

    def test_repeated_id_is_idempotent(self):
        self.assertTrue(jobs.start('a', 'id', 'fingerprint', 2)[0])
        self.assertFalse(jobs.start('a', 'id', 'fingerprint', 2)[0])
        self.assertEqual(access.spent_today('a'), 2)
        with self.assertRaises(HTTPException) as error: jobs.start('a', 'id', 'other', 2)
        self.assertEqual(error.exception.status_code, 409)

    def test_accounts_do_not_share_jobs(self):
        jobs.start('a', 'id', 'fingerprint', 1)
        self.assertIsNone(jobs.get('b', 'id'))
        self.assertTrue(jobs.start('b', 'id', 'fingerprint', 1)[0])

    def test_global_budget_limits_new_accounts(self):
        for owner in ['a', 'b']: jobs.start(owner, 'id', 'fingerprint', 4)
        with self.assertRaises(HTTPException): jobs.start('new-user', 'id', 'fingerprint', 1)

    def test_restart_retains_result_and_does_not_rebill(self):
        jobs.start('a', 'id', 'fingerprint', 1); jobs.attempt('a', 'id')
        jobs.finish('a', 'id', {'status': 'succeeded', 'outputUrl': 'protected'})
        access.reset_state_for_tests()
        self.assertEqual(jobs.get('a', 'id')['result']['outputUrl'], 'protected')
        self.assertFalse(jobs.start('a', 'id', 'fingerprint', 1)[0])
        self.assertEqual(access.spent_today('a'), 1)

    def test_restart_marks_unknown_work_failed_without_replaying(self):
        jobs.start('a', 'id', 'fingerprint', 3); jobs.attempt('a', 'id')
        access.reset_state_for_tests(); jobs.recover_interrupted()
        self.assertEqual(jobs.get('a', 'id')['status'], 'failed')
        self.assertEqual(access.spent_today('a'), 1)

    def test_admission_limits_active_jobs(self):
        with patch.dict(os.environ, {'AI_MAX_ACTIVE_TRYONS': '1'}):
            jobs.start('a', 'id', 'fingerprint', 1)
            with self.assertRaises(HTTPException): jobs.start('b', 'id', 'fingerprint', 1)
        self.assertEqual(access.spent_today('b'), 0)


class JobApi(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'AI_QUOTA_DB': self.temp.name + '/quota.sqlite3', 'FASHN_API_KEY': 'test',
            'AI_DEVICE_DAILY_QUOTA': '10'})
        self.env.start(); access.reset_state_for_tests()
        app._TRYON_LOOK_INFLIGHT.clear()
        self.prepare = patch.object(app, '_prepare_identity_source', return_value='prepared'); self.prepare.start()
        self.protect = patch.object(app, '_face_locked_output_url', AsyncMock(return_value='protected')); self.protect_mock = self.protect.start()
        async def provider(*args, **kwargs):
            await asyncio.sleep(.03)
            return {'status': 'succeeded', 'outputUrl': 'https://test/private-unprotected'}
        self.provider = AsyncMock(side_effect=provider)
        self.provider_patch = patch.object(app, '_run_fashn_tryon_with_category_fallback', self.provider); self.provider_patch.start()

    def tearDown(self):
        self.prepare.stop(); self.protect.stop(); self.provider_patch.stop()
        access.reset_state_for_tests(); self.env.stop(); self.temp.cleanup()

    async def generate(self, job_id='request_000000001', **overrides):
        kwargs = dict(person_file=upload(), top_file=upload(), bottom_file=None, shoes_file=None, outer_file=None,
            tuck_mode='auto', compare_mode='false', quality_mode='quality', top_category='Рубашка', outer_category='',
            request_id=job_id, async_mode='false', device='a')
        kwargs.update(overrides)
        return await app.tryon_generate_look(**kwargs)

    async def test_identical_inflight_charges_once(self):
        results = await asyncio.gather(self.generate(), self.generate())
        self.assertTrue(all(r['outputUrl'] == 'protected' for r in results))
        self.assertEqual(self.provider.await_count, 1)
        self.assertEqual(access.spent_today('a'), 1)
        self.assertNotIn('private-unprotected', str(results))

    async def test_each_garment_stage_reserves_and_attempts_one_operation(self):
        result = await self.generate(bottom_file=upload(), outer_file=upload(), outer_category='Плащ')
        self.assertEqual(result['outputUrl'], 'protected')
        self.assertEqual([step['step'] for step in result['steps']], ['bottom', 'top', 'outer'])
        self.assertEqual(self.provider.await_count, 3)
        self.assertEqual(access.spent_today('a'), 3)

    async def test_running_job_exposes_stage_progress_and_is_not_served_as_cached(self):
        first = self.generate(bottom_file=upload(), outer_file=upload(), async_mode='true')
        accepted = await first
        self.assertEqual(accepted.status_code, 202)
        await asyncio.sleep(.005)
        live = await app.tryon_job('request_000000001', device='a')
        self.assertEqual(live['status'], 'processing')
        self.assertEqual(live['progress']['total'], 3)
        self.assertIn(live['progress']['stage'], ['bottom', 'top', 'outer', 'composite'])
        self.assertNotIn('outputUrl', live)
        # A duplicate submit while running must not hand the progress payload back as a finished result.
        again = await self.generate(bottom_file=upload(), outer_file=upload(), async_mode='true')
        self.assertEqual(again.status_code, 202)
        await asyncio.gather(*app._TRYON_LOOK_INFLIGHT.values())
        done = await app.tryon_job('request_000000001', device='a')
        self.assertEqual(done['outputUrl'], 'protected')
        self.assertNotIn('progress', done)

    async def test_new_id_generates_new_seed_but_retry_reuses_result(self):
        await self.generate(); cached = await self.generate()
        await self.generate('request_000000002')
        self.assertTrue(cached['cached'])
        self.assertEqual(self.provider.await_count, 2)
        self.assertNotEqual(self.provider.call_args_list[0].kwargs['seed_override'], self.provider.call_args_list[1].kwargs['seed_override'])

    async def test_postprocessing_rejection_still_costs_provider_operation(self):
        with patch.object(app, '_face_locked_output_url', AsyncMock(side_effect=ValueError('rejected'))):
            result = await self.generate()
        self.assertEqual(result['error'], 'rejected')
        self.assertEqual(access.spent_today('a'), 1)

    async def test_four_garments_reserve_and_charge_one_operation_each(self):
        result = await self.generate(bottom_file=upload(), outer_file=upload(), shoes_file=upload())
        self.assertEqual(result['status'], 'succeeded')
        self.assertEqual(self.provider.await_count, 4)
        self.assertEqual(access.spent_today('a'), 4)
        self.assertEqual(self.protect_mock.call_args.args[3], ['bottom', 'outer', 'shoes', 'top'])

    async def test_stage_failure_releases_unused_reservations(self):
        calls = []
        async def provider(*args, **kwargs):
            calls.append(1)
            if len(calls) == 2:
                return {'error': 'provider down'}
            return {'status': 'succeeded', 'outputUrl': 'https://test/private-unprotected'}
        self.provider.side_effect = provider
        result = await self.generate(bottom_file=upload(), outer_file=upload())
        self.assertIn('error', result)
        self.assertEqual(len(calls), 2)
        self.assertEqual(access.spent_today('a'), 2, 'two attempted stages stay charged, the third is released')

    async def test_failed_outfit_never_retries_paid_calls(self):
        self.provider.side_effect = None
        self.provider.return_value = {'error': 'provider failed'}
        result = await self.generate(bottom_file=upload(), outer_file=upload())
        self.assertEqual(result['status'], 'failed')
        self.assertNotIn('outputUrl', result)
        self.assertEqual(self.provider.await_count, 1)
        self.assertEqual(access.spent_today('a'), 1)

    async def test_async_job_is_retrievable_by_owner_only(self):
        response = await self.generate(async_mode='true')
        self.assertEqual(response.status_code, 202)
        task = app._TRYON_LOOK_INFLIGHT['a:request_000000001']
        await task
        self.assertEqual((await app.tryon_job('request_000000001', 'a'))['outputUrl'], 'protected')
        with self.assertRaises(HTTPException): await app.tryon_job('request_000000001', 'b')

    async def test_disconnect_does_not_cancel_shared_work(self):
        request = asyncio.create_task(self.generate())
        while not app._TRYON_LOOK_INFLIGHT: await asyncio.sleep(.002)
        task = next(iter(app._TRYON_LOOK_INFLIGHT.values()))
        request.cancel()
        with self.assertRaises(asyncio.CancelledError): await request
        result = await task
        self.assertEqual(result['status'], 'succeeded')
        self.assertEqual(access.spent_today('a'), 1)

    async def test_slots_have_distinct_fingerprints(self):
        await self.generate(top_file=None, bottom_file=upload(), top_category='')
        with self.assertRaises(HTTPException) as error:
            await self.generate(top_file=None, shoes_file=upload(), top_category='')
        self.assertEqual(error.exception.status_code, 409)

    async def test_invalid_request_id_never_starts(self):
        with self.assertRaises(HTTPException): await self.generate('../../bad')
        self.provider.assert_not_called()


class Progress(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'AI_QUOTA_DB': self.temp.name + '/quota.sqlite3'})
        self.env.start(); access.reset_state_for_tests()

    def tearDown(self):
        access.reset_state_for_tests(); self.env.stop(); self.temp.cleanup()

    def test_progress_is_visible_while_running_and_replaced_by_the_result(self):
        jobs.start('a', 'job', 'fingerprint', 2)
        jobs.progress('a', 'job', {'progress': {'done': [], 'pending': ['top'], 'stage': 'bottom', 'total': 2}})
        live = jobs.get('a', 'job')
        self.assertEqual(live['status'], 'running')
        self.assertEqual(live['result']['status'], 'processing')
        self.assertEqual(live['result']['progress']['stage'], 'bottom')
        jobs.finish('a', 'job', {'status': 'succeeded', 'outputUrl': 'data:image/png;base64,AA'})
        self.assertNotIn('progress', jobs.get('a', 'job')['result'])
        jobs.progress('a', 'job', {'progress': {'stage': 'late'}})
        self.assertEqual(jobs.get('a', 'job')['result']['outputUrl'], 'data:image/png;base64,AA', 'finished jobs ignore late progress')
