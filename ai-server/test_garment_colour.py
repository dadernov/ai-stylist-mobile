"""Colour names (garment_colour.py): the app's 27 names from the colour head and the cut-out's pixels,
in /analyze and in the flat picture's reading; without the head file the fields are left out."""
import re
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import numpy as np
from fastapi import UploadFile
from PIL import Image

import app
import garment_colour as gc


def head_file(directory, bias=None, names=None):
    path = Path(directory) / 'head.npz'
    np.savez(path, W=np.zeros((768, 27), np.float16), b=np.asarray(bias if bias is not None else np.zeros(27), np.float32),
             names=np.array(names or gc.NAMES))
    return path


def cut(colour, size=(120, 160), box=(20, 20, 100, 140)):
    rgba = Image.new('RGBA', size, (0, 0, 0, 0))
    rgba.paste(colour + (255,), box)
    return rgba


class UsingHead(unittest.TestCase):
    def use(self, path):
        patcher = patch.dict('os.environ', {'AI_COLOUR_HEAD': str(path)})
        patcher.start(); self.addCleanup(patcher.stop)
        gc._head = None
        self.addCleanup(setattr, gc, '_head', None)


class ColourNames(UsingHead):
    def test_the_names_are_the_apps_own_in_its_order(self):
        source = (Path(__file__).parent.parent / 'src/screens/WardrobeScreen.tsx').read_text()
        block = source.split('const namedColors = [')[1].split('];')[0]
        self.assertEqual(re.findall(r"\{ name: '([^']+)', hex: '(#[0-9A-F]{6})' \}", block), gc.NAMED)

    def test_the_shipped_head_names_the_apps_colours(self):
        self.use(gc.HEAD_PATH)
        self.assertIsNotNone(gc.load_head())
        answer = gc.name_colour(np.ones(768, np.float32) / np.sqrt(768), cut((200, 30, 40)))
        self.assertIn(answer['colorName'], gc.NAMES)
        self.assertTrue(0 <= answer['colorConfidence'] <= 1)

    def test_with_an_undecided_head_the_pixels_decide(self):
        with tempfile.TemporaryDirectory() as directory:
            self.use(head_file(directory))
            for colour, name in [((229, 57, 53), 'Красный'), ((20, 20, 22), 'Черный'), ((47, 75, 124), 'Синий деним'), ((250, 250, 250), 'Белый')]:
                with self.subTest(name=name):
                    self.assertEqual(gc.name_colour(np.zeros(768, np.float32), cut(colour))['colorName'], name)

    def test_a_sure_head_outweighs_a_shadowed_pixel_colour(self):
        bias = np.zeros(27); bias[gc.NAMES.index('Синий деним')] = 8
        with tempfile.TemporaryDirectory() as directory:
            self.use(head_file(directory, bias))
            # Navy in a dim room reads near-black by its pixels.
            answer = gc.name_colour(np.zeros(768, np.float32), cut((25, 30, 45)))
        self.assertEqual(answer['colorName'], 'Синий деним')
        self.assertGreater(answer['colorConfidence'], 0.9)

    def test_skin_around_a_worn_garment_is_not_its_colour(self):
        image = cut((40, 90, 200))
        skin = Image.new('RGBA', (120, 30), (224, 172, 140, 255))
        image.paste(skin, (0, 0))
        with tempfile.TemporaryDirectory() as directory:
            self.use(head_file(directory))
            self.assertEqual(gc.name_colour(np.zeros(768, np.float32), image)['colorName'], 'Синий')

    def test_without_the_head_nothing_is_named(self):
        self.use('/nonexistent/colour_head.npz')
        self.assertEqual(gc.name_colour(np.zeros(768, np.float32), cut((229, 57, 53))), {})

    def test_a_vector_of_another_model_is_not_read(self):
        with tempfile.TemporaryDirectory() as directory:
            self.use(head_file(directory))
            self.assertEqual(gc.name_colour(np.zeros(512, np.float32), cut((229, 57, 53))), {})

    def test_a_head_for_other_colours_is_not_used(self):
        with tempfile.TemporaryDirectory() as directory:
            self.use(head_file(directory, names=list(reversed(gc.NAMES))))
            self.assertEqual(gc.name_colour(np.zeros(768, np.float32), cut((229, 57, 53))), {})

    def test_a_tiny_cut_out_leaves_it_to_the_head(self):
        bias = np.zeros(27); bias[gc.NAMES.index('Хаки')] = 3
        with tempfile.TemporaryDirectory() as directory:
            self.use(head_file(directory, bias))
            self.assertEqual(gc.name_colour(np.zeros(768, np.float32), cut((229, 57, 53), box=(0, 0, 1, 1)))['colorName'], 'Хаки')


