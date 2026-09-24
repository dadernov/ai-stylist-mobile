import os
import tempfile
import unittest
from io import BytesIO

from fastapi import HTTPException, UploadFile
from PIL import Image

import access
import accounts
import app
import jobs


def photo(size=(64, 64), fmt="JPEG"):
    buffer = BytesIO()
    Image.new("RGB", size, (120, 90, 60)).save(buffer, format=fmt)
    return buffer.getvalue()


class Gate(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        os.environ["AI_QUOTA_DB"] = os.path.join(self.directory.name, "quota.sqlite3")
        os.environ["AI_ACCOUNTS_DB"] = os.path.join(self.directory.name, "accounts.sqlite3")
        os.environ["AI_CLIENT_TOKENS"] = "good-token, second-token"
        os.environ["AI_DAILY_CREDITS"] = "3"
        access.reset_state_for_tests()
        accounts.reset_state_for_tests()
        self.session = accounts.register("masha", "very-long-password")["token"]

    def tearDown(self):
        access.reset_state_for_tests()
        accounts.reset_state_for_tests()
        self.directory.cleanup()
        for name in ("AI_QUOTA_DB", "AI_ACCOUNTS_DB", "AI_CLIENT_TOKENS", "AI_DAILY_CREDITS"):
            os.environ.pop(name, None)

    DEFAULT = object()

    def call(self, token="good-token", session=DEFAULT):
        return access.require_account(f"Bearer {token}" if token else None,
                                      self.session if session is self.DEFAULT else session)

    def test_known_token_and_session_pass(self):
        self.assertEqual(self.call(), "masha")
        self.assertEqual(self.call(token="second-token"), "masha")

    def test_unknown_app_token_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            self.call(token="guessed")
        self.assertEqual(raised.exception.status_code, 401)

    def test_non_ascii_token_is_rejected_cleanly(self):
        # Заголовок присылает клиент, и там может быть что угодно. Сравнение
        # постоянного времени не принимает не-ASCII строки, поэтому без
        # приведения к байтам такой запрос падал бы с 500 вместо 401.
        with self.assertRaises(HTTPException) as raised:
            self.call(token="подобранный")
        self.assertEqual(raised.exception.status_code, 401)

    def test_missing_app_token_is_rejected(self):
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

    def test_work_requires_a_signed_in_user(self):
        for value in (None, "", "выдуманный-токен"):
            with self.assertRaises(HTTPException) as raised:
                self.call(session=value)
            self.assertEqual(raised.exception.status_code, 401, value)

    def test_app_token_alone_opens_only_the_login_endpoints(self):
        self.assertTrue(access.require_app("Bearer good-token"))
        with self.assertRaises(HTTPException):
            access.require_app("Bearer guessed")

    def test_quota_is_counted_per_account(self):
        for _ in range(3):
            access.charge("masha")
        self.assertEqual(self.call(), 'masha')
        with self.assertRaises(HTTPException) as raised:
            jobs.start('masha', 'quota-test', 'fingerprint', 1)
        self.assertEqual(raised.exception.status_code, 429)
        # Переустановка приложения больше не обнуляет израсходованное: счёт
        # ведётся по аккаунту, а новый аккаунт — это уже другой человек.
        other = accounts.register("petya", "another-long-password")["token"]
        self.assertEqual(self.call(session=other), "petya")

    def test_charge_accumulates_and_survives_a_restart(self):
        access.charge("masha", 2)
        access.reset_state_for_tests()
        self.assertEqual(access.spent_today("masha"), 2)


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
