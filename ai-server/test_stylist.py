import json
import unittest
from unittest import mock

import stylist


def item(id, section, category, warmth=None):
    return {'id': id, 'section': section, 'category': category, 'name': id, 'profile': {'warmth': warmth} if warmth else None}


WARDROBE = [item('tee', 'Верх', 'Футболка', 2), item('sweater', 'Верх', 'Свитер', 4), item('dress', 'Верх', 'Платье', 2),
            item('jeans', 'Низ', 'Джинсы'), item('skirt', 'Низ', 'Юбка'), item('shorts', 'Низ', 'Шорты', 1),
            item('tights', 'Низ', 'Колготки'), item('sneakers', 'Обувь', 'Кроссовки'), item('heels', 'Обувь', 'Туфли'),
            item('leather', 'Верхняя одежда', 'Куртка', 3), item('puffer', 'Верхняя одежда', 'Пуховик', 5),
            item('bag', 'Сумки', 'Сумка'), item('clutch', 'Сумки', 'Клатч')]


class CheckTest(unittest.TestCase):
    def test_whole_outfits_only(self):
        self.assertEqual(stylist.check(['tee', 'jeans', 'sneakers'], WARDROBE), ['tee', 'jeans', 'sneakers'])
        self.assertIsNone(stylist.check(['tee', 'sneakers'], WARDROBE))
        self.assertIsNone(stylist.check(['tee', 'jeans'], WARDROBE))  # shoes exist in the wardrobe
        self.assertIsNone(stylist.check(['dress', 'jeans', 'heels'], WARDROBE))
        self.assertIsNone(stylist.check(['tee', 'jeans', 'skirt', 'sneakers'], WARDROBE))
        self.assertIsNone(stylist.check(['tee', 'jeans', 'sneakers', 'bag', 'clutch'], WARDROBE))
        self.assertIsNone(stylist.check(['tee', 'jeans', 'tights', 'sneakers'], WARDROBE))
        self.assertEqual(stylist.check(['dress', 'tights', 'heels', 'ghost'], WARDROBE), ['dress', 'tights', 'heels'])

    def test_weather(self):
        self.assertIsNone(stylist.check(['tee', 'shorts', 'sneakers', 'puffer'], WARDROBE, 5))
        self.assertIsNone(stylist.check(['tee', 'jeans', 'sneakers'], WARDROBE, 5))
        self.assertIsNone(stylist.check(['tee', 'jeans', 'sneakers', 'leather'], WARDROBE, -5))
        self.assertTrue(stylist.check(['tee', 'jeans', 'sneakers', 'puffer'], WARDROBE, -5))
        self.assertIsNone(stylist.check(['tee', 'jeans', 'sneakers', 'puffer'], WARDROBE, 25))
        self.assertIsNone(stylist.check(['sweater', 'jeans', 'sneakers'], WARDROBE, 24))
        self.assertTrue(stylist.check(['tee', 'jeans', 'sneakers', 'leather'], WARDROBE, 17, 'rain'))


class ComposeTest(unittest.TestCase):
    def test_keeps_valid_unique_looks(self):
        answer = json.dumps({'looks': [
            {'ids': ['tee', 'jeans', 'sneakers'], 'title': 'A', 'why': 'w', 'tips': ['t']},
            {'ids': ['tee', 'jeans', 'heels'], 'title': 'Same core'},
            {'ids': ['tee', 'skirt'], 'title': 'No shoes'},
            {'ids': ['dress', 'heels', 'clutch'], 'title': 'B'}]})
        with mock.patch.object(stylist, '_call', return_value='```json\n' + answer + '\n```'):
            looks = stylist.compose(WARDROBE, {'temperature': 18}, 4)
        self.assertEqual([look['title'] for look in looks], ['A', 'B'])

    def test_cut_off_answer_keeps_whole_looks(self):
        text = '{"looks": [{"ids": ["tee", "jeans", "sneakers"], "title": "A", "why": "w", "tips": ["t"]}, {"ids": ["dress", "he'
        self.assertEqual([look['title'] for look in stylist._looks(text)], ['A'])

    def test_anchor_required(self):
        answer = json.dumps({'looks': [{'ids': ['tee', 'jeans', 'sneakers']}, {'ids': ['dress', 'heels']}]})
        with mock.patch.object(stylist, '_call', return_value=answer):
            looks = stylist.compose(WARDROBE, {'anchorId': 'dress'}, 4)
        self.assertEqual([look['itemIds'] for look in looks], [['dress', 'heels']])


if __name__ == '__main__':
    unittest.main()
