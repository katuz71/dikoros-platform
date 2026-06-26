import asyncio
import sys
import types
import unittest
from unittest import mock


db_stub = types.ModuleType("db")
db_stub.get_db_connection = lambda: None
sys.modules["db"] = db_stub

httpx_stub = types.ModuleType("httpx")
httpx_stub.AsyncClient = object
httpx_stub.HTTPError = Exception
sys.modules["httpx"] = httpx_stub

fastapi_stub = types.ModuleType("fastapi")
fastapi_stub.HTTPException = Exception
sys.modules["fastapi"] = fastapi_stub

import services.horoshop_product_tabs as horoshop_product_tabs
from services.horoshop_product_tabs import extract_product_tab_sections_from_html


LEGAL_NOTE_SENTENCE = "Даний товар не є лікарським засобом, не містить заборонених наркотичних та психотропних речовин та є легальним на території України."
REAL_NOTE_WITH_EXTRA_LINES = f"Врожай 2025р.\n{LEGAL_NOTE_SENTENCE} Не перевищувати рекомендованих дозувань."
REAL_NOTE_WITHOUT_DOSAGE = f"Врожай 2025р.\n{LEGAL_NOTE_SENTENCE}"
REAL_NOTE_WITH_DOSAGE = f"{LEGAL_NOTE_SENTENCE} Не перевищувати рекомендованих дозувань."


class FakeResponse:
    def __init__(self, url: str, text: str, status_code: int = 200):
        self.url = url
        self.text = text
        self.status_code = status_code


class FakeClient:
    def __init__(self, responses: dict[str, FakeResponse]):
        self.responses = responses

    async def get(self, url: str, **_kwargs) -> FakeResponse:
        return self.responses[url]


class HoroshopProductTabsTests(unittest.TestCase):
    def test_extracts_page_level_product_note_group(self) -> None:
        html = """
        <div class="product__group product__group--tabs">
          <div class="product-heading__title">Примітка</div>
          <div class="product__section">
            <div class="text">
              Врожай 2025р.
              Даний товар не є лікарським засобом, не містить заборонених наркотичних та психотропних речовин та є легальним на території України. Не перевищувати рекомендованих дозувань.
            </div>
          </div>
        </div>
        <div class="product__group product__group--tabs">
          <div class="product-heading__title">Опис</div>
          <div class="product__section">
            <div class="text">Звичайний опис товару не має бути приміткою.</div>
          </div>
        </div>
        """

        sections = extract_product_tab_sections_from_html(html)

        self.assertEqual(sections["product_note"], REAL_NOTE_WITH_EXTRA_LINES)
        self.assertIn("Врожай 2025р.", sections["product_note"])
        self.assertIn("Не перевищувати рекомендованих дозувань.", sections["product_note"])
        self.assertIn(LEGAL_NOTE_SENTENCE, sections["product_note"])
        self.assertNotIn("Звичайний опис", sections["product_note"])

    def test_preserves_page_and_tab_product_note_text(self) -> None:
        html = """
        <div class="product__group product__group--tabs">
          <div class="product-heading__title">Примітка</div>
          <div class="product__section">
            <div class="text">
              Врожай 2025р.
              Даний товар не є лікарським засобом, не містить заборонених наркотичних та психотропних речовин та є легальним на території України.
            </div>
          </div>
        </div>
        <div class="j-product-block__tab" data-content-id="note">
          <p>Примітка:</p>
          <p>Даний товар не є лікарським засобом, не містить заборонених наркотичних та психотропних речовин та є легальним на території України. Не перевищувати рекомендованих дозувань.</p>
        </div>
        """

        sections = extract_product_tab_sections_from_html(html)

        expected = f"{REAL_NOTE_WITHOUT_DOSAGE}\n{REAL_NOTE_WITH_DOSAGE}"
        self.assertEqual(sections["product_note"], expected)
        self.assertIn("Врожай 2025р.", sections["product_note"])
        self.assertIn("Не перевищувати рекомендованих дозувань.", sections["product_note"])
        self.assertEqual(sections["product_note"].count(LEGAL_NOTE_SENTENCE), 2)

    def test_fetch_group_sections_keeps_checking_urls_until_product_note(self) -> None:
        first_url = "https://example.test/first/"
        second_url = "https://example.test/second/"
        first_html = """
        <div class="j-product-block__tab" data-content-id="opis">
          <p>Опис</p>
          <p>Опис товару з першого URL.</p>
        </div>
        """
        second_html = """
        <div class="product__group product__group--tabs">
          <div class="product-heading__title">Примітка</div>
          <div class="product__section">
            <div class="text">
              Даний товар не є лікарським засобом, не містить заборонених наркотичних та психотропних речовин та є легальним на території України.
            </div>
          </div>
        </div>
        """
        client = FakeClient(
            {
                first_url: FakeResponse(first_url, first_html),
                second_url: FakeResponse(second_url, second_html),
            }
        )

        with mock.patch.object(
            horoshop_product_tabs,
            "product_url_candidates",
            return_value=[first_url, second_url],
        ):
            result = asyncio.run(
                horoshop_product_tabs._fetch_group_sections(
                    client,
                    "example.test",
                    "ГВ-6005",
                    [{"article": "ГВ-1205", "parent_article": "ГВ-6005"}],
                )
            )

        self.assertIn("Опис товару з першого URL.", result["sections"]["description"])
        self.assertEqual(result["sections"]["product_note"], LEGAL_NOTE_SENTENCE)

    def test_fetch_group_sections_uses_url_candidates_from_all_group_items(self) -> None:
        first_url = "https://example.test/first/"
        second_url = "https://example.test/second/"
        first_html = ""
        second_html = """
        <div class="j-product-block__tab" data-content-id="opis">
          <p>Опис</p>
          <p>Опис товару з другого варіанта групи.</p>
        </div>
        """
        client = FakeClient(
            {
                first_url: FakeResponse(first_url, first_html),
                second_url: FakeResponse(second_url, second_html),
            }
        )

        def fake_url_candidates(item: dict, _domain: str) -> list[str]:
            if item.get("article") == "SKU-1":
                return [first_url]
            return [second_url]

        with mock.patch.object(
            horoshop_product_tabs,
            "product_url_candidates",
            side_effect=fake_url_candidates,
        ):
            result = asyncio.run(
                horoshop_product_tabs._fetch_group_sections(
                    client,
                    "example.test",
                    "PARENT",
                    [
                        {"article": "SKU-1", "parent_article": "PARENT"},
                        {"article": "SKU-2", "parent_article": "PARENT"},
                    ],
                )
            )

        self.assertIn("Опис товару з другого варіанта групи.", result["sections"]["description"])


if __name__ == "__main__":
    unittest.main()
