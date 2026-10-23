"""/garment-flat: the flat picture comes back as a transparent cut-out with what it and the photo show together,
and a flat that shows another garment is refused. fal and rembg are mocked; the classifier is too, except in
FlatViews, where predict runs over stubbed image vectors."""
import asyncio
import threading
import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import numpy as np
from fastapi import HTTPException, UploadFile
from PIL import Image

import app
import clothing_analysis as ca


def photo_upload(size=(600, 800)):
    buffer = BytesIO(); Image.new('RGB', size, (200, 60, 60)).save(buffer, 'JPEG')
    return UploadFile(file=BytesIO(buffer.getvalue()), filename='item.jpg')


def cut_out(image, box):
    """What rembg gives: the image with only `box` opaque."""
    rgba = image.convert('RGBA')
    alpha = Image.new('L', image.size, 0)
    alpha.paste(255, box)
    rgba.putalpha(alpha)
    return rgba


def fake_rembg(flat_box=(212, 112, 812, 912), photo_box=(100, 100, 500, 700)):
    def remove(content, image):
        # The flat comes from fal at 1024 x 1024; the photo is anything else.
        return cut_out(image, flat_box if image.size == (1024, 1024) else photo_box), b''
    return remove


def prediction(own='Футболка', other='Футболка', similarity=0.93, **extra):
    return {'category': other, 'section': 'Верх', 'needsReview': False, 'pattern': 'Однотонный', 'season': 'Круглый год',
            'categoryCandidates': [{'category': other, 'section': 'Верх', 'score': 0.9}], 'traits': {'sleeves': 'short'},
            'warnings': [], 'analysisSource': 'fashion-siglip-onnx+head', 'wornByPerson': False, 'embedding': np.ones(3),
            'views': [{'category': own, 'similarity': 1.0}, {'category': other, 'similarity': similarity}], **extra}


