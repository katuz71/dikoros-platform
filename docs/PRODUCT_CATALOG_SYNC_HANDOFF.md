# Product Catalog Sync Handoff

> [!IMPORTANT]
> Every new chat working on `dikoros-platform` must begin by reading this document in full. This is mandatory before any product, catalog, sync, product API, frontend variant, price, stock, category, image, or Horoshop work. Do not work from memory or from an older chat summary.

Last updated: 2026-06-26

This document is the source of truth for product/catalog behavior in the DikorosUA app. Future chats must read this file before changing product sync, catalog endpoints, product cards, categories, homepage sections, variants, images, prices, discounts, stock status, or Horoshop integration.

## Mandatory start protocol for every new chat

Every new chat must follow this protocol before product/catalog/sync/frontend variant work:

1. Read `docs/PRODUCT_CATALOG_SYNC_HANDOFF.md` completely before inspecting or changing code.
2. Do not rely on memory, a previous conversation, or assumptions about production state.
3. Confirm the repository and working tree state with Git before making changes.
4. Inspect the current implementation in the relevant frontend, backend, sync, and test files.
5. Preserve Horoshop as the catalog source of truth and preserve the backend API as the mobile app's catalog interface.
6. Never replace the sync flow with hardcoded frontend product data or manual database edits as the primary fix.
7. After changing catalog or variant generation behavior, run the relevant audits/tests and update this handoff in the same commit when behavior or operations change.

Rule to repeat in every handoff: **new chats must read this document first before product, catalog, sync, or frontend variant work.**

## Project map / production context

| Context | Value |
| --- | --- |
| GitHub repository | `katuz71/dikoros-platform` |
| Local Windows path | `C:\Work\dikoros-platform` |
| Production server path | `/opt/dikoros-platform` |
| Backend framework | FastAPI |
| Backend Docker container | `fastapi_app` |
| Production database | PostgreSQL in Docker |
| PostgreSQL Docker container | `postgres_db` |
| Production database name | `app_db` |
| Catalog table | `products` |
| Mobile application | Expo / React Native |

Project data flow:

1. The website/Horoshop catalog is the source of truth for products, variants, prices, images, categories, and stock.
2. The FastAPI backend sync reads the Horoshop catalog and normalizes it into PostgreSQL.
3. Synced catalog rows are stored in the production database `app_db`, primarily in the `products` table.
4. PostgreSQL runs in `postgres_db`; the FastAPI backend runs in `fastapi_app`.
5. The Expo / React Native mobile app reads the catalog through backend API endpoints.
6. The mobile app must not maintain or treat a local/static product list as authoritative catalog data.

## Current production intent

The mobile app catalog must be a live clone of the website catalog as much as possible:

1. Horoshop / website catalog is the source of truth.
2. Product names, prices, old prices, discounts, descriptions, product notes, images, stock status, categories, SKU/article, variants, hits, new products, and promotions must come from Horoshop.
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

The route is protected by the admin guard. From the production server, call it with `X-Admin-Key` from the backend container environment:

```bash
ADMIN_KEY="$(docker exec fastapi_app printenv ADMIN_API_KEY)" && \
  curl -s -X POST http://localhost:8000/api/sync/catalog \
    -H "X-Admin-Key: $ADMIN_KEY" | python3 -m json.tool
```

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
- `product_note`
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

## Product note / mobile overview

The mobile product detail card `Огляд продукту` must show only the website/Horoshop `Примітка` text stored in `products.product_note`.

Rules:

- `products.description` remains available for the existing product information modal rows and long tab content.
- `products.product_note` is synced separately from explicit Horoshop note fields and product page tabs/sections labeled `Примітка`.
- If `product_note` is empty, the mobile fallback text is `Примітка буде оновлена найближчим часом.`
- Do not rebuild the overview card from generated descriptions or from the old `Коротко про товар` / `Детальніше` split.

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
- format/sort/weight can be inferred from known Dikoros SKU patterns;
- explicit text formats such as `порошок`, `мелені`, `капсули`, `шоколад`, `набір`, and `приправа` must be preserved;
- the word `сушені` is a weak format signal only: it may produce `Формат = цілі`, but a stronger article/SKU suffix must override it when the suffix clearly identifies another format.

### SKU format precedence fix: 2026-06-20

Bug fixed in commit `b82036f0f36ad179907b108ea3bbf5695e40d7e3` (`Fix variant format inference from SKU`).

Observed production issue:

- products with SKU suffixes like `ЕСП` were exported with titles containing `сушені`;
- `_extract_format(text)` interpreted `сушені` as `Формат = цілі`;
- `_infer_format_from_article()` was not allowed to override the already-filled format;
- frontend then correctly treated combinations such as `200 г + порошок + Еліт` as unavailable because backend had emitted no matching `variant_options` row.

Current required behavior:

