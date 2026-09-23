import os
from io import BytesIO
import unittest
import tempfile
from unittest.mock import AsyncMock, patch
from PIL import Image, ImageCms, ImageDraw
import numpy as np
from fastapi import UploadFile

import app
import face_guard
import tryon_frame
import tryon_policy
import image_color
from test_face_guard import face
from test_tryon_composite import person


def upload():
    data = BytesIO(); Image.new('RGB', (80, 160), 'white').save(data, format='PNG'); data.seek(0)
    return UploadFile(file=data, filename='photo.png')


def photo_bytes(image):
    data = BytesIO()
    image.save(data, format='PNG')
    return data.getvalue()


class QualityPolicy(unittest.TestCase):
    def setUp(self):
        self.labels = (np.asarray(person()[0].getchannel('A')) > 0).astype(np.uint8) * 4
        self.labels[32:114, 162:239] = 11
        parsing = patch.object(app.footwear_guard, 'parse', return_value=self.labels)
        parsing.start()
        self.addCleanup(parsing.stop)
        lighting = patch.object(app.image_color, 'match_source_lighting', side_effect=lambda source, generated, *args: generated)
        lighting.start()
        self.addCleanup(lighting.stop)
        patcher = patch.object(app.tryon_matte, 'prepare', wraps=app.tryon_matte.prepare)
        self.matte = patcher.start()
        self.addCleanup(patcher.stop)

    def test_shifted_coat_is_composed_with_exact_source_face_and_background(self):
        cutout, _ = person()
        source = Image.new('RGB', cutout.size, (180, 80, 60))
        generated = Image.new('RGB', cutout.size, (20, 140, 30))
        prepared = (source, cutout, [face()], self.labels)
        with patch.object(face_guard, 'detect_faces', return_value=[face(offset=(10, 8))]), \
             patch.object(app, '_silhouette', return_value=cutout):
            result, status = app._apply_identity_lock(photo_bytes(source), generated, ['long_outer'], prepared)
        self.assertEqual(status, 'composed')
        protected = np.asarray(face_guard.protected_head_mask(face(), source.size, self.labels, self.labels)) == 255
        np.testing.assert_array_equal(np.asarray(result)[protected], np.asarray(source)[protected])
        x, y, w, h = map(int, face().box)
        np.testing.assert_array_equal(np.asarray(result)[y:y+h, x:x+w], np.asarray(source)[y:y+h, x:x+w])
        np.testing.assert_array_equal(np.asarray(result)[:, :30], np.asarray(source)[:, :30])
        self.assertEqual(result.getpixel((200, 710)), generated.getpixel((200, 710)))
        self.assertEqual(self.matte.call_args.args[5], ['long_outer'])
        self.assertEqual(self.matte.call_args.args[3].shape, self.labels.shape)

    def test_refined_matte_is_used_after_alignment(self):
        cutout, _ = person()
        source = Image.new('RGB', cutout.size, 'red')
        generated = Image.new('RGB', cutout.size, 'green')
        keep = Image.new('L', source.size)
        ImageDraw.Draw(keep).rectangle((180, 690, 220, 735), fill=255)
        self.matte.return_value = (generated, keep, self.labels)
        with patch.object(face_guard, 'detect_faces', return_value=[face()]), patch.object(app, '_silhouette', return_value=cutout):
            result, status = app._apply_identity_lock(photo_bytes(source), generated, ['long_outer'], (source, cutout, [face()], self.labels))
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
                    result, status = app._apply_identity_lock(photo_bytes(source), generated, ['long_outer'], (source, cutout, [face()], self.labels))
                self.assertEqual(status, 'composed')
                np.testing.assert_array_equal(detect.call_args.args[0], narrow)
                self.assertEqual(result.getpixel((200, 680)), (40, 40, 200))
                self.assertEqual(result.getpixel((185, 680)), (20, 140, 30))
                self.assertEqual(result.getpixel((200, 80)), source.getpixel((200, 80)))
                np.testing.assert_array_equal(np.asarray(result)[:, :30], np.asarray(source)[:, :30])

    def test_provider_frame_on_its_own_canvas_is_cropped_back_not_zoomed(self):
        cutout, _ = person()
        source = Image.new('RGB', cutout.size, (180, 80, 60))
        padded, box = tryon_frame.pad(source)
        self.assertGreater(padded.width, source.width)
        generated = Image.new('RGB', (padded.width * 2, padded.height * 2), (20, 140, 30))
        ImageDraw.Draw(generated).rectangle(((190 + box[0]) * 2, 800, (210 + box[0]) * 2 + 1, 1400), fill=(40, 40, 200))
        with patch.object(face_guard, 'detect_faces', return_value=[face()]) as detect, \
             patch.object(app, '_silhouette', return_value=cutout):
            result, status = app._apply_identity_lock(photo_bytes(source), generated, ['long_outer'], (source, cutout, [face()], self.labels))
        self.assertEqual(status, 'composed')
        self.assertEqual(detect.call_args.args[0].size, source.size)
        self.assertEqual(result.getpixel((200, 680)), (40, 40, 200))
        self.assertEqual(result.getpixel((185, 680)), (20, 140, 30))
        self.assertEqual(result.getpixel((200, 80)), source.getpixel((200, 80)))

    def test_rejected_alignment_carries_the_fitted_frame_for_the_fallback(self):
        cutout, _ = person()
        source = Image.new('RGB', cutout.size)
        with patch.object(face_guard, 'detect_faces', return_value=[face(offset=(90, 0))]), \
             patch.object(app, '_silhouette'), self.assertRaises(app.AlignmentRejected) as context:
            app._apply_identity_lock(b'photo', Image.new('RGB', (600, 800), 'green'), ['long_outer'], (source, cutout, [face()], self.labels))
        self.assertEqual(context.exception.frame.size, source.size)
        self.assertEqual(context.exception.frame.getpixel((10, 10)), (0, 128, 0))

    def test_actual_movement_is_still_rejected_after_margin_removal(self):
        cutout, _ = person()
        source = Image.new('RGB', cutout.size)
        with patch.object(face_guard, 'detect_faces', return_value=[face(offset=(90, 0))]), \
             patch.object(app, '_silhouette') as segment, self.assertRaisesRegex(ValueError, 'совместить'):
            app._apply_identity_lock(b'photo', Image.new('RGB', (600, 800)), ['long_outer'], (source, cutout, [face()], self.labels))
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

    def test_full_resolution_head_detail_is_not_replaced_by_thumbnail(self):
        cutout, _ = person()
        rng = np.random.default_rng(7)
        source = Image.fromarray(rng.integers(0, 256, (2400, 1200, 3), dtype=np.uint8))
        working = source.resize(cutout.size)
        generated = Image.new('RGB', cutout.size, 'green')
        with patch.object(face_guard, 'detect_faces', return_value=[face()]), patch.object(app, '_silhouette', return_value=cutout):
            result, status = app._apply_identity_lock(photo_bytes(source), generated, ['top'], (working, cutout, [face()], self.labels))
        self.assertEqual(status, 'composed')
        self.assertEqual(result.size, source.size)
        mask = face_guard.protected_head_mask(face(), working.size, self.labels, self.labels).resize(source.size, Image.Resampling.NEAREST)
        protected = np.asarray(mask) == 255
        np.testing.assert_array_equal(np.asarray(result)[protected], np.asarray(source)[protected])
        self.assertEqual(result.getpixel((600, 750)), (0, 128, 0))
        self.assertEqual(result.info['icc_profile'], image_color.SRGB_BYTES)


