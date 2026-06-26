import sys
import types
import unittest


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
from services.horoshop_product_tabs import extract_product_tab_sections_from_html


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


if __name__ == "__main__":
    unittest.main()
