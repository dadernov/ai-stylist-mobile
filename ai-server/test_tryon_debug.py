import hashlib
from concurrent.futures import ThreadPoolExecutor
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import time
import unittest
from unittest.mock import AsyncMock, patch

from PIL import Image

import tryon_debug


class LocalDiagnostics(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name) / 'diagnostics'
        self.owner = 'reported-owner'
        self.environment = {
            'AI_TRYON_DEBUG_DIR': str(self.root),
            'AI_TRYON_DEBUG_OWNER_SHA256': hashlib.sha256(self.owner.encode()).hexdigest(),
            'AI_TRYON_DEBUG_UNTIL': str(time.time() + 300),
        }
        self.env = patch.dict(os.environ, self.environment, clear=True)
        self.env.start()
        self.schedule = patch.object(tryon_debug, '_schedule').start()
        self.image = Image.new('RGB', (4, 5), (130, 140, 150))

    def tearDown(self):
        patch.stopall()
        self.env.stop()
        self.directory.cleanup()

    def capture(self, **changes):
        args = dict(owner=self.owner, job_id='job', source_content=b'original-photo', raw_image=self.image)
        args.update(changes)
        self.assertIsNone(tryon_debug.capture(**args))

    def cases(self):
        return list(self.root.glob('case-*'))

    def test_disabled_without_configuration(self):
        with patch.dict(os.environ, {}, clear=True):
            self.capture()
        self.assertFalse(self.root.exists())

    def test_wrong_owner_or_expired_window_does_not_touch_disk(self):
        self.capture(owner='someone-else')
        with patch.dict(os.environ, {'AI_TRYON_DEBUG_UNTIL': str(time.time() - 1)}):
            self.capture()
        self.assertFalse(self.root.exists())

    def test_nonfinite_and_unbounded_windows_are_disabled(self):
        for value in ('nan', 'inf', 'bad', str(time.time() + 3600)):
            with patch.dict(os.environ, {'AI_TRYON_DEBUG_UNTIL': value}):
                self.capture()
        self.assertFalse(self.root.exists())

    def test_capture_is_private_bounded_and_has_no_plaintext_identifiers(self):
        self.capture(job_id='../../not-a-path')
        case, = self.cases()
        self.assertEqual(stat.S_IMODE(self.root.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(case.stat().st_mode), 0o700)
        for path in [*case.iterdir(), self.root / tryon_debug._CLAIM]:
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual((case / 'source.image').read_bytes(), b'original-photo')
        with Image.open(case / 'raw.png') as decoded:
            self.assertEqual(decoded.size, self.image.size)
        manifest = json.loads((case / 'manifest.json').read_text())
        self.assertEqual(manifest['expires'], float(self.environment['AI_TRYON_DEBUG_UNTIL']))
        self.assertLessEqual(manifest['expires'] - manifest['created'], 1800)
        self.assertNotIn(self.owner, (case / 'manifest.json').read_text())
        self.schedule.assert_called_once()

    def test_claim_survives_cleanup_and_prevents_second_capture(self):
        self.capture()
        case, = self.cases()
        tryon_debug._cleanup_case(str(self.root), case.name, now=time.time() + 1801)
        self.assertFalse(case.exists())
        self.capture(job_id='second-job')
        self.assertFalse(self.cases())
        self.assertTrue((self.root / tryon_debug._CLAIM).exists())

    def test_concurrent_calls_have_one_persistent_claim(self):
        self.root.mkdir(mode=0o700)
        with ThreadPoolExecutor(max_workers=2) as executor:
            list(executor.map(lambda job: self.capture(job_id=job), ['first', 'second']))
        self.assertEqual(len(self.cases()), 1)
        self.schedule.assert_called_once()

    def test_size_limits_fail_closed(self):
        with patch.object(tryon_debug, 'MAX_SOURCE_BYTES', 2):
            self.capture()
        self.assertFalse(self.root.exists())
        with patch.object(tryon_debug, 'MAX_RAW_BYTES', 2):
            self.capture()
        self.assertFalse(self.cases())
        self.assertFalse((self.root / tryon_debug._CLAIM).exists())

    def test_disk_failure_never_changes_generation_or_logs_inputs(self):
        with patch.object(tryon_debug, '_write', side_effect=OSError('private details')), patch('sys.stdout', new_callable=io.StringIO) as stdout, patch('sys.stderr', new_callable=io.StringIO) as stderr:
            self.capture()
        self.assertFalse(self.cases())
        self.assertEqual(stdout.getvalue(), '')
        self.assertEqual(stderr.getvalue(), '')

    def test_partial_write_is_removed(self):
        original = tryon_debug._write
        def fail_raw(directory, name, data):
            if name == 'raw.png':
                raise OSError('full disk')
            original(directory, name, data)
        with patch.object(tryon_debug, '_write', side_effect=fail_raw):
            self.capture()
        self.assertFalse(self.cases())

    def test_symlink_root_and_public_directory_are_rejected(self):
        target = Path(self.directory.name) / 'elsewhere'
        target.mkdir(mode=0o700)
        self.root.symlink_to(target, target_is_directory=True)
        self.capture()
        self.assertEqual(list(target.iterdir()), [])
        self.root.unlink()
        self.root.mkdir(mode=0o755)
        self.capture()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_symlink_ancestor_is_rejected(self):
        target = Path(self.directory.name) / 'real-parent'
        target.mkdir(mode=0o700)
        link = Path(self.directory.name) / 'linked-parent'
        link.symlink_to(target, target_is_directory=True)
        with patch.dict(os.environ, {'AI_TRYON_DEBUG_DIR': str(link / 'capture')}):
            self.capture()
        self.assertEqual(list(target.iterdir()), [])

    def test_timer_failure_removes_photos_without_failing_generation(self):
        self.schedule.side_effect = RuntimeError('timer unavailable')
        self.capture()
        self.assertFalse(self.cases())

    def test_cleanup_does_not_follow_links_or_remove_other_files(self):
        self.capture()
        case, = self.cases()
        unrelated = self.root / 'unrelated.txt'
        unrelated.write_text('keep')
        target = Path(self.directory.name) / 'private.txt'
        target.write_text('do not touch')
        (case / 'raw.png').unlink()
        (case / 'raw.png').symlink_to(target)
        tryon_debug._cleanup_case(str(self.root), case.name, force=True)
        self.assertEqual(target.read_text(), 'do not touch')
        self.assertEqual(unrelated.read_text(), 'keep')
        self.assertTrue((case / 'raw.png').is_symlink())
        self.assertFalse((case / 'source.image').exists())

    def test_restart_recovers_expired_and_pending_cleanup(self):
        self.capture()
        case, = self.cases()
        self.schedule.reset_mock()
        tryon_debug.cleanup()
        self.schedule.assert_called_once()
        with patch.object(tryon_debug.time, 'time', return_value=time.time() + 1801):
            tryon_debug.cleanup()
        self.assertFalse(case.exists())

    def test_restart_cleans_partial_directory_without_manifest(self):
        self.root.mkdir(mode=0o700)
        case = self.root / ('case-' + 'a' * 64)
        case.mkdir(mode=0o700)
        (case / 'source.image').write_bytes(b'partial-image')
        tryon_debug.cleanup()
        self.assertFalse(case.exists())


class DiagnosticWiring(unittest.IsolatedAsyncioTestCase):
    async def test_exact_context_and_original_pair_are_captured_before_compositing(self):
        import app
        source = b'original-source-bytes'
        raw = Image.new('RGB', (3, 4), 'red')
        prepared = object()
        events = []
        def capture(owner, job_id, content, image):
            self.assertEqual((owner, job_id, content), ('selected-owner', 'selected-job', source))
            self.assertIs(image, raw)
            self.assertEqual(image.getpixel((0, 0)), (255, 0, 0))
            events.append('capture')
        def compose(content, image, slots, supplied):
            self.assertEqual(content, source)
            self.assertIs(image, raw)
            self.assertEqual(slots, ('top', 'bottom'))
            self.assertIs(supplied, prepared)
            events.append('compose')
            image.putpixel((0, 0), (0, 255, 0))
            return image, 'composed'
        with patch.object(app, '_load_image_from_url_or_data_url', new=AsyncMock(return_value=raw)), \
             patch.object(app.tryon_debug, 'capture', side_effect=capture) as diagnostic, \
             patch.object(app, '_apply_identity_lock', side_effect=compose), patch('builtins.print'):
            output = await app._face_locked_output_url(object(), source, 'provider-result',
                ('top', 'bottom'), prepared, debug_context=('selected-owner', 'selected-job'))
        diagnostic.assert_called_once()
        self.assertEqual(events, ['capture', 'compose'])
        self.assertTrue(output.startswith('data:image/png;base64,'))

    async def test_no_context_does_not_invoke_diagnostic_capture(self):
        import app
        raw = Image.new('RGB', (3, 4), 'red')
        with patch.object(app, '_load_image_from_url_or_data_url', new=AsyncMock(return_value=raw)), \
             patch.object(app.tryon_debug, 'capture') as diagnostic, \
             patch.object(app, '_apply_identity_lock', return_value=(raw, 'composed')), patch('builtins.print'):
            output = await app._face_locked_output_url(object(), b'source', 'provider-result')
        diagnostic.assert_not_called()
        self.assertTrue(output.startswith('data:image/png;base64,'))


if __name__ == '__main__':
    unittest.main()
