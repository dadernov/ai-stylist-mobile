import unittest
from io import BytesIO
from unittest.mock import patch
from types import SimpleNamespace

import numpy as np
from fastapi import UploadFile, HTTPException
from PIL import Image

import app
from clothing_analysis import decide_sleeves, extract_palette, ranked


class SleeveTests(unittest.TestCase):
    def test_the_photo_decides_where_the_category_varies(self):
        # Probabilities in the order long, short, none.
        self.assertEqual(decide_sleeves([.1, .85, .05], 'Поло'), 'short')
        # A long-sleeved polo needs a clear photo: most polos are short-sleeved.
        self.assertEqual(decide_sleeves([.93, .05, .02], 'Поло'), 'long')
        self.assertIsNone(decide_sleeves([.6, .35, .05], 'Поло'))
        self.assertEqual(decide_sleeves([.03, .07, .9], 'Блуза'), 'none')
        self.assertEqual(decide_sleeves([.1, .8, .1], 'Платье'), 'short')

    def test_a_jacket_out_of_sight_is_not_sleeveless(self):
        # A jacket hanging on a hook read as sleeveless at 0.93.
        self.assertEqual(decide_sleeves([.05, .02, .93], 'Куртка'), 'long')

    def test_a_coat_short_for_sure_is_hip_length_even_when_cropped_or_hip_is_unclear(self):
        from clothing_analysis import decide
        # Read from a short camel coat: cropped 0.56, hip 0.33, long 0.10.
        self.assertEqual(decide('length', [.563, .333, .104], 'Пальто'), 'hip')
        self.assertEqual(decide('length', [.05, .25, .7], 'Пальто'), 'long')
        self.assertIsNone(decide('length', [.2, .4, .4], 'Пальто'))

    def test_an_unsure_reading_says_nothing(self):
        # A sweater with its sleeves folded, a close-up of a shirt collar.
        self.assertIsNone(decide_sleeves([.15, .82, .03], 'Свитер'))
        self.assertIsNone(decide_sleeves([.34, .52, .14], 'Рубашка'))


class GarmentTraitsEndpoint(unittest.TestCase):
    def test_an_old_item_is_read_once_like_a_try_on_reads_it(self):
        upload = UploadFile(file=BytesIO(b'jpeg-bytes'), filename='item.jpg')
        with patch.object(app.access, 'throttle'), patch.object(app, 'read_garment', return_value={'sleeves': 'short', 'opening': 'none'}) as read:
            self.assertEqual(app.garment_traits(upload, 'Поло', 'masha'), {'traits': {'sleeves': 'short', 'opening': 'none'}})
        read.assert_called_once_with(b'jpeg-bytes', 'Поло')
        with patch.object(app.access, 'throttle'), self.assertRaises(HTTPException):
            app.garment_traits(UploadFile(file=BytesIO(b'x'), filename='item.jpg'), 'Космос', 'masha')


class AnalysisTests(unittest.TestCase):
    def setUp(self):
        app._ANALYSIS_CACHE.clear()

    def upload(self, payload):
        return UploadFile(file=BytesIO(payload), filename='photo.png')

    def test_white_fabric_is_not_discarded(self):
        image = Image.new('RGBA', (40, 40), 'white')
        self.assertEqual(extract_palette(image, image.getchannel('A'))[0], '#ffffff')

    def test_background_does_not_dominate_palette(self):
        image = Image.new('RGBA', (40, 40), (255, 0, 0, 0))
        image.paste((0, 0, 255, 255), (10, 10, 30, 30))
        self.assertEqual(extract_palette(image, image.getchannel('A'))[0], '#0000ff')

    def test_invalid_photo(self):
        with self.assertRaises(HTTPException) as raised:
            app.analyze(self.upload(b'not an image'), '')
        self.assertEqual(raised.exception.status_code, 422)
        self.assertFalse(app._ANALYSIS_LOCK.locked())

    def test_invalid_section(self):
        with self.assertRaises(HTTPException) as raised:
            app.analyze(self.upload(b'x'), 'bad')
        self.assertEqual(raised.exception.status_code, 422)

    def test_missing_model_returns_honest_partial_result(self):
        image = Image.new('RGBA', (40, 40), 'white')
        buffer = BytesIO(); image.save(buffer, format='PNG')
        with patch.object(app, '_remove_background_rgba', return_value=(image, b'')), patch.object(app, 'get_classifier', side_effect=FileNotFoundError):
            result = app.analyze(self.upload(buffer.getvalue()), '')
        self.assertIsNone(result['category'])
        self.assertTrue(result['needsReview'])
        self.assertEqual(result['analysisSource'], 'unavailable')
        self.assertFalse(app._ANALYSIS_CACHE)

    def test_busy(self):
        app._ANALYSIS_LOCK.acquire()
        try:
            with patch.object(app, 'ANALYSIS_WAIT', 0.2), self.assertRaises(HTTPException) as raised:
                app.analyze(self.upload(b'x'), '')
            self.assertEqual(raised.exception.status_code, 503)
        finally:
            app._ANALYSIS_LOCK.release()

    def test_person_photo_does_not_autofill_skin_colour(self):
        image = Image.new('RGBA', (40, 40), (100, 70, 50, 255))
        buffer = BytesIO(); image.save(buffer, format='PNG')
        classifier = SimpleNamespace(predict=lambda *args: {'category': 'Футболка', 'warnings': [], 'wornByPerson': True, 'analysisSource': 'clip-onnx'})
        with patch.object(app, '_remove_background_rgba', return_value=(image, b'')), patch.object(app, 'get_classifier', return_value=classifier):
            result = app.analyze(self.upload(buffer.getvalue()), '')
        self.assertIsNone(result['dominantColor'])
        self.assertTrue(result['palette'])

    def test_ranking_stable(self):
        choices = ranked(np.array([1000., 1001., 998.]))
        self.assertEqual(choices[0][0], 1)
        self.assertAlmostEqual(sum(score for _, score in choices), 1)



