import unittest
from io import BytesIO
from unittest.mock import patch
from types import SimpleNamespace

import numpy as np
from fastapi import UploadFile, HTTPException
from PIL import Image

import app
from clothing_analysis import extract_palette, ranked


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
            with self.assertRaises(HTTPException) as raised:
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


if __name__ == '__main__':
    unittest.main()
