import os
import tempfile
import unittest
from io import BytesIO

from fastapi import HTTPException, UploadFile
from PIL import Image

import access
import app


def photo(size=(64, 64), fmt="JPEG"):
    buffer = BytesIO()
    Image.new("RGB", size, (120, 90, 60)).save(buffer, format=fmt)
    return buffer.getvalue()


class Gate(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        os.environ["AI_QUOTA_DB"] = os.path.join(self.directory.name, "quota.sqlite3")
        os.environ["AI_CLIENT_TOKENS"] = "good-token, second-token"
        os.environ["AI_DEVICE_DAILY_QUOTA"] = "3"
        access.reset_state_for_tests()

    def tearDown(self):
        access.reset_state_for_tests()
        self.directory.cleanup()
        for name in ("AI_QUOTA_DB", "AI_CLIENT_TOKENS", "AI_DEVICE_DAILY_QUOTA"):
            os.environ.pop(name, None)

    def call(self, token="good-token", device="device-abc123"):
        return access.require_client(f"Bearer {token}" if token else None, device)

    def test_known_token_passes(self):
        self.assertEqual(self.call(), "device-abc123")
        self.assertEqual(self.call(token="second-token"), "device-abc123")

    def test_unknown_token_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            self.call(token="guessed")
        self.assertEqual(raised.exception.status_code, 401)

    def test_missing_header_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            self.call(token=None)
        self.assertEqual(raised.exception.status_code, 401)

    def test_unconfigured_server_refuses_instead_of_opening(self):
        # Пустой список токенов — это незавершённая настройка, а не «пускать
        # всех»: платный эндпоинт не должен открываться из-за забытой переменной.
        os.environ["AI_CLIENT_TOKENS"] = ""
        with self.assertRaises(HTTPException) as raised:
            self.call()
        self.assertEqual(raised.exception.status_code, 503)

    def test_device_identifier_is_required(self):
        for value in ("", "  ", "короткий", "with space", "x" * 200):
            with self.assertRaises(HTTPException) as raised:
                self.call(device=value)
            self.assertEqual(raised.exception.status_code, 400, value)

    def test_quota_limits_the_damage_from_a_leaked_token(self):
        for _ in range(3):
            access.charge("device-abc123")
        with self.assertRaises(HTTPException) as raised:
            self.call()
        self.assertEqual(raised.exception.status_code, 429)
        # Соседнее устройство не страдает от чужого перерасхода.
        self.assertEqual(self.call(device="device-other1"), "device-other1")

    def test_charge_accumulates_and_survives_a_restart(self):
        access.charge("device-abc123", 2)
        access.reset_state_for_tests()
        self.assertEqual(access.spent_today("device-abc123"), 2)


class Uploads(unittest.IsolatedAsyncioTestCase):
    def upload(self, payload, name="x.jpg"):
        return UploadFile(file=BytesIO(payload), filename=name)

    async def test_image_passes(self):
        content, mime = await app.read_upload(self.upload(photo()), "person_file")
        self.assertGreater(len(content), 100)
        self.assertTrue(mime)

    async def test_missing_optional_file_is_fine(self):
        self.assertEqual(await app.read_upload(None, "outer_file"), (None, None))

    async def test_non_image_is_rejected(self):
        # Имя и content-type выбирает клиент, поэтому тип проверяется по содержимому.
        with self.assertRaises(HTTPException) as raised:
            await app.read_upload(self.upload(b"#!/bin/sh\nrm -rf /", "photo.jpg"), "person_file")
        self.assertEqual(raised.exception.status_code, 422)

    async def test_empty_file_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            await app.read_upload(self.upload(b""), "person_file")
        self.assertEqual(raised.exception.status_code, 422)

    async def test_oversized_file_is_rejected(self):
        payload = b"\xff\xd8\xff" + b"0" * (app.MAX_UPLOAD_BYTES + 10)
        with self.assertRaises(HTTPException) as raised:
            await app.read_upload(self.upload(payload), "person_file")
        self.assertEqual(raised.exception.status_code, 413)


if __name__ == "__main__":
    unittest.main()
