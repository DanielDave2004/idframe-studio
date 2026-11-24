import unittest
from io import BytesIO
from PIL import Image
from app.services.standard import standard_photo


class TestStandardPhoto(unittest.TestCase):
    def test_output_is_exact_size_and_dpi(self):
        photo = Image.new('RGB', (1000, 1400), (150, 130, 110))
        data = standard_photo(photo, background='white')
        output = Image.open(BytesIO(data))
        self.assertEqual(output.size, (600, 600))
        self.assertEqual(output.format, 'JPEG')
        self.assertEqual(tuple(round(n) for n in output.info['dpi']), (300, 300))

    def test_rejects_invalid_color(self):
        with self.assertRaises(ValueError):
            standard_photo(Image.new('RGB', (800, 800)), background='red')

    def test_accepts_formal_attire_overlay(self):
        photo = Image.new('RGB', (1000, 1400), (180, 170, 160))
        data = standard_photo(photo, background='white', attire='black_suit')
        output = Image.open(BytesIO(data))
        self.assertEqual(output.size, (600, 600))


if __name__ == '__main__':
    unittest.main()
