import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

import accounts


class Registration(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        os.environ["AI_ACCOUNTS_DB"] = os.path.join(self.directory.name, "accounts.sqlite3")
        accounts.reset_state_for_tests()

    def tearDown(self):
        accounts.reset_state_for_tests()
        self.directory.cleanup()
        os.environ.pop("AI_ACCOUNTS_DB", None)

    def test_register_then_sign_in(self):
        created = accounts.register("Masha", "very-long-password", "Маша")
        self.assertEqual(created["login"], "masha", "логин приводится к нижнему регистру")
        self.assertEqual(created["displayName"], "Маша")
        signed = accounts.login_user("MASHA", "very-long-password")
        self.assertEqual(signed["login"], "masha")
        self.assertNotEqual(signed["token"], created["token"], "каждый вход — своя сессия")

    def test_login_is_unique(self):
        accounts.register("masha", "very-long-password")
        with self.assertRaises(HTTPException) as raised:
            accounts.register("Masha", "another-long-password")
        self.assertEqual(raised.exception.status_code, 409)

    def test_weak_input_is_refused(self):
        for login, password in [("ma", "very-long-password"), ("маша", "very-long-password"),
                                ("masha!", "very-long-password"), ("masha", "short")]:
            with self.assertRaises(HTTPException) as raised:
                accounts.register(login, password)
            self.assertEqual(raised.exception.status_code, 422, f"{login}/{password}")

    def test_wrong_password_is_refused(self):
        accounts.register("masha", "very-long-password")
        with self.assertRaises(HTTPException) as raised:
            accounts.login_user("masha", "very-long-passwore")
        self.assertEqual(raised.exception.status_code, 401)

    def test_unknown_login_looks_the_same_as_a_wrong_password(self):
        # Иначе по коду ответа видно, какие логины заняты.
        with self.assertRaises(HTTPException) as raised:
            accounts.login_user("nobody", "very-long-password")
        self.assertEqual(raised.exception.status_code, 401)

    def test_repeated_misses_lock_the_account_briefly(self):
        accounts._address_misses.clear()
        accounts.register("masha", "very-long-password")
        for _ in range(5):
            with self.assertRaises(HTTPException):
                accounts.login_user("masha", "nope-nope-nope")
        with self.assertRaises(HTTPException) as raised:
            accounts.login_user("masha", "very-long-password")
        self.assertEqual(raised.exception.status_code, 429, "перебор должен упираться в паузу")

    def test_a_stranger_guessing_does_not_lock_the_owner_out(self):
        accounts._address_misses.clear()
        accounts.register("dasha", "very-long-password")
        for _ in range(5):
            with self.assertRaises(HTTPException):
                accounts.login_user("dasha", "nope-nope-nope", "203.0.113.9")
        with self.assertRaises(HTTPException) as raised:
            accounts.login_user("dasha", "very-long-password", "203.0.113.9")
        self.assertEqual(raised.exception.status_code, 429, "the guessing address is paused")
        self.assertIn("token", accounts.login_user("dasha", "very-long-password", "198.51.100.7"), "the owner elsewhere gets in")

    def test_many_misses_from_anywhere_close_the_account_for_a_while(self):
        accounts._address_misses.clear()
        accounts.register("glasha", "very-long-password")
        for attempt in range(accounts.ACCOUNT_MISSES):
            with self.assertRaises(HTTPException):
                accounts.login_user("glasha", "nope-nope-nope", f"10.0.{attempt}.1")
        with self.assertRaises(HTTPException) as raised:
            accounts.login_user("glasha", "very-long-password", "198.51.100.7")
        self.assertEqual(raised.exception.status_code, 429)

    def test_password_is_not_stored_in_the_clear(self):
        accounts.register("masha", "very-long-password")
        dump = Path(os.environ["AI_ACCOUNTS_DB"]).read_bytes()
        self.assertNotIn(b"very-long-password", dump)
        self.assertIn(b"scrypt$", dump)


class Sessions(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        os.environ["AI_ACCOUNTS_DB"] = os.path.join(self.directory.name, "accounts.sqlite3")
        accounts.reset_state_for_tests()
        self.token = accounts.register("masha", "very-long-password")["token"]

    def tearDown(self):
        accounts.reset_state_for_tests()
        self.directory.cleanup()
        os.environ.pop("AI_ACCOUNTS_DB", None)

    def test_session_identifies_the_owner(self):
        self.assertEqual(accounts.session_owner(self.token), "masha")

    def test_session_survives_a_restart(self):
        # Ради этого всё и затевалось: вход не должен спрашиваться заново
        # при каждом запуске приложения.
        accounts.reset_state_for_tests()
        self.assertEqual(accounts.session_owner(self.token), "masha")

    def test_unknown_or_empty_token_owns_nothing(self):
        for value in (None, "", "выдуманный"):
            self.assertIsNone(accounts.session_owner(value))

    def test_logout_ends_the_session(self):
        accounts.forget_session(self.token)
        self.assertIsNone(accounts.session_owner(self.token))

    def test_expired_session_is_dropped(self):
        future = time.time() + (accounts.SESSION_TTL_DAYS + 1) * 86400
        with patch("accounts.time.time", return_value=future):
            self.assertIsNone(accounts.session_owner(self.token))

    def test_raw_token_is_not_stored(self):
        # В базе лежит отпечаток: утечка таблицы не должна давать готовые
        # ключи от чужих аккаунтов.
        dump = Path(os.environ["AI_ACCOUNTS_DB"]).read_bytes()
        self.assertNotIn(self.token.encode(), dump)


if __name__ == "__main__":
    unittest.main()
