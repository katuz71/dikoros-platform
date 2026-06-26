# Product Note / Mobile Overview Update — 2026-06-26

This document records the completed `product_note` work for the Dikoros mobile product detail page.

## Goal

On the mobile product detail screen, the card `Огляд продукту` must not show generated/long product description blocks.

The card must show only:

```text
Примітка

Даний товар не є лікарським засобом, не містить заборонених наркотичних та психотропних речовин та є легальним на території України.
```

Removed from this card:

- `Коротко про товар`
- `Детальніше`
- long product description text
- `Врожай 2025р.`
- `Не перевищувати рекомендованих дозувань.`
- duplicated legal note text

## Backend / database changes

Updated product storage and API flow:

- Added `products.product_note` to the database schema and migrations.
- Added `product_note` to product schemas.
- Added `product_note` to product API select fields so `/products` and `/products/{id}` can return it.
- Kept `products.description` for existing description/information modal content.
- Kept `usage`, `composition`, `delivery_info`, and `return_info` behavior unchanged.

## Horoshop sync behavior

Updated sync logic so `product_note` is not derived from generic descriptions.

Current behavior:

- `product_note` is extracted only from explicit note content.
- Horoshop/page text is normalized to the single canonical legal sentence:

```text
Даний товар не є лікарським засобом, не містить заборонених наркотичних та психотропних речовин та є легальним на території України.
```

- If no legal note markers are found, `product_note` is saved as empty.
- Sync overwrites old/bad `product_note` values instead of preserving them.
- The parser handles page-level HTML blocks like:

```html
<div class="product__group product__group--tabs">
  <div class="product-heading__title">Примітка</div>
  <div class="product__section">
    <div class="text">...</div>
  </div>
</div>
```

- The parser also continues checking URL candidates until a `product_note` is found, instead of stopping on the first URL that only has description sections.
- Final combined note text is normalized again to prevent duplicate legal note output.

## Frontend changes

Updated mobile product detail behavior:

- `components/ProductDetailsView.tsx` renders `Огляд продукту` with only the heading `Примітка` and `product.product_note` / `product.productNote`.
- The old `Коротко про товар`, `Детальніше`, and expand/collapse logic were removed from this card.
- `app/product/[id].tsx` preserves `product_note` from detail API data when merging with product list data from `useOrders()`.
- Detail fetch uses a cache buster and no-cache headers to avoid stale product payloads.
- Temporary debug log added during verification:

```ts
console.log('PRODUCT DETAIL NOTE', productId, detailProductNote);
```

Remove this debug log later if it becomes noisy.

## Tests / checks performed

Local checks reported passing during the work:

```bash
py_compile services/horoshop_product_tabs.py services/catalog_sync.py
python -m unittest tests.test_horoshop_product_tabs
npx.cmd tsc --noEmit
git diff --check
rg "РЎ|РІ|Рџ"
```

## Production verification

Production sync was run through:

```bash
ADMIN_KEY=$(docker exec fastapi_app printenv ADMIN_API_KEY)

curl -X POST http://127.0.0.1:8000/api/sync/catalog \
  -H "X-Admin-Key: $ADMIN_KEY"
```

Verified API output for product `id=3`:

```bash
curl -s http://127.0.0.1:8000/products/3 | grep -o '"product_note":"[^"]*"'
```

Expected/current result:

```json
"product_note":"Даний товар не є лікарським засобом, не містить заборонених наркотичних та психотропних речовин та є легальним на території України."
```

Database verification:

```sql
SELECT COUNT(*) FILTER (
  WHERE product_note = 'Даний товар не є лікарським засобом, не містить заборонених наркотичних та психотропних речовин та є легальним на території України.'
) AS clean_notes
FROM products;
```

Observed production result:

```text
clean_notes = 381
```

Mobile app verification completed: `Примітка` is visible in the product detail overview card.

## Related files

- `services/db_schema.py`
- `db.py`
- `services/catalog_sync.py`
- `services/horoshop_product_tabs.py`
- `routers/products.py`
- `models/schemas.py`
- `components/ProductDetailsView.tsx`
- `app/product/[id].tsx`
- `context/OrdersContext.tsx`
- `tests/test_horoshop_product_tabs.py`
- `docs/PRODUCT_CATALOG_SYNC_HANDOFF.md`