- `_raw_variant_options()` checks the article/SKU with `allow_group_default=True`;
- article/SKU inference overrides only the weak `сушені -> цілі` result;
- explicit format words from text still win and must not be overwritten;
- suffixes `СП`, `ЕСП`, `СМ`, `ЕСМ`, `ЛСП`, `ЛСМ` infer `Формат = порошок`;
- suffixes `С`, `ЕС`, `ЛС`, `СЛ` infer `Формат = цілі`, subject to the existing special-case logic.

Regression examples that must remain correct:

```text
МХМЧ-200ЕС    -> Вага: 200 г, Формат: цілі,    Сорт: Еліт
МХМЧ-200ЕСП   -> Вага: 200 г, Формат: порошок, Сорт: Еліт
МХМЧ-200ЕС24  -> Вага: 200 г, Формат: цілі,    Сорт: Еліт, Рік: 2024
МХМЧ-200ЕСП24 -> Вага: 200 г, Формат: порошок, Сорт: Еліт, Рік: 2024
```

Tests added/updated:

- `tests/test_variant_options.py` covers the fixed examples and all six powder-like suffixes.
- `python -m compileall services/variant_options.py services/catalog_sync.py` passed.
- Local `pytest` may be unavailable in a minimal environment; run it where dependencies are installed.

Production remediation performed after deployment:

```bash
ADMIN_KEY="$(docker exec fastapi_app printenv ADMIN_API_KEY)" && \
  curl -s -X POST http://localhost:8000/api/sync/catalog \
    -H "X-Admin-Key: $ADMIN_KEY" | python3 -m json.tool
```

Result:

```text
success: true
count: 507
stale_out_of_stock: 1
home_sections.hit: 8
home_sections.new: 16
home_sections.promotion: 0
```

Verification commands:

```bash
docker exec -e PAGER=cat -it postgres_db psql -U postgres -d app_db -A -F " | " -c "SELECT id, sku, variant_options FROM products WHERE id IN (285,313) ORDER BY id;"
```

Expected/current result:

```text
285 | МХМЧ-200ЕСП   | ... "Формат": "порошок" ...
313 | МХМЧ-200ЕСП24 | ... "Формат": "порошок" ...
```

```bash
docker exec -e PAGER=cat -it postgres_db psql -U postgres -d app_db -A -F " | " -c "SELECT id, sku, variant_options FROM products WHERE sku ILIKE '%СП%' AND variant_options ILIKE '%цілі%' ORDER BY id;"
```

Expected/current result:

```text
(0 rows)
```

```bash
curl -s http://localhost:8000/products/284 | python3 -c "import sys,json; d=json.load(sys.stdin); [print(v.get('id'), v.get('sku'), v.get('options')) for v in d.get('variants', []) if str(v.get('sku','')).startswith('МХМЧ-200')]"
```

Expected/current key rows:

```text
284 МХМЧ-200ЕС    {'Вага': '200 г', 'Формат': 'цілі', 'Сорт': 'Еліт', ...}
285 МХМЧ-200ЕСП   {'Вага': '200 г', 'Формат': 'порошок', 'Сорт': 'Еліт', ...}
312 МХМЧ-200ЕС24  {'Вага': '200 г', 'Формат': 'цілі', 'Сорт': 'Еліт', ...}
313 МХМЧ-200ЕСП24 {'Вага': '200 г', 'Формат': 'порошок', 'Сорт': 'Еліт', ...}
```

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

Run from the production server:

```bash
ADMIN_KEY="$(docker exec fastapi_app printenv ADMIN_API_KEY)" && \
  curl -s -X POST http://localhost:8000/api/sync/catalog \
    -H "X-Admin-Key: $ADMIN_KEY" | python3 -m json.tool
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

## Catalog visibility exclusions: 2026-06-20

Horoshop export can include products that are not visible in the storefront/menu.

Current required sync behavior:

- `presence.id == 2` -> `status = 'out_of_stock'`
- `display_in_showcase = 0` -> `status = 'out_of_stock'`
- category `Харчові добавки` -> `status = 'out_of_stock'`

Reason: the mobile app catalog must mirror the visible Horoshop storefront, not every technically exported Horoshop product.


## Mobile category filters

The category screen in `app/(tabs)/index.tsx` exposes frontend filters for:

- `Сировина`;
- `Ціна`;
- `Форма упаковки`;
- availability and promotions.

Filter options are derived from the synced Horoshop/backend product payload already loaded through `/products?limit=500`. They must not hardcode product cards or replace Horoshop/backend as the catalog source of truth.

`Сировина` is inferred from structured variant options when available and then from category/name text. `Форма упаковки` is inferred from structured variant options such as `Формат` / `Форма` and from normalized product text markers such as capsules, powder, whole, tincture, ointment, tea, set, chocolate, honey, conservation, or seasoning. Price filtering uses the existing catalog card price logic.
