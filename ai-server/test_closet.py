import base64
import os
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from PIL import Image

import access
import accounts
import app
import closet

KEY = base64.b64encode(bytes(range(32))).decode()


def jpeg_with_location():
    image = Image.new('RGB', (400, 600), 'navy')
    exif = Image.Exif()
    exif[0x8825] = {1: 'N', 2: (55.0, 45.0, 0.0), 3: 'E', 4: (37.0, 37.0, 0.0)}  # GPS
    exif[0x010F] = 'PhoneMaker'
    data = BytesIO()
    image.save(data, format='JPEG', exif=exif)
    return data.getvalue()


def cutout():
    data = BytesIO()
    Image.new('RGBA', (300, 300), (200, 30, 30, 0)).save(data, format='PNG')
    return data.getvalue()


class Closet(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'AI_CLOSET_DB': self.temp.name + '/closet.sqlite3', 'AI_CLOSET_DIR': self.temp.name + '/closet',
                                           'AI_CLOSET_KEY': KEY})
        self.env.start()
        closet.reset_state_for_tests()

    def tearDown(self):
        closet.reset_state_for_tests()
        self.env.stop()
        self.temp.cleanup()

    def test_items_come_back_to_their_owner_only(self):
        photo = closet.put_blob('masha', cutout())
        closet.put_item('masha', '1727000000001', {'name': 'Coat', 'imageBlob': photo})
        own = closet.snapshot('masha')
        self.assertEqual([(item['id'], item['data']['name']) for item in own['items']], [('1727000000001', 'Coat')])
        self.assertEqual(closet.snapshot('petya')['items'], [], 'another account sees nothing')
        with self.assertRaises(HTTPException) as other:
            closet.get_blob('petya', photo)
        self.assertEqual(other.exception.status_code, 404, 'a photo id alone opens nothing')

    def test_an_item_cannot_point_at_someone_elses_photo(self):
        foreign = closet.put_blob('masha', cutout())
        with self.assertRaises(HTTPException):
            closet.put_item('petya', '1', {'name': 'Stolen', 'imageBlob': foreign})

    def test_photos_are_encrypted_on_disk_and_lose_their_location(self):
        photo = closet.put_blob('masha', jpeg_with_location())
        files = [path for path in Path(self.temp.name, 'closet').rglob('*') if path.is_file()]
        self.assertEqual(len(files), 1)
        stored = files[0].read_bytes()
        self.assertNotIn(b'\xff\xd8', stored[:4], 'no readable JPEG on disk')
        self.assertNotIn(b'PhoneMaker', stored)
        self.assertNotIn('masha', str(files[0]), 'the folder does not reveal the login')
        self.assertEqual(files[0].stat().st_mode & 0o077, 0, 'only the service reads it')
        data, mime = closet.get_blob('masha', photo)
        self.assertEqual(mime, 'image/jpeg')
        restored = Image.open(BytesIO(data))
        self.assertEqual(restored.size, (400, 600))
        self.assertNotIn(0x8825, restored.getexif(), 'no GPS survives')
        self.assertNotIn(0x010F, restored.getexif())

    def test_cutouts_keep_their_transparency(self):
        data, mime = closet.get_blob('masha', closet.put_blob('masha', cutout()))
        self.assertEqual(mime, 'image/png')
        self.assertEqual(Image.open(BytesIO(data)).mode, 'RGBA')

    def test_a_tampered_or_moved_file_does_not_open(self):
        first = closet.put_blob('masha', cutout())
        second = closet.put_blob('masha', cutout())
        folder = next(Path(self.temp.name, 'closet').iterdir())
        (folder / second).write_bytes((folder / first).read_bytes())
        with self.assertRaises(Exception):
            closet.get_blob('masha', second)

    def test_without_a_key_nothing_is_stored_in_the_clear(self):
        with patch.dict(os.environ, {'AI_CLOSET_KEY': ''}):
            with self.assertRaises(HTTPException) as unavailable:
                closet.put_blob('masha', cutout())
        self.assertEqual(unavailable.exception.status_code, 503)

    def test_ids_are_checked(self):
        for bad in ('../etc/passwd', 'a/b', '', 'x' * 65):
            with self.assertRaises(HTTPException):
                closet.put_item('masha', bad, {'name': 'x'})
            with self.assertRaises(HTTPException):
                closet.get_blob('masha', bad)

    def test_not_an_image_is_refused(self):
        with self.assertRaises(HTTPException) as refused:
            closet.put_blob('masha', b'<?php echo 1; ?>')
        self.assertEqual(refused.exception.status_code, 422)

    def test_changes_come_after_since_and_deletions_as_tombstones(self):
        first = closet.put_item('masha', '1', {'name': 'Tee'})
        closet.put_item('masha', '2', {'name': 'Jeans'})
        closet.delete_item('masha', '1')
        changes = closet.snapshot('masha', since=first)
        self.assertEqual({(item['id'], item['deleted']) for item in changes['items']}, {('1', True), ('2', False)})
        self.assertEqual(changes['items'][-1]['data']['name'], 'Tee', 'a deleted item keeps its data for a while')

    def test_limits_hold(self):
        with patch.dict(os.environ, {'AI_CLOSET_MAX_ITEMS': '1'}):
            closet.put_item('masha', '1', {'name': 'Tee'})
            closet.put_item('masha', '1', {'name': 'Tee, renamed'})
            with self.assertRaises(HTTPException):
                closet.put_item('masha', '2', {'name': 'One too many'})
        with self.assertRaises(HTTPException):
            closet.put_item('masha', '3', {'name': 'x' * 20000})
        with patch.dict(os.environ, {'AI_CLOSET_MAX_BLOBS': '1'}):
            closet.put_blob('masha', cutout())
            with self.assertRaises(HTTPException):
                closet.put_blob('masha', cutout())

    def test_old_tombstones_and_unused_photos_are_collected(self):
        kept = closet.put_blob('masha', cutout())
        orphan = closet.put_blob('masha', cutout())
        closet.put_item('masha', '1', {'name': 'Tee', 'imageBlob': kept})
        closet.put_item('masha', '2', {'name': 'Old'})
        closet.delete_item('masha', '2')
        import time
        self.assertEqual(closet.collect('masha', now=time.time() + 40 * 86400), 1)
        closet.get_blob('masha', kept)
        with self.assertRaises(HTTPException):
            closet.get_blob('masha', orphan)
        self.assertEqual([item['id'] for item in closet.snapshot('masha')['items']], ['1'])

    def test_deleting_the_account_deletes_everything(self):
        photo = closet.put_blob('masha', cutout())
        closet.put_item('masha', '1', {'name': 'Tee', 'imageBlob': photo})
        closet.put_profile('masha', {'modelBlob': photo, 'gender': 'female'})
        closet.purge_owner('masha')
        left = closet.snapshot('masha')
        self.assertEqual((left['items'], left['profile']), ([], None))
        self.assertEqual([path for path in Path(self.temp.name, 'closet').rglob('*') if path.is_file()], [])