class ColorHandling(unittest.TestCase):
    def test_original_resolution_respects_camera_orientation(self):
        source = Image.new('RGB', (2600, 1200), (180, 100, 65))
        exif = source.getexif()
        exif[274] = 6
        data = BytesIO()
        source.save(data, 'JPEG', exif=exif)
        full = app._working_image(data.getvalue(), max_side=None)
        working = app._working_image(data.getvalue())
        self.assertEqual(full.size, (1200, 2600))
        self.assertEqual(max(working.size), 2048)
        self.assertNotIn(274, full.getexif())

    def test_tagged_inputs_and_provider_jpeg_keep_srgb_profile(self):
        source = Image.new('RGB', (80, 160), (180, 100, 65))
        source.info['icc_profile'] = image_color.SRGB_BYTES
        data = photo_bytes(source)
        working = app._working_image(data)
        prepared = app._prepare_tryon_image_data_url(data, 'image/png', 2048, 97)
        encoded, _ = app._data_url_to_bytes(prepared)
        provider_input = Image.open(BytesIO(encoded))
        self.assertEqual(working.info['icc_profile'], image_color.SRGB_BYTES)
        self.assertEqual(provider_input.info['icc_profile'], image_color.SRGB_BYTES)
        np.testing.assert_array_equal(working, source)

    def test_profile_is_converted_not_just_relabelled(self):
        lab = ImageCms.ImageCmsProfile(ImageCms.createProfile('LAB'))
        source = Image.new('LAB', (4, 4), (160, 155, 110))
        source.info['icc_profile'] = lab.tobytes()
        expected = ImageCms.profileToProfile(source, lab, image_color.SRGB, outputMode='RGB')
        actual = image_color.to_srgb(source)
        np.testing.assert_array_equal(actual, expected)
        self.assertNotEqual(actual.getpixel((0, 0)), source.getpixel((0, 0)))

    def test_transparency_survives_color_conversion(self):
        source = Image.new('RGBA', (4, 4), (150, 60, 30, 71))
        source.info['icc_profile'] = image_color.SRGB_BYTES
        actual = image_color.to_srgb(source)
        self.assertEqual(actual.getpixel((0, 0)), (150, 60, 30, 71))

    def test_invalid_profile_is_not_silently_stripped(self):
        source = Image.new('RGB', (4, 4))
        source.info['icc_profile'] = b'broken profile'
        with self.assertRaisesRegex(ValueError, 'цветовой профиль'):
            app._prepare_tryon_image_data_url(photo_bytes(source), 'image/png', 2048, 97)

    def test_legacy_disabled_resize_cannot_bypass_color_normalization(self):
        source = Image.new('RGB', (4, 4), 'red')
        url = app._prepare_tryon_image_data_url(photo_bytes(source), 'image/png', 0, 97)
        content, _ = app._data_url_to_bytes(url)
        self.assertEqual(Image.open(BytesIO(content)).info['icc_profile'], image_color.SRGB_BYTES)


