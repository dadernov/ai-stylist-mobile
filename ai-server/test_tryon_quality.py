import os
from io import BytesIO
import unittest
from unittest.mock import AsyncMock, patch
from PIL import Image
from fastapi import UploadFile

import app
import face_guard
import tryon_policy


def upload():
    data = BytesIO(); Image.new('RGB', (80, 160), 'white').save(data, format='PNG'); data.seek(0)
    return UploadFile(file=data, filename='photo.png')


class QualityPolicy(unittest.TestCase):
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

    def test_face_position_and_scale_must_match(self):
        self.assertTrue(face_guard.faces_aligned([(100, 100, 40, 50)], [(101, 101, 40, 50)], (400, 800)))
        self.assertFalse(face_guard.faces_aligned([(100, 100, 40, 50)], [(130, 100, 40, 50)], (400, 800)))
        self.assertFalse(face_guard.faces_aligned([(100, 100, 40, 50)], [], (400, 800)))


class ApiFlow(unittest.IsolatedAsyncioTestCase):
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
