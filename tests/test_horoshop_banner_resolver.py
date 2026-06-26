import json
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

catalog_sync_stub = types.ModuleType("services.catalog_sync")
catalog_sync_stub.HOROSHOP_PAGE_HEADERS = {
    "User-Agent": "banner-resolver-test",
    "Accept-Language": "uk-UA,uk;q=0.9,en;q=0.8",
}
sys.modules["services.catalog_sync"] = catalog_sync_stub

from services import horoshop_banners


class FakeResult:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None


class FakeConnection:
    def __init__(self, products):
        self.products = products

    def execute(self, sql, params=None):
        normalized_sql = " ".join(sql.split()).casefold()

        if "where external_id = ?" in normalized_sql:
            return FakeResult([])

        if "from information_schema.columns" in normalized_sql:
            return FakeResult(
                [
                    {"column_name": "site_url"},
                    {"column_name": "canonical_url"},
                    {"column_name": "source_url"},
                ]
            )

        if "select id, site_url, canonical_url, source_url" in normalized_sql:
            return FakeResult(
                [
                    {
                        "id": product["id"],
                        "site_url": "",
                        "canonical_url": "",
                        "source_url": "",
                    }
                    for product in self.products
                ]
            )

        if "select id, sku, parent_sku, variants" in normalized_sql:
            return FakeResult(self.products)

        if "select id, name, external_id from categories" in normalized_sql:
            return FakeResult([])

        if "select distinct category from products" in normalized_sql:
            return FakeResult([])

        raise AssertionError(f"Unexpected SQL: {sql}")


class FakeResponse:
    def __init__(self, html):
        self.html = html

    def read(self):
        return self.html.encode("utf-8")


class HoroshopBannerResolverTests(unittest.TestCase):
    def test_product_like_category_banner_urls_resolve_by_html_sku(self):
        site_url = "https://dikoros-ua.com/"
        html_by_url = {
            "https://dikoros-ua.com/hryb-chaha-u-mikrodozynhu/": (
                '<script type="application/ld+json">'
                '{"@type":"Product","sku":"SKU-CHAGA"}'
                "</script>"
            ),
            "https://dikoros-ua.com/mikrodozynh-kordytseps-viiskovyi/": (
                '<meta itemprop="sku" content="SKU-CORDYCEPS">'
            ),
            "https://dikoros-ua.com/mikrodozynh-mukhomor-chervonyi/": (
                '<span itemprop="sku">SKU-MUHOMOR</span>'
            ),
            "https://dikoros-ua.com/mikrodozinh-yizhovyka-hrebinchastoho/": (
                "<div>\u0410\u0440\u0442\u0438\u043a\u0443\u043b: SKU-YIZHOVYK</div>"
            ),
        }
        expected_ids = {
            "https://dikoros-ua.com/hryb-chaha-u-mikrodozynhu/": "101",
            "https://dikoros-ua.com/mikrodozynh-kordytseps-viiskovyi/": "102",
            "https://dikoros-ua.com/mikrodozynh-mukhomor-chervonyi/": "103",
            "https://dikoros-ua.com/mikrodozinh-yizhovyka-hrebinchastoho/": "104",
        }
        products = [
            {"id": 101, "sku": "SKU-CHAGA", "parent_sku": "", "variants": ""},
            {"id": 102, "sku": "SKU-CORDYCEPS-VARIANT", "parent_sku": "SKU-CORDYCEPS", "variants": ""},
            {"id": 103, "sku": "SKU-MUHOMOR", "parent_sku": "", "variants": ""},
            {
                "id": 104,
                "sku": "SKU-YIZHOVYK-PARENT",
                "parent_sku": "",
                "variants": json.dumps([{"sku": "SKU-YIZHOVYK"}]),
            },
        ]
        conn = FakeConnection(products)

        def fake_urlopen(request, timeout):
            self.assertGreaterEqual(timeout, 10)
            self.assertLessEqual(timeout, 15)
            headers = {key.casefold(): value for key, value in request.header_items()}
            self.assertEqual(headers.get("user-agent"), horoshop_banners.HOROSHOP_PAGE_HEADERS["User-Agent"])
            return FakeResponse(html_by_url[request.full_url])

        with mock.patch.object(horoshop_banners.urllib.request, "urlopen", fake_urlopen):
            for url, expected_id in expected_ids.items():
                with self.subTest(url=url):
                    destination = horoshop_banners.resolve_banner_destination(url, conn, site_url)

                    self.assertEqual(destination["link_type"], "product")
                    self.assertEqual(destination["link_value"], expected_id)
                    self.assertEqual(destination["source_url"], url)


if __name__ == "__main__":
    unittest.main()
