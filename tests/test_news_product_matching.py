import unittest

from services.news_product_matching import build_news_body_items, select_promotion_product


PRODUCTS = [
    {
        "id": 216,
        "sku": "ГВ-50С",
        "name": "Гриб Веселка, Панна (лат. Phallus impudicus) Сушений",
        "parent_sku": "ГВ-01С",
        "variant_name": "Гриб Веселка, Панна (лат. Phallus impudicus) сушений - 50 грам",
        "status": "available",
    },
    {
        "id": 215,
        "sku": "ГВ-100СП",
        "name": "Гриб Веселка, Панна (лат. Phallus impudicus) Сушений",
        "parent_sku": "ГВ-01С",
        "variant_name": "Гриб Веселка, Панна (лат. Phallus impudicus) сушений, порошок - 100 грам",
        "status": "available",
    },
    {
        "id": 50,
        "sku": "МХМКР-600525",
        "name": "Мухомор Королівський (Amaníta regális) Мікродозінг King 0,5грама",
        "parent_sku": "МХМКР-600525",
        "variant_name": "Мікродозінг King Мухомор Королівський (Amaníta regális) 60 капсул 0,5грама",
        "status": "available",
    },
    {
        "id": 53,
        "sku": "МХМКР-600524",
        "name": "Мухомор Королівський (Amaníta regális) Мікродозінг King 0,5грама",
        "parent_sku": "МХМКР-600525",
        "variant_name": "Мікродозінг King Мухомор Королівський (Amaníta regális) 60 капсул 0,5грама",
        "status": "out_of_stock",
    },
    {
        "id": 102,
        "sku": "МХМКР-10025",
        "name": "Мікродозінг King Мухомор Королівський (Amaníta regális) порошок в баночці 100 грамм",
        "parent_sku": "МХМКР-10025",
        "status": "available",
    },
    {
        "id": 69,
        "sku": "ЇМК-6005",
        "name": "Мікродозінг MIX Brain Booster Мікс їжовиків + міцелій 60 капсул по 0,5 грама",
        "parent_sku": "ЇМК-6005",
        "status": "available",
    },
    {
        "id": 71,
        "sku": "ЇПМ-015",
        "name": "Мікродозінг MIX Brain Booster Мікс їжовиків + міцелій 150 грам",
        "parent_sku": "ЇПМ-015",
        "status": "available",
    },
    {
        "id": 6,
        "sku": "ГЛ-600525",
        "name": "Гриб Лисичка в капсулах",
        "parent_sku": "ГЛ-6005",
        "variant_name": "Лисичка справжня (Cantharellus cibarius) Stop Паразит 60 капсул по 0,5 грама",
        "status": "available",
    },
    {
        "id": 90,
        "sku": "МХМXL-10025",
        "name": "Мухомор червоний Мікродозінг XL",
        "parent_sku": "МХМXL-10025",
        "variant_name": "Мікродозінг XL Мухомор червоний (Amanita muscaria) порошок в баночці 100 грам",
        "status": "available",
    },
    {
        "id": 91,
        "sku": "МХМСТ-6005",
        "name": "Мікродозінг Стандарт Мухомор червоний (Amanita muscaria) 60 капсул по 0,5 грама",
        "parent_sku": "МХМСТ-6005",
        "status": "available",
    },
    {
        "id": 100,
        "sku": "ЗОР-6005",
        "name": "Зоряний 5 в 1",
        "parent_sku": "ЗОР-6005",
        "status": "available",
    },
]


class NewsProductMatchingTests(unittest.TestCase):
    def test_matches_current_numbered_promotion_rows(self):
        lines_and_ids = [
            (
                "1. 26.06-05.07 Гриб Веселка, Панна (лат. Phallus impudicus) сушений, порошок - 100 грам",
                215,
            ),
            (
                "2. 06.07-12.07 Мікродозінг King Мухомор Королівський (Amaníta regális) 60 капсул 0,5грама",
                50,
            ),
            (
                "3. 13.07-19.07 Мікродозінг MIX Brain Booster Мікс їжовиків + міцелій 60 капсул по 0,5 грама",
                69,
            ),
            (
                "4. 20.07-26.07 Лисичка справжня (Cantharellus cibarius) Stop Паразит 60 капсул по 0,5 грама",
                6,
            ),
            (
                "5. 20.07-02.08 Мікродозінг XL Мухомор червоний (Amanita muscaria) порошок в баночці 100 грам",
                90,
            ),
        ]

        for line, expected_id in lines_and_ids:
            with self.subTest(line=line):
                product = select_promotion_product(line, PRODUCTS)
                self.assertIsNotNone(product)
                self.assertEqual(product["id"], expected_id)

    def test_supports_zorianyi_name_when_catalog_name_is_specific(self):
        product = select_promotion_product(
            "5. Зоряний 5 в 1 60 капсул по 0,5 грама",
            PRODUCTS,
        )
        self.assertEqual(product["id"], 100)

    def test_lysychka_never_falls_back_to_mukhomor(self):
        product = select_promotion_product(
            "4. Лисичка справжня (Cantharellus cibarius) Stop Паразит",
            [item for item in PRODUCTS if item["id"] in {90, 91}],
        )
        self.assertIsNone(product)

    def test_non_numbered_text_is_never_linked(self):
        product = select_promotion_product(PRODUCTS[3]["name"], PRODUCTS)
        self.assertIsNone(product)

    def test_equal_candidates_are_left_unlinked(self):
        duplicate = {
            **PRODUCTS[5],
            "id": 999,
            "sku": "OTHER-SKU",
            "parent_sku": "OTHER-SKU",
        }
        product = select_promotion_product(
            f"3. {PRODUCTS[5]['name']}",
            [PRODUCTS[5], duplicate],
        )
        self.assertIsNone(product)

    def test_equal_variants_in_same_group_prefer_available_product(self):
        product = select_promotion_product(
            f"2. {PRODUCTS[2]['variant_name']}",
            [PRODUCTS[2], PRODUCTS[3]],
        )
        self.assertEqual(product["id"], 50)

    def test_body_items_keep_plain_text_and_metadata(self):
        body = f"Вступ\n\n3. {PRODUCTS[5]['name']}"
        items = build_news_body_items(body, PRODUCTS)

        self.assertEqual(items[0]["text"], "Вступ")
        self.assertIsNone(items[0]["product_id"])
        self.assertEqual(items[1]["product_id"], 69)
        self.assertEqual(items[1]["product_sku"], "ЇМК-6005")


if __name__ == "__main__":
    unittest.main()