class FlatCase(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        app._PHOTO_CUTS.clear()
        app._ANALYSIS_CACHE.clear()

    async def call(self, predicted=None, rembg=None, classifier=None, flat=None, section=''):
        flat = flat or Image.new('RGB', (1024, 1024), (200, 60, 60))
        classifier = classifier or SimpleNamespace(predict=lambda *args, **kwargs: predicted)
        with patch.object(app.access, 'throttle'), patch.object(app.fal_tryon, 'enabled', return_value=True), \
                patch.object(app.fal_tryon, '_generate_one', AsyncMock(return_value={'status': 'succeeded', 'outputUrl': 'https://x/y.png'})), \
                patch.object(app, '_load_image_from_url_or_data_url', AsyncMock(return_value=flat)), \
                patch.object(app, '_remove_background_rgba', side_effect=rembg or fake_rembg()), \
                patch.object(app, 'get_classifier', return_value=classifier):
            return await app.garment_flat(photo_upload(), section, 'masha')

    def picture(self, data_url):
        self.assertTrue(data_url.startswith('data:image/png;base64,'))
        return Image.open(BytesIO(app._data_url_to_bytes(data_url)[0]))


class GarmentFlat(FlatCase):

    async def test_the_flat_comes_back_as_a_transparent_cut_out_cropped_to_the_garment(self):
        result = await self.call(prediction())
        image = self.picture(result['image'])
        self.assertEqual(image.mode, 'RGBA')
        # 600 x 800 garment, 4% margin each side (32 px), then at most 800 px.
        self.assertLessEqual(max(image.size), app.FLAT_MAX_SIDE)
        self.assertAlmostEqual(image.width / image.height, 664 / 864, places=2)
        alpha = np.asarray(image.getchannel('A'))
        self.assertEqual(alpha[0, 0], 0)
        self.assertEqual(alpha[image.height // 2, image.width // 2], 255)

    async def test_the_analysis_of_both_views_comes_with_it(self):
        seen = {}
        def predict(original, foreground, section_hint=None, extra=()):
            seen.update(original=original.size, hint=section_hint, extra=[(view.size, cut.mode) for view, cut in extra])
            return prediction('Куртка', 'Худи', 0.9, category='Худи', needsReview=True,
                              warnings=['Тип вещи определён неуверенно. Проверь предложенные варианты.',
                                        'На фото человек: проверь цвет и тип вещи. Для точного анализа лучше отдельное фото одежды.'])
        result = await self.call(classifier=SimpleNamespace(predict=predict), section='Верх')
        self.assertEqual(seen, {'original': (600, 800), 'hint': 'Верх', 'extra': [((1024, 1024), 'RGBA')]})
        analysis = result['analysis']
        self.assertEqual((analysis['category'], analysis['needsReview'], analysis['pattern']), ('Худи', True, 'Однотонный'))
        self.assertEqual(analysis['categoryCandidates'][0]['category'], 'Худи')
        # The colour is the flat garment's own; the person in the photo no longer colours it.
        self.assertEqual(analysis['dominantColor'], '#c83c3c')
        self.assertEqual(analysis['palette'], ['#c83c3c'])
        self.assertEqual(analysis['warnings'], ['Тип вещи определён неуверенно. Проверь предложенные варианты.'])
        # Nothing the answer must not carry: the feedback embedding and the per-view details.
        self.assertNotIn('embedding', analysis)
        self.assertNotIn('views', analysis)

    async def test_a_flat_unlike_the_photo_is_refused(self):
        with self.assertRaises(HTTPException) as raised:
            await self.call(prediction(similarity=app.FLAT_MIN_SIMILARITY - 0.01))
        self.assertEqual(raised.exception.status_code, 422)
        self.assertEqual(raised.exception.detail, app.FLAT_DIFFERENT)
        result = await self.call(prediction(similarity=app.FLAT_MIN_SIMILARITY + 0.01))
        self.assertIn('analysis', result)

    async def test_a_flat_of_another_part_of_the_body_is_refused(self):
        for own, other in [('Брюки', 'Футболка'), ('Платье', 'Блуза'), ('Юбка', 'Платье'), ('Кроссовки', 'Джинсы')]:
            with self.subTest(own=own, other=other), self.assertRaises(HTTPException) as raised:
                await self.call(prediction(own, other, 0.95))
            self.assertEqual(raised.exception.status_code, 422)

    async def test_another_reading_of_the_same_part_is_kept(self):
        # A jacket read as a hoodie, a shirt as a blouse: the flat is often the surer one.
        for own, other in [('Куртка', 'Худи'), ('Рубашка', 'Блуза'), ('Джинсы', 'Брюки'), ('Платье', 'Сарафан')]:
            with self.subTest(own=own, other=other):
                result = await self.call(prediction(own, other, 0.9))
                self.assertEqual(result['analysis']['category'], other)

    async def test_an_unknown_section_is_refused_before_anything_is_paid(self):
        generate = AsyncMock()
        with patch.object(app.access, 'throttle'), patch.object(app.fal_tryon, 'enabled', return_value=True), \
                patch.object(app.fal_tryon, '_generate_one', generate), self.assertRaises(HTTPException) as raised:
            await app.garment_flat(photo_upload(), 'Космос', 'masha')
        self.assertEqual(raised.exception.status_code, 422)
        generate.assert_not_called()

    async def test_a_flat_that_cannot_be_cut_out_is_refused(self):
        whole = fake_rembg(flat_box=(0, 0, 1024, 1024))
        with self.assertRaises(HTTPException) as raised:
            await self.call(prediction(), rembg=whole)
        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(raised.exception.detail, app.FLAT_NO_CUTOUT)
        self.assertFalse(app._ANALYSIS_LOCK.locked())

    async def test_without_the_classifier_the_picture_still_comes(self):
        def broken(*args, **kwargs):
            raise RuntimeError('no model')
        result = await self.call(classifier=SimpleNamespace(predict=broken))
        self.picture(result['image'])
        self.assertNotIn('analysis', result)

    async def test_a_photo_rembg_cannot_cut_is_read_whole(self):
        seen = {}
        def predict(original, foreground, section_hint=None, extra=()):
            seen['alpha'] = foreground.getchannel('A').getextrema()
            return prediction()
        await self.call(classifier=SimpleNamespace(predict=predict), rembg=fake_rembg(photo_box=(0, 0, 1, 1)))
        self.assertEqual(seen['alpha'], (255, 255))


class GarmentFlatResilience(FlatCase):
    """The flat is paid for before any of this runs: our own failures never lose it."""

    async def test_faint_matting_at_the_edge_is_not_cropped_into_the_picture(self):
        def remove(content, image):
            rgba = cut_out(image, (212, 112, 812, 912) if image.size == (1024, 1024) else (100, 100, 500, 700))
            if image.size == (1024, 1024):
                alpha = rgba.getchannel('A'); alpha.paste(20, (0, 0, 1024, 60)); rgba.putalpha(alpha)
            return rgba, b''
        image = self.picture((await self.call(prediction(), rembg=remove))['image'])
        self.assertAlmostEqual(image.width / image.height, 664 / 864, places=2)

    async def test_a_failure_after_the_check_returns_the_picture_without_the_analysis(self):
        with patch.object(app, 'extract_palette', side_effect=RuntimeError('boom')):
            result = await self.call(prediction())
        self.picture(result['image'])
        self.assertNotIn('analysis', result)
        self.assertFalse(app._ANALYSIS_LOCK.locked())

    async def test_a_failed_cut_out_returns_the_flat_as_it_came(self):
        def remove(content, image):
            raise MemoryError('rembg')
        result = await self.call(prediction(), rembg=remove)
        self.assertTrue(result['image'].startswith('data:image/jpeg;base64,'))
        self.assertNotIn('analysis', result)
        self.assertFalse(app._ANALYSIS_LOCK.locked())

    async def test_the_flat_waits_for_the_models_then_reads_it(self):
        app._ANALYSIS_LOCK.acquire()
        threading.Timer(0.4, app._ANALYSIS_LOCK.release).start()
        result = await self.call(prediction())
        self.assertIn('analysis', result)
        self.assertFalse(app._ANALYSIS_LOCK.locked())

    async def test_a_request_dropped_mid_way_still_gives_the_models_back(self):
        import time
        started = threading.Event()
        def slow_card(*args):
            started.set(); time.sleep(0.3); return {'image': 'x'}
        with patch.object(app, '_flat_card', side_effect=slow_card):
            task = asyncio.ensure_future(self.call(prediction()))
            while not started.is_set():
                await asyncio.sleep(0.01)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertTrue(app._ANALYSIS_LOCK.locked())
            await asyncio.sleep(0.5)
        self.assertFalse(app._ANALYSIS_LOCK.locked())

    async def test_models_busy_too_long_send_the_flat_back_uncut(self):
        app._ANALYSIS_LOCK.acquire()
        try:
            with patch.object(app, 'FLAT_MODEL_WAIT', 0.3):
                result = await self.call(prediction())
        finally:
            app._ANALYSIS_LOCK.release()
        self.assertTrue(result['image'].startswith('data:image/jpeg;base64,'))
        self.assertNotIn('analysis', result)

    async def test_the_photo_analyze_cut_out_is_not_cut_again(self):
        calls = []
        def remove(content, image):
            calls.append(image.size)
            return fake_rembg()(content, image)
        classifier = SimpleNamespace(predict=lambda *args, **kwargs: prediction())
        with patch.object(app.access, 'throttle'), patch.object(app, '_remove_background_rgba', side_effect=remove), \
                patch.object(app, 'get_classifier', return_value=classifier), patch.object(app.feedback, 'remember_analysis'):
            app.analyze(photo_upload(), '', 'masha')
        self.assertEqual(calls, [(600, 800)])
        result = await self.call(prediction(), rembg=remove)
        self.assertIn('analysis', result)
        # Only the flat is cut out; the photo's cut-out is /analyze's.
        self.assertEqual(calls, [(600, 800), (1024, 1024)])
        # Evicted, it is made again.
        app._PHOTO_CUTS.clear()
        await self.call(prediction(), rembg=remove)
        self.assertEqual(calls[2:], [(1024, 1024), (600, 800)])


class GarmentZones(unittest.TestCase):
    def test_zones(self):
        self.assertEqual({app._garment_zone(c) for c in ('Футболка', 'Худи', 'Пиджак', 'Пуховик', 'Жилет')}, {'top'})
        self.assertEqual({app._garment_zone(c) for c in ('Платье', 'Сарафан', 'Комбинезон')}, {'one-piece'})
        self.assertEqual({app._garment_zone(c) for c in ('Юбка', 'Джинсы', 'Шорты')}, {'Низ'})
        self.assertEqual(app._garment_zone('Кроссовки'), 'Обувь')


class FlatViews(unittest.TestCase):
    """predict(..., extra=...) over stubbed vectors: two views of one garment, scores averaged."""
    def classifier(self, vectors):
        classifier = ca.ClothingClassifier.__new__(ca.ClothingClassifier)
        classifier.size = 8
        classifier.head = None
        rows = len(ca._subjects())
        features = np.zeros((rows, 6), np.float32)
        index = {entry[0]: number for number, entry in enumerate(ca.CATEGORIES)}
        for column, name in enumerate(('Футболка', 'Худи', 'Куртка'), start=0):
            features[index[name], column] = 1
        features[index['Платье'], 4] = features[index['Юбка'], 5] = 1
        features[len(ca.CATEGORIES), 3] = 1  # plain
        features[-1, 3] = 1  # a product alone
        classifier.features = features
        # A view is told by its colour: red is the photo, blue the flat.
        vectors = {colour: np.pad(np.asarray(vector, np.float32), (0, 6 - len(vector))) for colour, vector in vectors.items()}
        classifier.embedded = []
        def embed(images):
            classifier.embedded += [image.convert('RGB').getpixel((4, 4)) for image in images]
            return np.array([vectors[image.convert('RGB').getpixel((4, 4))] for image in images])
        classifier._embed = embed
        classifier.traits = lambda image, category='', frame_vector=None: {'sleeves': 'long'}
        return classifier

    def view(self, colour):
        image = Image.new('RGB', (16, 16), colour)
        return image, image.convert('RGBA')

    # The stubbed vectors give logits of 100 x their values: (0, hoodie, jacket, 0).
    red, blue = (255, 0, 0), (0, 0, 255)

    def test_scores_are_averaged_and_each_view_reported(self):
        photo, flat = np.array([0, .300, .310, 0], np.float32), np.array([0, .315, .300, 0], np.float32)
        # The photo leans jacket (sure enough alone); the flat leans hoodie a little more.
        classifier = self.classifier({self.red: photo, self.blue: flat})
        alone = classifier.predict(*self.view(self.red))
        self.assertEqual((alone['category'], alone['needsReview']), ('Куртка', False))
        self.assertNotIn('views', alone)
        both = classifier.predict(*self.view(self.red), extra=[self.view(self.blue)])
        self.assertEqual(both['category'], 'Худи')
        self.assertEqual([view['category'] for view in both['views']], ['Куртка', 'Худи'])
        self.assertEqual(both['views'][0]['similarity'], 1.0)
        self.assertAlmostEqual(both['views'][1]['similarity'], float(photo @ flat), places=3)
        self.assertEqual([view['sure'] for view in both['views']], [True, True])
        # Photo and flat disagree, so the combined answer asks to be checked.
        self.assertTrue(both['needsReview'])
        # The feedback embedding stays the photo's own.
        np.testing.assert_allclose(both['embedding'], alone['embedding'])

    def test_a_view_that_does_not_overturn_a_sure_answer_keeps_it_sure(self):
        # The photo is sure of the hoodie (p 0.88); the flat is undecided, a shade towards the jacket.
        classifier = self.classifier({self.red: np.array([0, .30, .28, 0], np.float32), self.blue: np.array([0, .297, .303, 0], np.float32)})
        alone = classifier.predict(*self.view(self.red))
        self.assertEqual((alone['category'], alone['needsReview']), ('Худи', False))
        both = classifier.predict(*self.view(self.red), extra=[self.view(self.blue)])
        self.assertEqual(both['category'], 'Худи')
        self.assertLess(both['categoryCandidates'][0]['score'], ca.CONFIDENCE_MIN)
        self.assertFalse(both['needsReview'])
        # Unsure alone, unsure together.
        unsure = self.classifier({self.red: np.array([0, .300, .295, 0], np.float32), self.blue: np.array([0, .297, .303, 0], np.float32)})
        self.assertTrue(unsure.predict(*self.view(self.red))['needsReview'])
        self.assertTrue(unsure.predict(*self.view(self.red), extra=[self.view(self.blue)])['needsReview'])

    def test_a_flat_sure_of_something_else_keeps_the_answer_in_question(self):
        # The photo is sure of the hoodie (p 0.88), the flat as sure of the jacket (p 0.86): averaged, the hoodie
        # stays on top, but by a hair, and one view contradicting the other is worth a look.
        classifier = self.classifier({self.red: np.array([0, .30, .28, 0], np.float32), self.blue: np.array([0, .282, .30, 0], np.float32)})
        both = classifier.predict(*self.view(self.red), extra=[self.view(self.blue)])
        self.assertEqual(both['category'], 'Худи')
        self.assertEqual([(view['category'], view['sure']) for view in both['views']], [('Худи', True), ('Куртка', True)])
        self.assertTrue(both['needsReview'])

    def test_with_a_section_hint_each_view_is_read_within_it(self):
        # A worn skirt: the photo alone reads a dress, the flat a skirt. Added to the bottoms, both read as
        # skirts, so the views agree on the zone and the paid flat is not refused.
        classifier = self.classifier({self.red: np.array([0, 0, 0, 0, .31, .30], np.float32), self.blue: np.array([0, 0, 0, 0, .28, .31], np.float32)})
        free = classifier.predict(*self.view(self.red), extra=[self.view(self.blue)])
        self.assertEqual([view['category'] for view in free['views']], ['Платье', 'Юбка'])
        hinted = classifier.predict(*self.view(self.red), 'Низ', extra=[self.view(self.blue)])
        self.assertEqual([view['category'] for view in hinted['views']], ['Юбка', 'Юбка'])
        self.assertEqual(hinted['category'], 'Юбка')

    def test_a_photo_read_again_is_not_embedded_again(self):
        classifier = self.classifier({self.red: [0, .30, .28, 0], self.blue: [0, .29, .30, 0]})
        classifier.predict(*self.view(self.red))
        self.assertEqual(classifier.embedded, [self.red, self.red])
        classifier.predict(*self.view(self.red), extra=[self.view(self.blue)])
        # Only the flat's two views are new; the traits reuse the photo's frame vector.
        self.assertEqual(classifier.embedded, [self.red, self.red, self.blue, self.blue])


if __name__ == '__main__':
    unittest.main()