class LookCacheKey(unittest.TestCase):
    def key(self, **overrides):
        arguments = dict(person_content=b"person", top_content=b"top", bottom_content=None,
                         shoes_content=None, outer_content=b"outer", tuck_mode_normalized="auto",
                         look_model_name="tryon-v1.6", look_mode="quality", look_generation_mode="",
                         base_prompt="keep identity", quality_mode="quality", categories="Рубашка|Пуховик")
        arguments.update(overrides)
        return app._cache_key_for_tryon_look(**arguments)

    def test_categories_change_the_result_and_the_key(self):
        # Категории решают, запускается ли отдельный проход по верху, поэтому
        # кадр под теми же фотографиями может отличаться — и кеш обязан это видеть.
        self.assertNotEqual(self.key(), self.key(categories="Рубашка|Пиджак"))

    def test_same_request_hits_the_same_key(self):
        self.assertEqual(self.key(), self.key())


class Layering(unittest.TestCase):
    def test_closed_outerwear_hides_the_top(self):
        self.assertIn("Пуховик", app.COVERING_OUTERWEAR)
        self.assertIn("Пальто", app.COVERING_OUTERWEAR)

    def test_open_outerwear_leaves_the_top_visible(self):
        for category in ("Пиджак", "Бомбер", "Куртка", "Кардиган"):
            self.assertNotIn(category, app.COVERING_OUTERWEAR)
        self.assertEqual(app._reason_to_skip_top("Пиджак", "tryon-max"), "")

    def test_closed_outerwear_skips_the_top_on_any_model(self):
        self.assertIn("не видно", app._reason_to_skip_top("Пуховик", "tryon-max"))

    def test_second_torso_pass_is_skipped_on_models_without_max(self):
        # Живой прогон: на tryon-v1.6 шаг outer вернул тот же кадр, куртка
        # не появилась, кредит списался. Генерируем только видимый слой.
        self.assertIn("быстром режиме", app._reason_to_skip_top("Куртка", "tryon-v1.6"))

    def test_dresses_use_the_one_piece_category(self):
        # Как «верх» платье сажается по талии и обрезается.
        self.assertTrue(app.ONE_PIECE_GARMENTS.issubset({"Платье", "Сарафан", "Комбинезон"}))
        self.assertIn("one-pieces", app._category_candidates("top", ["one-pieces", "auto"]))

if __name__ == '__main__':
    unittest.main()


class AnalysisImage(unittest.TestCase):
    """The photo recognition reads: a big JPEG decoded at a fraction, upright, transparency on white, at most 1280 px."""

    def encode(self, image, fmt='JPEG', **options):
        buffer = BytesIO(); image.save(buffer, fmt, **options); return buffer.getvalue()

    def test_a_camera_photo_is_read_upright_at_1280(self):
        photo = Image.new('RGB', (4032, 3024), (30, 90, 200))
        photo.paste((250, 20, 20), (0, 0, 2016, 1512))  # red top-left quarter
        exif = Image.Exif(); exif[0x0112] = 6  # stored sideways, shown turned 90 degrees clockwise
        image, _ = app._analysis_image(self.encode(photo, quality=92, exif=exif.tobytes()))
        self.assertEqual((image.mode, image.size), ('RGB', (960, 1280)))
        # Upright: the stored top-left quarter is now the top-right one.
        self.assertGreater(image.getpixel((900, 100))[0], 200)
        self.assertLess(image.getpixel((60, 100))[0], 60)
        self.assertLess(np.abs(np.asarray(image.getpixel((480, 1200))) - (30, 90, 200)).max(), 8)

    def test_transparency_is_read_on_white_and_small_photos_stay_as_they_are(self):
        sticker = Image.new('RGBA', (300, 200), (0, 0, 0, 0)); sticker.paste((10, 120, 40, 255), (100, 50, 200, 150))
        image, _ = app._analysis_image(self.encode(sticker, 'PNG'))
        self.assertEqual((image.mode, image.size), ('RGB', (300, 200)))
        self.assertEqual(image.getpixel((5, 5)), (255, 255, 255))
        self.assertEqual(image.getpixel((150, 100)), (10, 120, 40))

    def test_the_cut_out_is_the_decoded_picture_under_rembgs_mask(self):
        picture = Image.new('RGB', (64, 48), (200, 60, 60))
        mask = Image.new('L', (64, 48), 0); mask.paste(255, (10, 10, 40, 30))
        session = SimpleNamespace(predict=lambda image: [mask])
        with patch.object(app, '_rembg', return_value=session):
            rgba, _ = app._remove_background_rgba(None, picture)
        self.assertEqual(rgba.mode, 'RGBA')
        self.assertEqual(rgba.getpixel((20, 20)), (200, 60, 60, 255))
        self.assertEqual(rgba.getpixel((5, 5))[3], 0)
