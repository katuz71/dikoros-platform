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

from services.horoshop_product_tabs import extract_product_tab_sections_from_html


class HoroshopProductTabsTests(unittest.TestCase):
    def test_extracts_page_level_product_note_group(self) -> None:
        html = """
        <div class="product__group product__group--tabs">
          <div class="product-heading__title">Примітка</div>
          <div class="product__section">
            <div class="text">
              Не є лікарським засобом.
              Перед застосуванням проконсультуйтеся зі спеціалістом.
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

        self.assertIn("Не є лікарським засобом.", sections["product_note"])
        self.assertIn("Перед застосуванням проконсультуйтеся зі спеціалістом.", sections["product_note"])
        self.assertNotIn("Звичайний опис", sections["product_note"])


if __name__ == "__main__":
    unittest.main()
