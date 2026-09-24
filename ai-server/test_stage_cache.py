import os
import tempfile
import time
import unittest
from unittest.mock import patch

import stage_cache
import tryon_policy


def chain(*garments, profile='final', person='person'):
    return stage_cache.chain_keys(profile, person, [(slot, digest, f'prompt for {slot}') for slot, digest in garments])


class Keys(unittest.TestCase):
    def test_every_layer_has_its_own_key_and_same_inputs_give_same_keys(self):
        keys = chain(('bottom', 'jeans'), ('top', 'tee'), ('outer', 'coat'))
        self.assertEqual(len(set(keys)), 3)
        self.assertEqual(keys, chain(('bottom', 'jeans'), ('top', 'tee'), ('outer', 'coat')))

    def test_a_different_jacket_keeps_the_keys_of_the_layers_below(self):
        # This is the whole point: the base under a new jacket is the same frame.
        with_coat = chain(('bottom', 'jeans'), ('top', 'tee'), ('outer', 'coat'))
        with_bomber = chain(('bottom', 'jeans'), ('top', 'tee'), ('outer', 'bomber'))
        self.assertEqual(with_coat[:2], with_bomber[:2])
        self.assertNotEqual(with_coat[2], with_bomber[2])

    def test_a_different_lower_layer_changes_every_key_above_it(self):
        jeans = chain(('bottom', 'jeans'), ('top', 'tee'))
        skirt = chain(('bottom', 'skirt'), ('top', 'tee'))
        self.assertNotEqual(jeans[0], skirt[0])
        self.assertNotEqual(jeans[1], skirt[1])

    def test_instruction_profile_and_person_are_part_of_the_key(self):
        base = chain(('top', 'tee'))
        self.assertNotEqual(base, stage_cache.chain_keys('final', 'person', [('top', 'tee', 'tucked prompt')]))
        self.assertNotEqual(base, chain(('top', 'tee'), profile='draft'))
        self.assertNotEqual(base, chain(('top', 'tee'), person='someone else'))


class Storage(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'AI_STAGE_CACHE_DIR': self.temp.name})
        self.env.start()
        self.keys = chain(('bottom', 'jeans'), ('shoes', 'boots'), ('top', 'tee'), ('outer', 'coat'))

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def test_nothing_cached_means_start_from_the_photo(self):
        self.assertEqual(stage_cache.lookup('masha', self.keys), (0, None))

    def test_deepest_cached_layer_wins(self):
        stage_cache.store('masha', self.keys[0], b'bottom')
        stage_cache.store('masha', self.keys[1], b'bottom+shoes')
        self.assertEqual(stage_cache.lookup('masha', self.keys), (2, b'bottom+shoes'))

    def test_the_full_chain_is_never_served(self):
        # Asking for the same garments again means "another variant": the
        # outermost layer is always generated anew.
        for key in self.keys:
            stage_cache.store('masha', key, key.encode())
        depth, frame = stage_cache.lookup('masha', self.keys)
        self.assertEqual(depth, 3)
        self.assertEqual(frame, self.keys[2].encode())

    def test_a_single_garment_look_never_reuses_anything(self):
        key = chain(('top', 'tee'))
        stage_cache.store('masha', key[0], b'tee')
        self.assertEqual(stage_cache.lookup('masha', key), (0, None))

    def test_frames_are_private_to_their_owner(self):
        stage_cache.store('masha', self.keys[0], b'bottom')
        self.assertEqual(stage_cache.lookup('petya', self.keys), (0, None))

    def test_owner_directory_does_not_contain_the_login(self):
        stage_cache.store('../../etc', self.keys[0], b'bottom')
        stored = [path for path in os.listdir(self.temp.name)]
        self.assertEqual(len(stored), 1)
        self.assertNotIn('etc', stored[0])
        self.assertNotIn('.', stored[0])

    def test_life_is_capped_by_the_privacy_policy(self):
        with patch.dict(os.environ, {'AI_STAGE_CACHE_TTL_SECONDS': str(7 * 24 * 3600)}):
            self.assertEqual(stage_cache.ttl_seconds(), 24 * 3600, 'the policy promises 24 hours')

    def test_expired_frame_is_neither_served_nor_kept(self):
        stage_cache.store('masha', self.keys[0], b'bottom')
        with patch.object(stage_cache.time, 'time', return_value=time.time() + 24 * 3600 + 5):
            self.assertEqual(stage_cache.lookup('masha', self.keys), (0, None))
        self.assertEqual(stage_cache.lookup('masha', self.keys), (0, None), 'the expired file is gone')

    def test_reading_never_extends_the_life_of_a_frame(self):
        stage_cache.store('masha', self.keys[0], b'bottom')
        path = stage_cache._owner_dir('masha') / self.keys[0]
        created = path.stat().st_mtime
        os.utime(path, (created - 100, created - 100))
        stage_cache.lookup('masha', self.keys)
        self.assertEqual(path.stat().st_mtime, created - 100)

    def test_zero_lifetime_disables_the_cache(self):
        with patch.dict(os.environ, {'AI_STAGE_CACHE_TTL_SECONDS': '0'}):
            stage_cache.store('masha', self.keys[0], b'bottom')
            self.assertEqual(stage_cache.lookup('masha', self.keys), (0, None))
        self.assertFalse(stage_cache._owner_dir('masha').exists())

    def test_account_deletion_removes_only_that_account(self):
        stage_cache.store('masha', self.keys[0], b'bottom')
        stage_cache.store('petya', self.keys[0], b'bottom')
        stage_cache.purge_owner('masha')
        self.assertEqual(stage_cache.lookup('masha', self.keys), (0, None))
        self.assertEqual(stage_cache.lookup('petya', self.keys), (1, b'bottom'))

    def test_size_cap_drops_the_oldest_frames_first(self):
        with patch.dict(os.environ, {'AI_STAGE_CACHE_MAX_BYTES': '10'}):
            stage_cache.store('masha', self.keys[0], b'123456')
            path = stage_cache._owner_dir('masha') / self.keys[0]
            os.utime(path, (time.time() - 50, time.time() - 50))
            stage_cache.store('masha', self.keys[1], b'abcdef')
        self.assertEqual(stage_cache.lookup('masha', self.keys), (2, b'abcdef'))
        self.assertFalse(path.exists())

    def test_abandoned_partial_writes_are_cleaned(self):
        directory = stage_cache._owner_dir('masha')
        directory.mkdir(parents=True)
        leftover = directory / '.tmp-crash'
        leftover.write_bytes(b'half a frame')
        os.utime(leftover, (time.time() - 7200, time.time() - 7200))
        stage_cache.prune()
        self.assertFalse(leftover.exists())


