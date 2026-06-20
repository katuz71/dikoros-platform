import unittest

from services.variant_options import (
    OPTION_FORMAT,
    OPTION_SORT,
    OPTION_WEIGHT,
    OPTION_YEAR,
    _raw_variant_options,
    build_variant_options,
)


def _item(article: str, *, weight: int = 200, format_text: str = "сушені") -> dict:
    return {
        "article": article,
        "parent_article": "МХМЧ-01С",
        "title": {"ua": f"Мухомор червоний {format_text} {weight} г"},
    }


class VariantOptionsTests(unittest.TestCase):
    def test_article_powder_suffix_overrides_weak_dried_text(self) -> None:
        suffixes = [
            ("СП", "С"),
            ("ЕСП", "ЕС"),
            ("СМ", "С"),
            ("ЕСМ", "ЕС"),
            ("ЛСП", "ЛС"),
            ("ЛСМ", "ЛС"),
        ]

        for powder_suffix, whole_suffix in suffixes:
            with self.subTest(powder_suffix=powder_suffix):
                target = _item(f"МХМЧ-200{powder_suffix}")
                whole = _item(f"МХМЧ-200{whole_suffix}")
                options = build_variant_options(target, [target, whole])

                self.assertEqual(options[OPTION_FORMAT], "порошок")

    def test_explicit_text_format_has_priority(self) -> None:
        cases = [
            ("МХМЧ-200ЕСП", "сушені капсули", "капсули"),
            ("МХМЧ-200ЕС", "сушені порошок", "порошок"),
            ("МХМЧ-200ЕСП", "сушені мелені", "мелені"),
            ("МХМЧ-200ЕСП", "сушені шоколад", "шоколад"),
            ("МХМЧ-200ЕСП", "сушені набір", "набір"),
            ("МХМЧ-200ЕСП", "сушені приправа", "приправа"),
        ]

        for article, format_text, expected in cases:
            with self.subTest(format_text=format_text):
                options = _raw_variant_options(_item(article, format_text=format_text))
                self.assertEqual(options[OPTION_FORMAT], expected)

    def test_expected_options_without_year_suffix(self) -> None:
        whole = _item("МХМЧ-200ЕС")
        powder = _item("МХМЧ-200ЕСП")
        first_sort = _item("МХМЧ-100С", weight=100)
        group = [whole, powder, first_sort]

        self.assertEqual(
            build_variant_options(whole, group),
            {
                OPTION_WEIGHT: "200 г",
                OPTION_FORMAT: "цілі",
                OPTION_SORT: "Еліт",
            },
        )
        self.assertEqual(
            build_variant_options(powder, group),
            {
                OPTION_WEIGHT: "200 г",
                OPTION_FORMAT: "порошок",
                OPTION_SORT: "Еліт",
            },
        )

    def test_expected_options_with_year_suffix(self) -> None:
        whole = _item("МХМЧ-200ЕС24")
        powder = _item("МХМЧ-200ЕСП24")
        previous_year = _item("МХМЧ-100С23", weight=100)
        group = [whole, powder, previous_year]

        self.assertEqual(
            build_variant_options(whole, group),
            {
                OPTION_WEIGHT: "200 г",
                OPTION_YEAR: "2024",
                OPTION_FORMAT: "цілі",
                OPTION_SORT: "Еліт",
            },
        )
        self.assertEqual(
            build_variant_options(powder, group),
            {
                OPTION_WEIGHT: "200 г",
                OPTION_YEAR: "2024",
                OPTION_FORMAT: "порошок",
                OPTION_SORT: "Еліт",
            },
        )


if __name__ == "__main__":
    unittest.main()
