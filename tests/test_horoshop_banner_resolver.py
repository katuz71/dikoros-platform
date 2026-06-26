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


class HoroshopBannerResolverTests(unittest.TestCase):
    def test_category_banner_seo_urls_resolve_to_category_filters(self):
        site_url = "https://dikoros-ua.com/"
        expected_filters = {
            "https://dikoros-ua.com/hryb-chaha-u-mikrodozynhu/": ["\u0427\u0430\u0433\u0430"],
            "https://dikoros-ua.com/mikrodozynh-kordytseps-viiskovyi/": [
                "\u041a\u043e\u0440\u0434\u0438\u0446\u0435\u043f\u0441 \u0432\u0456\u0439\u0441\u044c\u043a\u043e\u0432\u0438\u0439"
            ],
            "https://dikoros-ua.com/mikrodozynh-mukhomor-chervonyi/": [
                "\u041c\u0443\u0445\u043e\u043c\u043e\u0440 \u0447\u0435\u0440\u0432\u043e\u043d\u0438\u0439"
            ],
            "https://dikoros-ua.com/mikrodozinh-yizhovyka-hrebinchastoho/": [
                "\u0407\u0436\u043e\u0432\u0438\u043a \u0433\u0440\u0435\u0431\u0456\u043d\u0447\u0430\u0441\u0442\u0438\u0439"
            ],
            "https://dikoros-ua.com/mikrodozinh/filter/Sirovyna=25/": ["\u0427\u0430\u0433\u0430"],
        }
        conn = FakeConnection([])

        with mock.patch.object(horoshop_banners.urllib.request, "urlopen") as urlopen:
            for url, raw_materials in expected_filters.items():
                with self.subTest(url=url):
                    destination = horoshop_banners.resolve_banner_destination(url, conn, site_url)
                    payload = json.loads(destination["link_value"])

                    self.assertEqual(destination["link_type"], "category_filter")
                    self.assertEqual(payload["category"], "\u041c\u0456\u043a\u0440\u043e\u0434\u043e\u0437\u0456\u043d\u0433")
                    self.assertEqual(payload["raw_materials"], raw_materials)
                    self.assertEqual(destination["source_url"], url)
            urlopen.assert_not_called()

    def test_unknown_mikrodosing_filter_url_stays_none(self):
        destination = horoshop_banners.resolve_banner_destination(
            "https://dikoros-ua.com/mikrodozinh/filter/Sirovyna=999/",
            FakeConnection([]),
            "https://dikoros-ua.com/",
        )

        self.assertEqual(destination["link_type"], "none")
        self.assertEqual(destination["link_value"], "")


if __name__ == "__main__":
    unittest.main()