class ProviderPolicy(unittest.TestCase):
    def test_selected_inner_top_keeps_outerwear_open(self):
        prompt = tryon_policy.garment_prompt('outer', 'Плащ', keep_outer_open=True)
        self.assertIn('fully open and unfastened', prompt)
        self.assertIn('selected inner top and its print clearly visible', prompt)
        self.assertIn('Do not close, button up, zip up', prompt)
        self.assertIn('Preserve every visible hand and finger', prompt)

    def test_single_outerwear_uses_reference_fastening_state(self):
        prompt = tryon_policy.garment_prompt('outer', 'Плащ')
        self.assertIn('Match the open or closed state of the product photo', prompt)
        self.assertNotIn('fully open and unfastened', prompt)

    def test_provider_inputs_force_quality_even_with_legacy_env(self):
        with patch.dict(os.environ, {'FASHN_GENERATION_MODE': 'fast', 'FASHN_RESOLUTION': '1k'}):
            inputs = app._build_fashn_inputs('tryon-max', 'person', 'garment', generation_mode_override='fast')
        self.assertEqual(inputs['generation_mode'], 'quality')
        self.assertEqual(inputs['resolution'], '2k')
        self.assertEqual(inputs['output_format'], 'png')

    def test_long_coat_has_full_length_prompt_and_composite_zone(self):
        for category in ['Плащ', 'Тренч', 'Пальто']:
            self.assertEqual(tryon_policy.composite_slot('outer', category), 'long_outer')
            prompt = tryon_policy.garment_prompt('outer', category)
            self.assertIn('entire garment from collar to hem', prompt)
            self.assertNotIn('everything underneath unchanged', prompt)

    def test_dress_does_not_freeze_lower_body(self):
        self.assertEqual(tryon_policy.composite_slot('top', 'Платье'), 'one_piece')
        self.assertIn('full skirt', tryon_policy.garment_prompt('top', 'Платье'))

    def test_tucked_inner_top_must_not_tuck_the_coat(self):
        prompt = tryon_policy.garment_prompt('outer', 'Плащ', 'tucked')
        self.assertIn('For the inner top only, never the outerwear', prompt)
        self.assertIn('Do not tuck the outer garment', prompt)

    def test_only_non_shoe_prompts_preserve_existing_footwear(self):
        for slot in ['top', 'bottom', 'outer']:
            prompt = tryon_policy.garment_prompt(slot)
            self.assertIn(tryon_policy.FOOTWEAR, prompt)
            self.assertIn('Keep bare feet bare.', prompt)
            self.assertIn('Shoes or slippers lying on the floor are background', prompt)
        self.assertNotIn(tryon_policy.FOOTWEAR, tryon_policy.garment_prompt('shoes'))


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

    async def test_every_selected_garment_gets_its_own_stage_innermost_first(self):
        for mode, instruction in [
            ('tucked', 'Fully tuck the top'),
            ('untucked', 'completely untucked'),
        ]:
            with self.subTest(mode=mode):
                provider = AsyncMock(return_value={'status': 'succeeded', 'outputUrl': 'https://example.test/result.png'})
                with patch.dict(os.environ, {'FASHN_API_KEY': 'test-key'}), \
                     patch.object(app, '_prepare_identity_source', return_value='prepared'), \
                     patch.object(app, '_run_fashn_tryon', provider), \
                     patch.object(app, '_face_locked_output_url', AsyncMock(return_value='data:image/png;base64,protected')):
                    result = await app.tryon_generate_look(person_file=upload(), top_file=upload(), bottom_file=upload(),
                        shoes_file=upload(), outer_file=upload(), tuck_mode=mode, compare_mode='false', quality_mode='quality',
                        top_category='Футболка', outer_category='Куртка', device='test')
                self.assertEqual(result.get('status'), 'succeeded', result)
                self.assertEqual(result['tuckModeUsed'], mode)
                self.assertTrue(result['identityLocked'])
                self.assertGreaterEqual(result['timings']['totalSeconds'], result['timings']['compositeSeconds'])
                self.assertTrue(all(step['durationSeconds'] >= 0 for step in result['steps']))
                self.assertEqual([step['step'] for step in result['steps']], ['bottom', 'shoes', 'top', 'outer'])
                self.assertEqual(provider.await_count, 4)
                inputs = [call.args[3] for call in provider.call_args_list]
                for stage in inputs:
                    self.assertEqual(stage['generation_mode'], 'quality')
                    self.assertTrue(stage['product_image'].startswith('data:image/'))
                self.assertIn(instruction, inputs[2]['prompt'])
                self.assertIn('Remove the old collar', inputs[2]['prompt'])
                self.assertNotIn('Fully tuck the top', inputs[3]['prompt'].replace('For the inner top only, never the outerwear: Fully tuck the top', ''))
                self.assertIn('fully open and unfastened', inputs[3]['prompt'])
                self.assertIn(tryon_policy.TROUSERS, inputs[0]['prompt'])
                # The photo goes out on the provider canvas; later stages dress the
                # provider's own frame instead of fitting the photo a second time.
                self.assertTrue(inputs[0]['model_image'].startswith('data:image/jpeg'))
                self.assertEqual([stage['model_image'] for stage in inputs[1:]], ['https://example.test/result.png'] * 3)

    async def test_legacy_fast_request_uses_quality_for_every_stage(self):
        app._TRYON_LOOK_CACHE.clear(); app._TRYON_LOOK_INFLIGHT.clear()
        generate = AsyncMock(return_value={'status': 'succeeded', 'outputUrl': 'https://example.test/result.png'})
        with patch.dict(os.environ, {'FASHN_API_KEY': 'test-key'}), patch.object(app, '_prepare_identity_source', return_value='prepared'), \
             patch.object(app, '_run_fashn_tryon_with_category_fallback', generate), \
             patch.object(app, '_face_locked_output_url', AsyncMock(return_value='data:image/png;base64,protected')) as protect, patch.object(app.access, 'charge'):
            result = await app.tryon_generate_look(person_file=upload(), top_file=upload(), bottom_file=None, shoes_file=upload(), outer_file=upload(),
                tuck_mode='auto', compare_mode='false', quality_mode='fast', top_category='Рубашка', outer_category='Плащ', device='test')
        self.assertEqual(result['status'], 'succeeded', result)
        self.assertEqual(result['qualityModeUsed'], 'quality')
        self.assertEqual([step['step'] for step in result['steps']], ['shoes', 'top', 'outer'])
        self.assertEqual(generate.await_count, 3)
        for call in generate.call_args_list:
            self.assertEqual(call.args[2], 'tryon-max')
            self.assertEqual(call.kwargs['generation_mode_override'], 'quality')
        self.assertIn('long_outer', protect.call_args.args[3])

    async def test_collage_strategy_remains_available_as_one_call(self):
        app._TRYON_LOOK_CACHE.clear(); app._TRYON_LOOK_INFLIGHT.clear()
        generate = AsyncMock(return_value={'status': 'succeeded', 'outputUrl': 'https://example.test/result.png'})
        with patch.dict(os.environ, {'FASHN_API_KEY': 'test-key', 'FASHN_LOOK_STRATEGY': 'collage'}), \
             patch.object(app, '_prepare_identity_source', return_value='prepared'), \
             patch.object(app, '_run_fashn_tryon_with_category_fallback', generate), \
             patch.object(app, '_face_locked_output_url', AsyncMock(return_value='data:image/png;base64,protected')):
            result = await app.tryon_generate_look(person_file=upload(), top_file=upload(), bottom_file=upload(), shoes_file=None, outer_file=None,
                tuck_mode='auto', compare_mode='false', quality_mode='quality', top_category='Футболка', outer_category='', device='collage')
        self.assertEqual([step['step'] for step in result['steps']], ['outfit'])
        self.assertEqual(generate.await_count, 1)

    async def test_rejected_lock_returns_provider_frame_with_warning_not_error(self):
        app._TRYON_LOOK_CACHE.clear(); app._TRYON_LOOK_INFLIGHT.clear()
        frame = Image.new('RGB', (80, 160), (10, 200, 30))
        generate = AsyncMock(return_value={'status': 'succeeded', 'outputUrl': 'https://example.test/private.png'})
        rejected = AsyncMock(side_effect=app.AlignmentRejected(app.ALIGNMENT_MESSAGE, frame))
        with patch.dict(os.environ, {'FASHN_API_KEY': 'test-key'}), patch.object(app, '_prepare_identity_source', return_value='prepared'), \
             patch.object(app, '_run_fashn_tryon_with_category_fallback', generate), patch.object(app, '_face_locked_output_url', rejected):
            result = await app.tryon_generate_look(person_file=upload(), top_file=upload(), bottom_file=None, shoes_file=None, outer_file=None,
                tuck_mode='auto', compare_mode='false', quality_mode='quality', top_category='Рубашка', outer_category='', device='fallback')
        self.assertEqual(result.get('status'), 'succeeded', result)
        self.assertFalse(result['identityLocked'])
        self.assertIn('перегенерируй', result['warning'])
        self.assertTrue(result['outputUrl'].startswith('data:image/png;base64,'))
        self.assertNotIn('private', str(result))
        content, _ = app._data_url_to_bytes(result['outputUrl'])
        self.assertEqual(Image.open(BytesIO(content)).getpixel((5, 5)), (10, 200, 30))
        app._TRYON_LOOK_INFLIGHT.clear()
        with patch.dict(os.environ, {'FASHN_API_KEY': 'test-key', 'AI_TRYON_UNLOCKED_FALLBACK': 'false'}), \
             patch.object(app, '_prepare_identity_source', return_value='prepared'), \
             patch.object(app, '_run_fashn_tryon_with_category_fallback', generate), patch.object(app, '_face_locked_output_url', rejected):
            result = await app.tryon_generate_look(person_file=upload(), top_file=upload(), bottom_file=None, shoes_file=None, outer_file=None,
                tuck_mode='auto', compare_mode='false', quality_mode='quality', top_category='Рубашка', outer_category='', device='strict')
        self.assertEqual(result.get('error'), app.ALIGNMENT_MESSAGE)

    async def test_unprotected_output_is_never_returned(self):
        with patch.object(app, '_load_image_from_url_or_data_url', AsyncMock(return_value=Image.new('RGB', (80, 160)))), \
             patch.object(app, '_apply_identity_lock', side_effect=ValueError('unsafe')):
            with self.assertRaises(ValueError):
                await app._face_locked_output_url(None, b'photo', 'https://example.test/result.png', ['top'])

    async def test_export_keeps_full_size_pixels_and_explicit_srgb(self):
        image = Image.new('RGB', (1200, 2400), (180, 100, 65))
        with patch.object(app, '_load_image_from_url_or_data_url', AsyncMock(return_value=Image.new('RGB', (600, 1200)))), \
             patch.object(app, '_apply_identity_lock', return_value=(image, 'composed')):
            url = await app._face_locked_output_url(None, b'photo', 'data:image/png;base64,mocked', ['top'])
        content, mime = app._data_url_to_bytes(url)
        result = Image.open(BytesIO(content))
        self.assertEqual(mime, 'image/png')
        self.assertEqual(result.size, image.size)
        self.assertEqual(result.info['icc_profile'], image_color.SRGB_BYTES)
        np.testing.assert_array_equal(result, image)

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
