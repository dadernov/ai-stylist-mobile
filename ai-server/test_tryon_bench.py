"""tools/tryon_bench.py keeps the editor's frame whether it comes inline or as a URL."""
import base64
import importlib.util
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from PIL import Image

import app
import fal_tryon

_spec = importlib.util.spec_from_file_location('tryon_bench', Path(__file__).parent / 'tools' / 'tryon_bench.py')
tryon_bench = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tryon_bench)


def jpeg():
    data = BytesIO()
    Image.new('RGB', (8, 16), 'red').save(data, format='JPEG')
    return data.getvalue()


class Frames(unittest.IsolatedAsyncioTestCase):
    async def run_case(self, output_url, handler):
        case = {'name': 'look', 'person': jpeg(), 'garments': {'top': (jpeg(), 'image/jpeg')},
                'top_category': 'Футболка', 'outer_category': '', 'tuck': 'auto'}
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        with tempfile.TemporaryDirectory() as out, \
                patch.object(app, '_run_fal_look', AsyncMock(return_value={'status': 'succeeded', 'outputUrl': output_url})):
            record = await tryon_bench.run_one(client, case, fal_tryon.MODELS['seedream-5-lite'], Path(out), lock=False)
            saved = (Path(out) / record['raw']).read_bytes()
        return record, saved

    async def test_an_inline_frame_is_saved_without_a_request(self):
        def handler(request):
            raise AssertionError('no request for an inline frame')
        frame = jpeg()
        record, saved = await self.run_case('data:image/jpeg;base64,' + base64.b64encode(frame).decode(), handler)
        self.assertNotIn('error', record)
        self.assertEqual(saved, frame)

    async def test_a_frame_url_is_downloaded(self):
        frame = jpeg()
        record, saved = await self.run_case('https://fal.media/out.jpg', lambda request: httpx.Response(200, content=frame))
        self.assertEqual(saved, frame)


if __name__ == '__main__':
    unittest.main()