class Endpoints(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'AI_CLOSET_DB': self.temp.name + '/closet.sqlite3', 'AI_CLOSET_DIR': self.temp.name + '/closet',
                                           'AI_CLOSET_KEY': KEY, 'AI_QUOTA_DB': self.temp.name + '/quota.sqlite3',
                                           'AI_ACCOUNTS_DB': self.temp.name + '/accounts.sqlite3', 'AI_STAGE_CACHE_DIR': self.temp.name + '/stages'})
        self.env.start()
        closet.reset_state_for_tests(); access.reset_state_for_tests(); accounts.reset_state_for_tests()

    def tearDown(self):
        closet.reset_state_for_tests(); access.reset_state_for_tests(); accounts.reset_state_for_tests()
        self.env.stop()
        self.temp.cleanup()

    async def test_the_app_syncs_through_the_endpoints_of_its_own_account(self):
        upload = UploadFile(file=BytesIO(cutout()), filename='item.png')
        photo = app.closet_put_blob(upload, device='masha')['id']
        app.closet_put_item('1', app.ClosetRecord(data={'name': 'Coat', 'imageBlob': photo}), device='masha')
        app.closet_put_profile(app.ClosetRecord(data={'gender': 'female'}), device='masha')
        snapshot = app.closet_snapshot(device='masha')
        self.assertEqual(snapshot['items'][0]['data']['imageBlob'], photo)
        self.assertEqual(snapshot['profile']['data'], {'gender': 'female'})
        response = app.closet_get_blob(photo, device='masha')
        self.assertEqual((response.media_type, response.headers['cache-control']), ('image/png', 'private, no-store'))
        with self.assertRaises(HTTPException):
            app.closet_get_blob(photo, device='petya')

    async def test_deleting_the_account_deletes_the_wardrobe(self):
        accounts.register('masha', 'password123', 'Masha')
        app.closet_put_item('1', app.ClosetRecord(data={'name': 'Coat'}), device='masha')
        await app.auth_delete_account(login='masha')
        self.assertEqual(closet.snapshot('masha')['items'], [])


if __name__ == '__main__':
    unittest.main()
