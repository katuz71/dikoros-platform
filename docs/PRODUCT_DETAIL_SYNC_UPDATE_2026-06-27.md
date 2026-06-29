# Product Detail Sync Update — 2026-06-27

## Summary

This document records the completed backend/catalog sync fixes for product detail fields in the Dikoros mobile app.

The main goal was to make the app receive correct product detail content from Horoshop/site data instead of relying on hardcoded frontend logic or manual database edits.

Final production result:

```text
active_without_description = 0
```

All active products now have `description` populated in the production `products` table.

## Source of truth

The source of truth remains Horoshop / the website catalog.

Data flow:

```text
Horoshop / website → backend catalog sync → PostgreSQL products table → FastAPI API → mobile app
```

Manual database edits must not be used as the primary fix. Product data should be corrected through sync logic.

## What was fixed

### 1. Product page section parsing

The product page parser was extended to read Horoshop product detail blocks rendered as `product__group` sections, not only old tab structures.

This fixed cases where Horoshop showed sections like:

- `Опис`
- `Примітка`
- `Спосіб застосування`
- `Склад`

but the app backend did not import them correctly.

### 2. Separate product detail fields

The backend now keeps product detail content in separate fields:

```text
description
product_note
usage
composition
delivery_info
return_info
```

Important behavior:

- `description` stores the real Horoshop `Опис` content.
- `product_note` stores the real Horoshop `Примітка` content.
- `usage` stores instruction/application content when it exists.
- `composition` stores composition content when it exists.
- `description` is not copied into `usage` or `composition`.
- Empty `usage` / `composition` must remain empty so the frontend can hide that section.

### 3. Product note normalization was corrected

Earlier behavior incorrectly normalized many product notes into one shared legal sentence.

That was fixed. `product_note` now stores the real factual Horoshop `Примітка` per product.

Important rule:

```text
Product-specific note lines, including harvest/year lines, are preserved.
```

The request to remove harvest year lines was cancelled, so no harvest/year cleanup was added.

### 4. Sync no longer wipes parsed content with empty export fields

A production issue was found where `catalog_sync.py` could overwrite already parsed page content with empty export values.

Fixed with safe SQL updates:

```sql
description = COALESCE(NULLIF(?, ''), description)
product_note = COALESCE(NULLIF(?, ''), product_note)
usage = COALESCE(NULLIF(?, ''), usage)
composition = COALESCE(NULLIF(?, ''), composition)
```

This prevents empty Horoshop export/page values from deleting previously parsed useful text.

### 5. Export fallback was added for products without `site_url`

Three active products had no `site_url`, `source_url`, or `canonical_url`, so the page parser could not fetch their product pages:

```text
93  ККМ-6005
94  ККМ-1205
95  KKП-100П
```

Raw Horoshop export still contained useful fields for them, so fallback extraction was added directly from export fields:

```text
description.ua → description
characteristics.primtka.ua → product_note
characteristics.nstrukcjaMkrodozing.ua → usage
characteristics.sklad.ua → composition
```

The extractor now supports locale fallback:

```text
ua → uk → ru → en → default
```

Recognized export aliases include:

```text
primtka / prymitka → product_note
nstrukcjaMkrodozing → usage
sklad → composition
```

### 6. Long Horoshop HTML descriptions are handled correctly

One product had a valid export description, but the raw HTML was larger than `30000` characters because of bloated inline styles.

The old sanitizer rejected it before HTML cleanup.

Fixed behavior:

1. Get localized raw export description.
2. Convert HTML to plain text.
3. Run sanitizer/page-dump checks on the cleaned text, not raw HTML.

This fixed product `95 / KKП-100П`, whose description was previously empty after sync.

## Production verification

After deploy and manual sync, the following checks passed.

### All active products have description

```sql
SELECT COUNT(*) AS active_without_description
FROM products
WHERE COALESCE(status,'') != 'out_of_stock'
  AND NULLIF(TRIM(COALESCE(description,'')), '') IS NULL;
```

Result:

```text
active_without_description
0
```

### Product `270` verification

Product:

```text
id: 270
sku: МХМЧ-52С
```

API fields:

```text
description: populated
product_note: populated
usage: empty
composition: empty
```

Expected mobile behavior after frontend update:

```text
Примітка — show
Опис — show
Спосіб застосування та протипоказання — hide when usage/composition are empty
```

### Products without URL verification

After export fallback fixes:

```text
93: desc_len=1231, note_len=132, usage_len=964
94: desc_len=1231, note_len=132, usage_len=964
95: desc_len=1298, note_len=132, usage_len=1030, composition_len=97
```

## Key commits

```text
9ada4a2 Parse product description sections
d002595 Preserve parsed product text on empty sync
5d5b7ce Extract product detail fields from Horoshop export
ff59ff7 Sanitize export description after HTML cleanup
```

## Manual sync command

Use this on production when immediate refresh from Horoshop/site is needed:

```bash
ADMIN_KEY="$(docker exec fastapi_app printenv ADMIN_API_KEY)" && \
  curl -sS -X POST http://localhost:8000/api/sync/catalog \
  -H "X-Admin-Key: $ADMIN_KEY" && echo
```

## Verification commands

Check products with missing descriptions:

```bash
docker exec -e PAGER=cat -it postgres_db psql -U postgres -d app_db -A -F " | " -c "SELECT COUNT(*) AS active_without_description FROM products WHERE COALESCE(status,'') != 'out_of_stock' AND NULLIF(TRIM(COALESCE(description,'')), '') IS NULL;"
```

Check specific products:

```bash
docker exec -e PAGER=cat -it postgres_db psql -U postgres -d app_db -A -F " | " -c "SELECT id, sku, LENGTH(COALESCE(description,'')) AS desc_len, LENGTH(COALESCE(product_note,'')) AS note_len, LENGTH(COALESCE(usage,'')) AS usage_len, LENGTH(COALESCE(composition,'')) AS composition_len FROM products WHERE id IN (93,94,95,270) ORDER BY id;"
```

Check API payload for a product:

```bash
curl -s "http://127.0.0.1:8000/products/270" | python3 -m json.tool | grep -E '"id"|"sku"|"description"|"product_note"|"usage"|"composition"'
```

## Frontend status

Backend/catalog sync is complete.

A separate frontend build/OTA is still needed so installed mobile apps use the updated UI logic:

- show `Опис` separately;
- show `Примітка` separately;
- hide `Спосіб застосування та протипоказання` when there is no real `usage`/`composition` content;
- avoid duplicating `description` into other blocks.

Content changes on Horoshop/site will reach the app after backend sync. UI/layout logic still requires frontend update/build.
