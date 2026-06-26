# Horoshop banners synchronization

Last updated: 2026-06-26.

## Source of truth

- `dikoros-ua.com` is the source of truth for home and category banners.
- The backend reads the first server-rendered Horoshop `banners__slider` on the homepage and on discovered category pages.
- Synced rows use `source = horoshop`; legacy/manual rows are preserved separately.
- Repeated syncs update matching image rows and remove only stale Horoshop rows after a successful page parse, so they do not create duplicates or delete manual banners.
- The protected sync endpoint is `POST /api/admin/sync/horoshop-banners`.
- The existing hourly Horoshop catalog scheduler runs banner synchronization after a successful catalog sync.
- The admin banner section provides a “Синхронизировать баннеры с сайта” button and displays the sync report.

## Public APIs used by the app

- The public home banner API is `/banners`.
- The app intentionally keeps home hero banners controlled by `/banners` only.
- `/api/catalog/home` still provides categories, hits, promotions, and new products, but it must not overwrite the home hero banner state in the mobile app.
- Category API responses preserve the legacy `banners` URL list and add clickable `banner_items` metadata.

## Banner destination resolution

- `link_type` and `link_value` are derived from each Horoshop banner URL.
- Product destinations resolve to the local product ID using exact source/canonical URL matches, explicit product IDs, and SKU/article values.
- Product banner matching must not use fuzzy product-name guessing. This avoids opening a wrong product when a Horoshop URL contains generic words like `mix`, `kapsul`, `60`, or `05`.
- Category destinations resolve to the category name already supported by the mobile catalog route.
- Promotion URLs open the existing promotions screen.
- Recognized blog URLs open the existing blog detail screen.
- External URLs keep the safe external-link fallback.
- Unknown internal URLs return `link_type = none`; the mobile app can still use exact frontend fallback mappings for known SEO landing pages.

## SEO landing pages and category filters

Some Horoshop banner URLs are not product pages. They are SEO landing/filter pages that must open an internal catalog category with selected filters.

Backend `category_filter` mappings are kept in `services/horoshop_banners.py` via `SEO_FILTER_DESTINATIONS`.

Current exact SEO mappings:

| Horoshop slug | App destination |
| --- | --- |
| `hryb-chaha-u-mikrodozynhu` | `Мікродозінг` + raw material `Чага` |
| `mikrodozynh-kordytseps-viiskovyi` | `Мікродозінг` + raw material `Кордицепс військовий` |
| `mikrodozynh-mukhomor-chervonyi` | `Мікродозінг` + raw material `Мухомор червоний` |
| `mikrodozinh-yizhovyka-hrebinchastoho` | `Мікродозінг` + raw material `Їжовик гребінчастий` |
| `uvaha-zapuskaiemo-aktsiiu-hryb-misiatsia` | `Мікродозінг` + raw material `Лисичка` |
| `mikrodozinh/filter/Sirovyna=25` | `Мікродозінг` + raw material `Чага` |

The backend serializes these as:

```json
{"category":"Мікродозінг","raw_materials":["..."]}
```

The app parses `link_type = category_filter` and applies:

- selected category;
- raw material filters;
- package form filters when present;
- cleared search query;
- default popular sort;
- category view opened at the top.

## Mobile fallback for known SEO banner links

The mobile app also contains an exact allowlist fallback in `app/(tabs)/index.tsx`.

Reason: if `/banners` or an intermediate cache ever returns a known SEO landing URL with `link_type = none`, the app still opens the correct internal filtered category by `source_url`.

Current frontend allowlist mirrors the backend SEO mappings for:

- `hryb-chaha-u-mikrodozynhu` → `Чага`;
- `mikrodozynh-kordytseps-viiskovyi` → `Кордицепс військовий`;
- `mikrodozynh-mukhomor-chervonyi` → `Мухомор червоний`;
- `mikrodozinh-yizhovyka-hrebinchastoho` → `Їжовик гребінчастий`;
- `uvaha-zapuskaiemo-aktsiiu-hryb-misiatsia` → `Лисичка`.

This fallback is exact-slug only. Do not add fuzzy matching.

## Filter alias handling

The mobile catalog filter matcher normalizes raw-material labels and adds canonical options for:

- `Чага`;
- `Лисичка`;
- `Кордицепс військовий`;
- `Мухомор червоний`;
- `Їжовик гребінчастий`.

This is needed because product option labels can include noisy text such as package wording, prefixes, or suffixes.

## Cache handling in the app

The app invalidated stale banner/catalog-home caches after banner-link fixes:

- `cached_banners_v2` was replaced by `cached_banners_v3`.
- `cached_catalog_home_v5` was replaced by `cached_catalog_home_v6`.
- Old keys `cached_banners_v2` and `cached_catalog_home_v5` are removed on mount.
- The duplicate cached-banner mount effect was removed.
- `applyCatalogHomeData` no longer calls `setBanners(...)`, so `/api/catalog/home` cannot overwrite fresh hero banners from `/banners`.

## Verified fixes

- Home “товар недели” banner opens the exact product by exact URL/SKU/product ID resolution, not fuzzy matching.
- Category SEO banners open filtered `Мікродозінг` views for `Чага`, `Кордицепс військовий`, `Мухомор червоний`, and `Їжовик гребінчастий`.
- Home mushroom-month banner `uvaha-zapuskaiemo-aktsiiu-hryb-misiatsia` opens `Мікродозінг` filtered by `Лисичка`.
- A case was diagnosed where the app received `link_type = none` for the mushroom-month banner but still had a valid `source_url`; the frontend exact allowlist fallback fixed this.

## Operational checks

Check public banners:

```bash
curl -s https://app.dikoros.ua/banners | python3 -m json.tool
```

Check one banner in the database:

```bash
docker exec -i fastapi_app python - <<'PY'
from db import get_db_connection

conn = get_db_connection()
row = conn.execute("""
    SELECT id, source_url, link_type, link_value
    FROM banners
    WHERE id = 10
""").fetchone()

print(dict(row) if row else None)
PY
```

Check resolver directly:

```bash
docker exec -i fastapi_app python - <<'PY'
from db import get_db_connection
from services.horoshop_banners import resolve_banner_destination

conn = get_db_connection()
print(resolve_banner_destination(
    "https://dikoros-ua.com/uvaha-zapuskaiemo-aktsiiu-hryb-misiatsia/",
    conn,
    "https://dikoros-ua.com/"
))
PY
```

Expected result for the mushroom-month banner:

```json
{
  "link_type": "category_filter",
  "link_value": "{\"category\":\"Мікродозінг\",\"raw_materials\":[\"Лисичка\"]}",
  "source_url": "https://dikoros-ua.com/uvaha-zapuskaiemo-aktsiiu-hryb-misiatsia/"
}
```

## Deployment notes

- Backend banner resolver changes require pulling code on the server and restarting `fastapi_app`.
- Banner data changes require running `POST /api/admin/sync/horoshop-banners` or waiting for the hourly scheduler.
- Mobile JavaScript changes require pulling latest code and running the dev client or publishing an EAS Update/build, depending on the release path.
- A new Android binary build is not required for JS-only banner handling changes unless native dependencies or config change.

## Important maintenance note

If new banners are added on Horoshop:

- image/order/link data should appear in the app automatically after sync;
- normal product/category/blog/external links should work automatically;
- new SEO landing pages that represent filtered catalog views should be added to both backend `SEO_FILTER_DESTINATIONS` and the frontend exact SEO allowlist in `app/(tabs)/index.tsx`.
