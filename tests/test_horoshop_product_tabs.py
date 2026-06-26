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

from services.catalog_sync import LEGAL_PRODUCT_NOTE_TEXT
import services.horoshop_product_tabs as horoshop_product_tabs
from services.horoshop_product_tabs import extract_product_tab_sections_from_html


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

        self.assertEqual(sections["product_note"], LEGAL_PRODUCT_NOTE_TEXT)
        self.assertNotIn("Врожай", sections["product_note"])
        self.assertNotIn("Не перевищувати", sections["product_note"])
        self.assertNotIn("Звичайний опис", sections["product_note"])

    def test_deduplicates_page_and_tab_product_notes(self) -> None:
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

        self.assertEqual(sections["product_note"], LEGAL_PRODUCT_NOTE_TEXT)
        self.assertEqual(sections["product_note"].count(LEGAL_PRODUCT_NOTE_TEXT), 1)
        self.assertNotIn("Врожай", sections["product_note"])
        self.assertNotIn("Не перевищувати", sections["product_note"])

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
        self.assertEqual(result["sections"]["product_note"], LEGAL_PRODUCT_NOTE_TEXT)


if __name__ == "__main__":
    unittest.main()
