"""Layering regressions for bare-body sources and fragmented human parsing."""
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

import face_guard
import tryon_matte


class BodyCompositing(unittest.TestCase):
    def setUp(self):
        self.size = (200, 400)
        self.face = face_guard.Face(
            (85, 25, 30, 40),
            np.array([[92, 37], [108, 37], [100, 45], [94, 54], [106, 54]], float),
        )
        # Distinct uniform frames make every layer decision observable without
        # depending on an image model's accuracy.
        self.source = Image.new('RGB', self.size, (130, 130, 130))
        self.generated = Image.new('RGB', self.size, (70, 70, 70))
        lighting = patch.object(tryon_matte.image_color, 'match_source_lighting',
                                side_effect=lambda source, generated, *_: generated)
        lighting.start()
        self.addCleanup(lighting.stop)

    def body(self):
        labels = np.zeros((400, 200), dtype=np.uint8)
        labels[25:70, 85:115] = 11
        labels[70:205, 70:130] = 4
        labels[205:230, 72:128] = 6
        return labels

    def prepare(self, source, generated, slots=('top', 'bottom', 'long_outer')):
        image, keep, _ = tryon_matte.prepare(
            self.source, self.generated, source, generated, [self.face], slots,
        )
        result = Image.composite(self.source, image, keep)
        return np.asarray(keep), np.asarray(result)

    def test_disconnected_bare_leg_does_not_show_through_new_jeans(self):
        source = self.body()
        # A small parser gap at the waist must not turn one's own leg into
        # another person whose pixels are pasted over the generated garment.
        source[236:355, 72:94] = 12
        source[236:355, 107:128] = 13
        generated = self.body()
        generated[210:355, 66:98] = 6
        generated[210:355, 104:135] = 6
        keep, result = self.prepare(source, generated)
        self.assertTrue((keep[245:340, 76:90] == 0).all())
        self.assertTrue((result[245:340, 76:90] == 70).all())

    def test_enclosed_parsing_hole_cannot_reveal_bare_leg_inside_jeans(self):
        source = self.body()
        source[225:355, 72:95] = 12
        generated = self.body()
        generated[220:355, 68:100] = 6
        generated[265:285, 79:89] = 0
        keep, result = self.prepare(source, generated)
        self.assertTrue((keep[268:282, 81:87] == 0).all())
        self.assertTrue((result[268:282, 81:87] == 70).all())

    def test_new_sleeve_and_exposed_hand_share_one_generated_layer(self):
        source = self.body()
        # ATR represents an entire bare arm and its hand as one component.
        source[100:255, 48:70] = 14
        generated = self.body()
        generated[95:227, 45:74] = 4
        generated[227:255, 48:70] = 14
        keep, result = self.prepare(source, generated)
        self.assertTrue((keep[125:215, 52:66] == 0).all())
        self.assertTrue((keep[234:250, 52:66] == 0).all())
        self.assertTrue((result[234:250, 52:66] == 70).all())

    def test_disconnected_hand_does_not_pin_old_forearm_through_sleeve(self):
        source = self.body()
        source[175:255, 43:64] = 14
        generated = self.body()
        generated[160:228, 41:71] = 4
        generated[228:255, 43:64] = 14
        keep, _ = self.prepare(source, generated)
        self.assertTrue((keep[185:217, 48:60] == 0).all())
        self.assertTrue((keep[235:250, 48:60] == 0).all())

    def test_pants_gap_uses_generated_scene_without_source_fragments(self):
        source = self.body()
        source[230:350, 70:94] = 12
        source[230:350, 106:130] = 13
        generated = self.body()
        generated[215:350, 65:96] = 6
        generated[215:350, 104:135] = 6
        generated[215:245, 90:110] = 6
        keep, result = self.prepare(source, generated)
        self.assertTrue((keep[270:330, 98:102] == 0).all())
        self.assertTrue((result[270:330, 98:102] == 70).all())

    def test_bent_arm_and_its_enclosed_scenery_remain_coherent(self):
        source = self.body()
        source[120:190, 40:80] = 4
        source[130:175, 50:65] = 0
        generated = source.copy()
        keep, result = self.prepare(source, generated)
        self.assertTrue((keep[140:165, 54:62] == 0).all())
        self.assertTrue((result[140:165, 54:62] == 70).all())

    def test_body_envelope_keeps_distant_background_original(self):
        source = self.body()
        keep, result = self.prepare(source, source.copy())
        self.assertTrue((keep[170:190, :25] == 255).all())
        self.assertTrue((result[170:190, :25] == 130).all())

    def test_bare_feet_and_new_hems_are_copied_from_one_frame(self):
        source = self.body()
        source[230:360, 70:93] = 12
        source[360:381, 60:94] = 12
        source[230:360, 107:130] = 13
        source[360:381, 107:147] = 13
        generated = self.body()
        generated[220:357, 64:97] = 6
        generated[220:357, 103:137] = 6
        # Feet and fabric must never come from two independently posed frames.
        generated[357:383, 59:96] = 12
        generated[357:383, 105:149] = 13
        keep, result = self.prepare(source, generated)
        self.assertTrue((keep[364:377, 64:90] == 0).all())
        self.assertTrue((keep[364:377, 112:143] == 0).all())
        self.assertTrue((result[364:377, 64:90] == 70).all())

    def test_shoes_on_floor_do_not_warp_or_erase_nearby_garment(self):
        source = self.body()
        source[230:360, 90:112] = 12
        source[352:372, 63:86] = 9
        generated = self.body()
        generated[220:360, 87:118] = 6
        generated[352:372, 68:91] = 9

        with patch.object(tryon_matte.cv2, 'remap') as warp:
            keep, result = self.prepare(source, generated)
        warp.assert_not_called()
        self.assertTrue((keep[354:367, 65:88] == 0).all())
        self.assertTrue((result[354:367, 65:88] == 70).all())
        self.assertEqual(keep[350, 116], 0)
        self.assertEqual(keep[350, 20], 255)

    def test_cropped_bystander_shirt_at_edge_is_not_replaced(self):
        source = self.body()
        source[140:230, :16] = 4
        generated = self.body()
        keep, result = self.prepare(source, generated)
        self.assertTrue((keep[145:225, :13] == 255).all())
        self.assertTrue((result[145:225, :13] == 130).all())

    def test_ambiguous_fabric_next_to_arm_does_not_split_the_scene_layer(self):
        source = self.body()
        source[175:215, 35:75] = 14
        # The clothing parser calls a hanging blanket a skirt. Its connection
        # to the target goes through a bare arm, not through a worn garment.
        source[205:320, 20:55] = 5
        generated = self.body()
        generated[175:215, 35:75] = 14
        keep, result = self.prepare(source, generated)
        # When labels cannot distinguish touching scenery, the compositor must
        # not splice source skin or fabric into a differently posed body.
        self.assertTrue((keep[220:310, 23:50] == 0).all())
        self.assertTrue((result[220:310, 23:50] == 70).all())

    def test_old_long_garment_is_removed_beyond_short_replacement(self):
        source = self.body()
        source[200:320, 70:130] = 4
        generated = self.body()
        generated[205:320, 70:130] = 12
        keep, result = self.prepare(source, generated, slots=('top',))
        self.assertTrue((keep[245:310, 77:123] == 0).all())
        self.assertTrue((result[245:310, 77:123] == 70).all())

    def test_disconnected_fabric_far_from_subject_remains_original(self):
        source = self.body()
        source[205:230, 80:92] = 14
        source[280:310, 15:30] = 5
        generated = self.body()
        generated[205:230, 80:92] = 14
        keep, result = self.prepare(source, generated)
        self.assertTrue((keep[285:305, 18:28] == 255).all())
        self.assertTrue((result[285:305, 18:28] == 130).all())

    def test_replacement_does_not_move_pixels_or_inpaint_skin(self):
        source = self.body()
        source[230:365, 75:100] = 12
        generated = self.body()
        generated[220:350, 72:104] = 6
        with patch.object(tryon_matte.cv2, 'remap') as warp, \
             patch.object(tryon_matte.cv2, 'inpaint') as inpaint:
            self.prepare(source, generated)
        warp.assert_not_called()
        inpaint.assert_not_called()


if __name__ == '__main__':
    unittest.main()
