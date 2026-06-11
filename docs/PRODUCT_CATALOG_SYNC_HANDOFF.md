# Product Catalog Sync Handoff

Last updated: 2026-06-11

This document is the source of truth for product/catalog behavior in the DikorosUA app. Future chats must read this file before changing product sync, catalog endpoints, product cards, categories, homepage sections, variants, images, prices, discounts, stock status, or Horoshop integration.

## Current production intent

The mobile app catalog must be a live clone of the website catalog as much as possible:

1. Horoshop / website catalog is the source of truth.
2. Product names, prices, old prices, discounts, descriptions, images, stock status, categories, SKU/article, variants, hits, new products, and promotions must come from Horoshop.
3. The app must not require manual product edits after normal website updates.
4. If the website catalog changes, the app catalog should update automatically through the backend sync.
5. Manual sync is available for immediate refresh.
6. Local app product IDs must be preserved where possible so orders/history do not break.
7. Products removed from Horoshop must not be deleted from DB; they must be hidden from the app by setting `status = 'out_of_stock'`.

## Important rules: do not break these

- Do **not** manually hardcode product cards in the app.
- Do **not** make the mobile app the product source of truth.
- Do **not** delete stale products from DB during sync; mark them `out_of_stock`.
- Do **not** show products with empty names, `Без назви`, missing/zero price, or `out_of_stock` status in normal catalog endpoints.
- Do **not** show duplicate variant cards on home/category carousels when they are the same product group.
- Do **not** treat new products as promotions only because they have an old price.
- Do **not** include heavy banner/base64 payloads inside `/api/catalog/home`; banners are loaded separately.
- Do **not** bypass Horoshop credentials/environment variables with hardcoded production credentials.
- Do **not** rewrite variant option logic without running a variant audit.

## Backend implementation

### Main files

- `services/catalog_sync.py`
- `services/catalog_scheduler.py`
- `services/variant_options.py`
- `routers/sync.py`
- `routers/catalog.py`
- `routers/products.py`
- `routers/categories.py`
- `services/products.py`

## Horoshop credentials

Catalog sync requires these environment variables on the backend server:

```bash
HOROSHOP_DOMAIN
HOROSHOP_LOGIN
HOROSHOP_PASSWORD
```

If any of them are missing, the hourly scheduler must not start.

## Automatic sync

`services/catalog_scheduler.py` runs a background sync thread when credentials are configured.

Current scheduler settings:

```text
Initial delay: 60 seconds after backend start
Interval: 60 * 60 seconds = hourly
Retry attempts: 3
Retry delay: 5 minutes
```

The scheduler calls `sync_catalog_from_horoshop()`.

## Manual sync

Manual refresh endpoint:

```http
POST /api/sync/catalog
```

This endpoint calls the same `sync_catalog_from_horoshop()` function used by the hourly scheduler.

Use this after changing products on the website when an immediate app refresh is needed.

Expected response shape:

```json
{
  "success": true,
  "count": 123,
  "stale_out_of_stock": 0,
  "home_sections": {
    "hit": 0,
    "new": 0,
    "promotion": 0
  },
  "message": "Synced products: 123; hidden stale products: 0"
}
```

## Horoshop export behavior

Sync authenticates against:

```text
https://<HOROSHOP_DOMAIN>/api/auth/
```

Then exports products from:

```text
https://<HOROSHOP_DOMAIN>/api/catalog/export/
```

Pagination settings:

```text
limit: 500
max pages: 100
```

If Horoshop returns an empty product list, sync must fail rather than wiping catalog state.

## Fields synced into `products`

The sync updates/inserts products by `sku`.

Synced fields include:

- `sku`
- `name`
- `price`
- `category`
- `status`
- `description`
- `image`
- `images`
- `parent_sku`
- `variant_name`
- `external_id`
- `variant_options`
- `is_hit`
- `is_promotion`
- `is_new`
- `old_price`
- `discount`
- `sort_order`

## Product status / stock rules

Default status is:

```text
available
```

If Horoshop `presence.id == 2`, product becomes:

```text
out_of_stock
```

Stale products that are no longer present in Horoshop export are hidden by setting:

```sql
status = 'out_of_stock',
is_hit = FALSE,
is_new = FALSE,
is_promotion = FALSE,
home_hit_order = NULL,
home_new_order = NULL,
home_promotion_order = NULL,
sort_order = NULL
```

This preserves historical order references and product IDs.

## Images

Horoshop image behavior:

- first Horoshop image becomes `products.image`;
- all Horoshop images are joined into `products.images`;
- the app must use backend image fields and must not hardcode product images locally.

## Prices, discounts, old price

- `price` comes from Horoshop `price`.
- `discount` comes from Horoshop `discount`.
- `old_price` comes from Horoshop `old_price`.
- If Horoshop sends a discount percentage but `old_price <= price`, backend reconstructs old price from discount:

```text
old_price = round(price / (1 - discount_percent / 100), 2)
```

## Hit / new / promotion logic

### Hit

A product is a hit when:

- Horoshop sends `hit == 1`; or
- product icons contain text like `хит` / `хіт`.

### New

A product is new when:

- Horoshop sends `new == 1`; or
- product icons contain text like `новинка` / `new`.