class Profiles(unittest.TestCase):
    def test_draft_is_four_times_cheaper_than_final(self):
        with patch.dict(os.environ, {}, clear=False):
            for name in ('FASHN_DRAFT_MODE', 'FASHN_DRAFT_RESOLUTION', 'FASHN_FINAL_MODE', 'FASHN_FINAL_RESOLUTION', 'FASHN_QUALITY_RESOLUTION'):
                os.environ.pop(name, None)
            draft, final = tryon_policy.profile('draft'), tryon_policy.profile('final')
        self.assertEqual((draft.mode, draft.resolution, draft.credits), ('fast', '1k', 1))
        self.assertEqual((final.mode, final.resolution, final.credits), ('quality', '2k', 4))

    def test_credits_come_from_the_price_table_not_a_separate_setting(self):
        with patch.dict(os.environ, {'FASHN_DRAFT_MODE': 'balanced', 'FASHN_DRAFT_RESOLUTION': '2k'}):
            self.assertEqual(tryon_policy.profile('draft').credits, 3)

    def test_unknown_combination_falls_back_to_the_default_profile(self):
        with patch.dict(os.environ, {'FASHN_DRAFT_MODE': 'turbo', 'FASHN_DRAFT_RESOLUTION': '8k'}):
            draft = tryon_policy.profile('draft')
        self.assertEqual((draft.mode, draft.resolution), ('fast', '1k'))

    def test_legacy_resolution_setting_still_drives_the_final(self):
        with patch.dict(os.environ, {'FASHN_QUALITY_RESOLUTION': '4k'}):
            self.assertEqual(tryon_policy.profile('final').credits, 5)
            self.assertEqual(tryon_policy.profile('draft').resolution, '1k')

    def test_request_values_map_to_profiles(self):
        for value, expected in [('fast', 'draft'), ('draft', 'draft'), ('quality', 'final'), ('final', 'final'), ('', 'final'), ('bogus', 'final')]:
            self.assertEqual(tryon_policy.normalize_quality(value), expected, value)


if __name__ == '__main__':
    unittest.main()
