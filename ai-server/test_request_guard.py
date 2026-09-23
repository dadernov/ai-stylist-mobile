import os
import struct
import tempfile
import unittest
import zlib
from io import BytesIO
from unittest.mock import patch

from fastapi import UploadFile, HTTPException
from fastapi.testclient import TestClient
import python_multipart
import httpx

import app
import access
import accounts
from test_access import photo


class Requests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'AI_QUOTA_DB': self.temp.name + '/quota.sqlite3',
            'AI_ACCOUNTS_DB': self.temp.name + '/accounts.sqlite3', 'AI_CLIENT_TOKENS': 'test', 'AI_MAX_REQUEST_BYTES': '20000'})
        self.env.start(); access.reset_state_for_tests(); accounts.reset_state_for_tests()
        self.token = accounts.register('audit', 'password-123')['token']
        self.headers = {'Authorization': 'Bearer test', 'X-Session-Token': self.token}
        if 'https://wardrobe.test' not in app._allowed_origins: app._allowed_origins.append('https://wardrobe.test')
        self.client = TestClient(app.app)

    def tearDown(self):
        self.client.close(); access.reset_state_for_tests(); accounts.reset_state_for_tests(); self.env.stop(); self.temp.cleanup()

    def test_unauthorized_request_is_rejected_before_parser(self):
        with patch.object(python_multipart.MultipartParser, 'write', side_effect=AssertionError('Parser must not run')):
            response = self.client.post('/analyze', files={'file': ('photo.jpg', b'harmless')})
        self.assertEqual(response.status_code, 401)

    def test_content_length_limit(self):
        response = self.client.post('/analyze', headers=self.headers, files={'file': ('photo.jpg', b'x' * 22000)})
        self.assertEqual(response.status_code, 413)

    def test_streaming_limit(self):
        response = self.client.post('/analyze', headers={**self.headers, 'Content-Type': 'multipart/form-data; boundary=a'},
            content=iter([b'--a\r\nContent-Disposition: form-data; name="file"; filename="x"\r\n\r\n', b'x' * 22000, b'\r\n--a--\r\n']))
        self.assertEqual(response.status_code, 413)

    def test_large_text_part_is_rejected(self):
        response = self.client.post('/analyze', headers=self.headers, files={'section_hint': (None, 'x' * 9000), 'file': ('photo.jpg', photo())})
        self.assertEqual(response.status_code, 400)

    def test_urlencoded_body_is_rejected(self):
        response = self.client.post('/analyze', headers=self.headers, data={'a': 'b'})
        self.assertEqual(response.status_code, 415)

    def test_cors_supports_session_and_auth_get(self):
        for method, path in [('POST', '/analyze'), ('GET', '/auth/me')]:
            response = self.client.options(path, headers={'Origin': 'https://wardrobe.test',
                'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'authorization,content-type,x-session-token'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['access-control-allow-origin'], 'https://wardrobe.test')
        response = self.client.options('/analyze', headers={'Origin': 'https://unknown.test', 'Access-Control-Request-Method': 'POST'})
        self.assertEqual(response.status_code, 400)

    def test_auth_me_works_when_generation_quota_exhausted(self):
        access.charge('audit', 100)
        self.assertEqual(self.client.get('/auth/me', headers=self.headers).status_code, 200)


class PixelLimits(unittest.IsolatedAsyncioTestCase):
    async def test_provider_download_has_a_byte_limit(self):
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, content=b'x' * 2000))) as client:
            with patch.object(app, 'MAX_UPLOAD_BYTES', 1000), patch('builtins.print') as log:
                result = await app._load_image_from_url_or_data_url(client, 'https://provider.test/private-signed-url')
            self.assertIsNone(result)
            self.assertNotIn('private-signed-url', str(log.call_args_list))

    async def test_provider_image_also_has_bounded_working_resolution(self):
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, content=photo((3000, 4000))))) as client:
            result = await app._load_image_from_url_or_data_url(client, 'https://provider.test/result')
        self.assertLessEqual(max(result.size), 2048)

    async def test_compressed_large_image_is_rejected_before_decode(self):
        def chunk(kind, data):
            return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
        compressor = zlib.compressobj()
        row = b'\0' * 24001
        compressed = b''.join(compressor.compress(row) for _ in range(8000)) + compressor.flush()
        png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 8000, 8000, 8, 2, 0, 0, 0)) + chunk(b'IDAT', compressed) + chunk(b'IEND', b'')
        with self.assertRaises(HTTPException) as error:
            await app.read_upload(UploadFile(file=BytesIO(png), filename='large.png'), 'person_file')
        self.assertEqual(error.exception.status_code, 413)

    def test_working_resolution_is_bounded(self):
        image = app._working_image(photo((3000, 4000)))
        self.assertLessEqual(max(image.size), 2048)
        self.assertAlmostEqual(image.width / image.height, .75, places=2)