def upload():
    buffer = BytesIO(); Image.new('RGB', (600, 800), (200, 60, 60)).save(buffer, 'JPEG')
    return UploadFile(file=BytesIO(buffer.getvalue()), filename='item.jpg')


class AnalyzeColour(UsingHead):
    def setUp(self):
        app._ANALYSIS_CACHE.clear(); app._PHOTO_CUTS.clear()

    def analyze(self):
        foreground = cut((229, 57, 53), (600, 800), (100, 100, 500, 700))
        classifier = SimpleNamespace(predict=lambda *args, **kwargs: {
            'category': 'Футболка', 'section': 'Верх', 'warnings': [], 'wornByPerson': True, 'needsReview': False,
            'analysisSource': 'fashion-siglip-onnx', 'embedding': np.zeros(768, np.float32)})
        with patch.object(app.access, 'throttle'), patch.object(app, '_remove_background_rgba', return_value=(foreground, b'')), \
                patch.object(app, 'get_classifier', return_value=classifier), patch.object(app.feedback, 'remember_analysis') as remember:
            result = app.analyze(upload(), '', 'masha')
        # The feedback still gets the embedding the colour was named from.
        self.assertIsNotNone(remember.call_args[0][1])
        return result

    def test_analyze_names_the_colour_even_on_a_worn_photo(self):
        with tempfile.TemporaryDirectory() as directory:
            self.use(head_file(directory))
            result = self.analyze()
        self.assertEqual(result['colorName'], 'Красный')
        self.assertIn('colorConfidence', result)
        # dominantColor and palette stay as they were: none from a worn photo.
        self.assertIsNone(result['dominantColor'])
        self.assertTrue(result['palette'])

    def test_without_the_head_analyze_says_nothing_new(self):
        self.use('/nonexistent/colour_head.npz')
        result = self.analyze()
        self.assertNotIn('colorName', result)
        self.assertNotIn('colorConfidence', result)


class FlatColour(UsingHead, unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        app._ANALYSIS_CACHE.clear(); app._PHOTO_CUTS.clear()

    async def flat(self):
        flat_embedding = np.full(768, 0.5, np.float32)
        def remove(content, image):
            colour = (47, 75, 124) if image.size == (1024, 1024) else (20, 20, 22)
            return cut(colour, image.size, (100, 100, image.width - 100, image.height - 100)), b''
        prediction = {'category': 'Куртка', 'section': 'Верхняя одежда', 'needsReview': False, 'pattern': 'Однотонный',
                      'season': 'Демисезон', 'categoryCandidates': [{'category': 'Куртка', 'section': 'Верхняя одежда', 'score': 0.9}],
                      'traits': {}, 'warnings': [], 'analysisSource': 'fashion-siglip-onnx', 'embedding': np.zeros(768, np.float32),
                      'views': [{'category': 'Куртка', 'sure': True, 'similarity': 1.0, 'embedding': np.zeros(768, np.float32)},
                                {'category': 'Куртка', 'sure': True, 'similarity': 0.93, 'embedding': flat_embedding}]}
        seen = []
        real = gc.name_colour
        def name(embedding, foreground):
            seen.append((float(np.asarray(embedding).mean()), foreground.size, foreground.getpixel((foreground.width // 2, foreground.height // 2))[:3]))
            return real(embedding, foreground)
        with patch.object(app.access, 'throttle'), patch.object(app.fal_tryon, 'enabled', return_value=True), \
                patch.object(app.fal_tryon, '_generate_one', AsyncMock(return_value={'status': 'succeeded', 'outputUrl': 'https://x/y.png'})), \
                patch.object(app, '_load_image_from_url_or_data_url', AsyncMock(return_value=Image.new('RGB', (1024, 1024), 'grey'))), \
                patch.object(app, '_remove_background_rgba', side_effect=remove), \
                patch.object(app, 'get_classifier', return_value=SimpleNamespace(predict=lambda *a, **k: prediction)), \
                patch.object(app.garment_colour, 'name_colour', side_effect=name):
            return await app.garment_flat(upload(), '', 'masha', ''), seen

    async def test_the_flat_names_its_own_colour(self):
        with tempfile.TemporaryDirectory() as directory:
            self.use(head_file(directory))
            result, seen = await self.flat()
        # Named from the flat's own embedding and cut-out (denim blue), not the photo's (near-black).
        self.assertEqual(seen, [(0.5, (1024, 1024), (47, 75, 124))])
        self.assertEqual(result['analysis']['colorName'], 'Синий деним')
        self.assertNotIn('embedding', str(result['analysis'].keys()))

    async def test_without_the_head_the_flat_says_nothing_new(self):
        self.use('/nonexistent/colour_head.npz')
        result, _ = await self.flat()
        self.assertNotIn('colorName', result['analysis'])


if __name__ == '__main__':
    unittest.main()
