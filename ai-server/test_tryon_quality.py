import os
from io import BytesIO
import unittest
import tempfile
from unittest.mock import AsyncMock, patch
from PIL import Image, ImageDraw
import numpy as np
from fastapi import UploadFile

import app
import face_guard
import tryon_policy
from test_face_guard import face
from test_tryon_composite import person


def upload():
    data = BytesIO(); Image.new('RGB', (80, 160), 'white').save(data, format='PNG'); data.seek(0)
    return UploadFile(file=data, filename='photo.png')


class QualityPolicy(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(app.footwear_guard, 'protect', return_value=None)
        self.footwear = patcher.start()
        self.addCleanup(patcher.stop)

    def test_shifted_coat_is_composed_with_exact_source_face_and_background(self):
        cutout, _ = person()
        source = Image.new('RGB', cutout.size, (180, 80, 60))
        generated = Image.new('RGB', cutout.size, (20, 140, 30))
        prepared = (source, cutout, [face()])
        with patch.object(face_guard, 'detect_faces', return_value=[face(offset=(10, 8))]), \
             patch.object(app, '_silhouette', return_value=cutout):
            result, status = app._apply_identity_lock(b'photo', generated, ['long_outer'], prepared)
        self.assertEqual(status, 'composed')
        box = face_guard.protected_head(face(), source.size)
        np.testing.assert_array_equal(np.asarray(result)[box[1]:box[3], box[0]:box[2]], np.asarray(source)[box[1]:box[3], box[0]:box[2]])
        np.testing.assert_array_equal(np.asarray(result)[:, :30], np.asarray(source)[:, :30])
        self.assertEqual(result.getpixel((200, 710)), generated.getpixel((200, 710)))
        self.assertEqual(self.footwear.call_args.args[2], ['long_outer'])
        self.assertEqual(self.footwear.call_args.args[1].size, source.size)

    def test_footwear_mask_is_used_after_alignment(self):
        cutout, _ = person()
        source = Image.new('RGB', cutout.size, 'red')
        generated = Image.new('RGB', cutout.size, 'green')
        keep = Image.new('L', source.size)
        ImageDraw.Draw(keep).rectangle((180, 690, 220, 735), fill=255)
        self.footwear.return_value = keep
        with patch.object(face_guard, 'detect_faces', return_value=[face()]), patch.object(app, '_silhouette', return_value=cutout):
            result, status = app._apply_identity_lock(b'photo', generated, ['long_outer'], (source, cutout, [face()]))
        self.assertEqual(status, 'composed')
        self.assertEqual(result.getpixel((200, 710)), source.getpixel((200, 710)))
        self.assertEqual(result.getpixel((200, 600)), generated.getpixel((200, 600)))

    def test_generated_margins_are_removed_without_stretching(self):
        cutout, _ = person()
        source = Image.new('RGB', cutout.size, (180, 80, 60))
        narrow = Image.new('RGB', source.size, (20, 140, 30))
        ImageDraw.Draw(narrow).rectangle((190, 400, 210, 700), fill=(40, 40, 200))
        for size, origin in [((600, 800), (100, 0)), ((400, 1100), (0, 150))]:
            with self.subTest(size=size):
                generated = Image.new('RGB', size, 'white')
                generated.paste(narrow, origin)
                with patch.object(face_guard, 'detect_faces', return_value=[face()]) as detect, \
                     patch.object(app, '_silhouette', return_value=cutout):
                    result, status = app._apply_identity_lock(b'photo', generated, ['long_outer'], (source, cutout, [face()]))
                self.assertEqual(status, 'composed')
                np.testing.assert_array_equal(detect.call_args.args[0], narrow)
                self.assertEqual(result.getpixel((200, 680)), (40, 40, 200))
                self.assertEqual(result.getpixel((185, 680)), (20, 140, 30))
                self.assertEqual(result.getpixel((200, 80)), source.getpixel((200, 80)))
                np.testing.assert_array_equal(np.asarray(result)[:, :30], np.asarray(source)[:, :30])

    def test_actual_movement_is_still_rejected_after_margin_removal(self):
        cutout, _ = person()
        source = Image.new('RGB', cutout.size)
        with patch.object(face_guard, 'detect_faces', return_value=[face(offset=(90, 0))]), \
             patch.object(app, '_silhouette') as segment, self.assertRaisesRegex(ValueError, 'совместить'):
            app._apply_identity_lock(b'photo', Image.new('RGB', (600, 800)), ['long_outer'], (source, cutout, [face()]))
        segment.assert_not_called()

    def test_png_cache_has_a_byte_limit(self):
        app._TRYON_LOOK_CACHE.clear()
        result = {'outputUrl': 'x' * 200, 'status': 'succeeded'}
        with patch.dict(os.environ, {'FASHN_LOOK_CACHE_MAX_BYTES': '400'}):
            app._set_cached_tryon_look('first', result)
            app._set_cached_tryon_look('second', result)
        self.assertIsNone(app._get_cached_tryon_look('first'))
        self.assertIsNotNone(app._get_cached_tryon_look('second'))
        app._TRYON_LOOK_CACHE.clear()

    def test_provider_inputs_force_quality_even_with_legacy_env(self):
        with patch.dict(os.environ, {'FASHN_GENERATION_MODE': 'fast', 'FASHN_RESOLUTION': '1k'}):
            inputs = app._build_fashn_inputs('tryon-max', 'person', 'garment', generation_mode_override='fast')
        self.assertEqual(inputs['generation_mode'], 'quality')
        self.assertEqual(inputs['resolution'], '2k')

    def test_long_coat_has_full_length_prompt_and_composite_zone(self):
        for category in ['Плащ', 'Тренч', 'Пальто']:
            self.assertEqual(tryon_policy.composite_slot('outer', category), 'long_outer')
            prompt = tryon_policy.garment_prompt('outer', category)
            self.assertIn('entire garment from collar to hem', prompt)
            self.assertNotIn('everything underneath unchanged', prompt)

    def test_dress_does_not_freeze_lower_body(self):
        self.assertEqual(tryon_policy.composite_slot('top', 'Платье'), 'one_piece')
        self.assertIn('full skirt', tryon_policy.garment_prompt('top', 'Платье'))

    def test_only_non_shoe_prompts_preserve_existing_footwear(self):
        for slot in ['top', 'bottom', 'outer']:
            self.assertIn('Preserve the existing shoes', tryon_policy.garment_prompt(slot))
        self.assertNotIn('Preserve the existing shoes', tryon_policy.garment_prompt('shoes'))


class ApiFlow(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'AI_QUOTA_DB': self.temp.name + '/quota.sqlite3'})
        self.env.start()
        app.access.reset_state_for_tests()

    def tearDown(self):
        app.access.reset_state_for_tests()
        self.env.stop()
        self.temp.cleanup()

    async def test_legacy_fast_request_uses_quality_and_coat_is_last(self):
        app._TRYON_LOOK_CACHE.clear(); app._TRYON_LOOK_INFLIGHT.clear()
        generate = AsyncMock(return_value={'status': 'succeeded', 'outputUrl': 'https://example.test/result.png'})
        with patch.dict(os.environ, {'FASHN_API_KEY': 'test-key'}), patch.object(app, '_prepare_identity_source', return_value='prepared'), \
             patch.object(app, '_run_fashn_tryon_with_category_fallback', generate), \
             patch.object(app, '_face_locked_output_url', AsyncMock(return_value='data:image/png;base64,protected')) as protect, patch.object(app.access, 'charge'):
            result = await app.tryon_generate_look(person_file=upload(), top_file=upload(), bottom_file=None, shoes_file=upload(), outer_file=upload(),
                tuck_mode='auto', compare_mode='false', quality_mode='fast', top_category='Рубашка', outer_category='Плащ', device='test')
        self.assertEqual(result['status'], 'succeeded', result)
        self.assertEqual(result['qualityModeUsed'], 'quality')
        self.assertEqual([step['step'] for step in result['steps']], ['top', 'shoes', 'outer'])
        self.assertEqual(generate.await_count, 3)
        for call in generate.call_args_list:
            self.assertEqual(call.args[2], 'tryon-max')
            self.assertEqual(call.kwargs['generation_mode_override'], 'quality')
        self.assertIn('long_outer', protect.call_args.args[3])

    async def test_unprotected_output_is_never_returned(self):
        with patch.object(app, '_load_image_from_url_or_data_url', AsyncMock(return_value=Image.new('RGB', (80, 160)))), \
             patch.object(app, '_apply_identity_lock', side_effect=ValueError('unsafe')):
            with self.assertRaises(ValueError):
                await app._face_locked_output_url(None, b'photo', 'https://example.test/result.png', ['top'])

    async def test_mask_failure_is_reported_separately_and_logged_without_photos(self):
        image = Image.new('RGB', (400, 800))
        with patch.object(app, '_load_image_from_url_or_data_url', AsyncMock(return_value=image)), \
             patch.object(app, '_apply_identity_lock', return_value=(image, 'no-silhouette')), patch('builtins.print') as log:
            with self.assertRaisesRegex(ValueError, 'отделить одежду от фона'):
                await app._face_locked_output_url(None, b'private-photo', 'https://example.test/private-result.png', ['outer'])
        self.assertIn('no-silhouette', log.call_args.args[0])
        self.assertNotIn('private', log.call_args.args[0])

    async def test_unusable_source_is_rejected_before_paid_generation(self):
        app._TRYON_LOOK_CACHE.clear(); app._TRYON_LOOK_INFLIGHT.clear()
        generate = AsyncMock()
        with patch.dict(os.environ, {'FASHN_API_KEY': 'test-key'}), patch.object(app, '_prepare_identity_source', side_effect=ValueError('No face')), \
             patch.object(app, '_run_fashn_tryon_with_category_fallback', generate):
            result = await app.tryon_generate_look(person_file=upload(), top_file=upload(), bottom_file=None, shoes_file=None, outer_file=None,
                tuck_mode='auto', compare_mode='false', quality_mode='quality', top_category='Рубашка', outer_category='', device='test')
        self.assertIn('error', result)
        self.assertNotIn('outputUrl', result)
        generate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