### Promotion

A product is promotion when:

```text
old_price > 0 AND old_price > price AND is_new == false
```

New products must not be forced into promotions just because they have an old price.

## Homepage sections

Homepage sections are parsed from the Horoshop homepage special offers blocks:

1. first special offers block -> `hit`;
2. second special offers block -> `new`;
3. third special offers block -> `promotion`.

The parser reads product refs by:

- `external_id` from product card `data-id`;
- SKU/article extracted from image alt/title when possible;
- fallback resolving product page href and reading `Артикул:` from HTML.

For homepage ordering, backend writes:

- `home_hit_order`
- `home_new_order`
- `home_promotion_order`

Promotion homepage section only accepts products where:

```text
old_price > price AND is_new == false
```

## Catalog API behavior

### `/api/catalog/home`

Returns:

```json
{
  "banners": [],
  "categories": [],
  "hits": [],
  "promotions": [],
  "new_products": []
}
```

Important:

- product sections are resolved from live Horoshop homepage refs when possible;
- DB fallback is used if live refs fail;
- `banners` intentionally stays empty here because banners are loaded separately by `/banners` to avoid large payloads blocking home products.

### `/api/catalog/hits`

Uses live Horoshop homepage `hit` refs first. Falls back to DB `home_hit_order` / `is_hit`.

### `/api/catalog/promotions`

Uses DB promotion fallback:

```text
is_promotion == true OR old_price > price
```

### `/api/catalog/new`

Uses DB products where `is_new == true`, ordered by `home_new_order`, `sort_order`, then newest ID.

### `/api/catalog/categories`

Returns distinct categories from visible products only.

## Product visibility filters

Normal catalog fetches must only show products where:

```sql
name IS NOT NULL
TRIM(name) != ''
LOWER(TRIM(name)) != 'без назви'
COALESCE(status, '') != 'out_of_stock'
price IS NOT NULL
price > 0
```

Do not remove these filters without a deliberate QA pass.

## Variant/card dedupe rules

Horoshop exports variants as separate SKUs. On app home/carousel screens, variants must not spam repeated cards.

Dedupe key priority:

1. product `name` + `category`;
2. `parent_sku`;
3. `sku` or product `id`.

This means app carousels show one product card per product group, while product details can still show variants/options.

## Variant options

`services/variant_options.py` builds structured variant options.

Supported option labels:

- `Фасування`
- `Вага`
- `Обʼєм`
- `Концентрація`
- `Смак`
- `Рік`
- `Формат`
- `Сорт`
- `Артикул`

Extraction sources:

- Horoshop `mod_title`;
- Horoshop `title`;
- `article` / SKU code patterns.

Rules:

- only options with more than one value in the group should be visible;
- additional uniqueness options may be added when needed;
- if options are still duplicate, `Артикул` is added as last uniqueness fallback;
- year can be inferred from article suffixes like `23`, `24`, `25`;
- format/sort/weight can be inferred from known Dikoros SKU patterns.

Known audit state before this handoff:

```text
partial option problems: 0
single-value option problems: 0
duplicate available option groups with different prices: 0
```

Do not rewrite this area without rerunning the variant audit.

## Product pages / categories in app

The app must consume backend catalog/product endpoints. It must not maintain a separate static product list.

Product cards should use backend fields:

- `id`
- `name`
- `price`
- `discount`
- `old_price`
- `image`
- `images`
- `category`
- `is_hit`
- `is_new`
- `is_promotion`
- `sku`
- `status`
- `parent_sku`
- `variant_name`
- `sort_order`
- `home_*_order`
- `variants` / `option_names` when needed

## Operational checks

### Manual sync check

Run from server or local against production backend:

```bash
curl -X POST https://app.dikoros.ua/api/sync/catalog
```

Expected:

```text
success: true
count > 0
```

### Home check

```bash
curl -s https://app.dikoros.ua/api/catalog/home
```

Verify response contains:

- `categories`
- `hits`
- `promotions`
- `new_products`

and products have real names/prices/images.

### Promotions check

```bash
curl -s https://app.dikoros.ua/api/catalog/promotions
```

Verify promotion products have `old_price > price`.

### Categories check

```bash
curl -s https://app.dikoros.ua/api/catalog/categories
```

Verify categories match visible Horoshop product categories.

## Production deployment checklist

After product sync/code changes:

```bash
cd /opt/dikoros-platform

git pull origin main
docker restart fastapi_app
sleep 10
docker logs fastapi_app --tail 120
```

Smoke:

```bash
curl -i https://app.dikoros.ua/health
curl -s https://app.dikoros.ua/api/catalog/home
curl -s https://app.dikoros.ua/api/catalog/categories
curl -s https://app.dikoros.ua/api/catalog/promotions
```

Then open the app and verify:

1. home products load;
2. product images load;
3. categories are current;
4. hits/new/promotions match the site/homepage logic;
5. product detail opens;
6. variants/options do not duplicate incorrectly;
7. unavailable products are not shown in normal catalog.

## Related handoff docs

- `docs/REFERRAL_CASHBACK_HANDOFF.md` for referral, registration bonus, and cashback.

If future work changes catalog behavior, update this document in the same PR/commit.
