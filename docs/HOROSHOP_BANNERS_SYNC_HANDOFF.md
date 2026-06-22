# Horoshop banners synchronization

- `dikoros-ua.com` is the source of truth for home and category banners.
- The backend reads the first server-rendered Horoshop `banners__slider` on the homepage and on discovered category pages.
- Synced rows use `source = horoshop`; legacy/manual rows are preserved separately.
- Repeated syncs update matching image rows and remove only stale Horoshop rows after a successful page parse, so they do not create duplicates or delete manual banners.
- `link_type` and `link_value` are derived from each Horoshop banner URL.
- Product destinations resolve to the local product ID using Horoshop external IDs, SKU, and normalized product names.
- Category destinations resolve to the category name already supported by the mobile catalog route.
- Promotion URLs open the existing promotions screen, recognized blog URLs open the existing blog detail screen, and other URLs use the safe external-link fallback.
- The protected sync endpoint is `POST /api/admin/sync/horoshop-banners`.
- The existing hourly Horoshop catalog scheduler runs banner synchronization after a successful catalog sync.
- The admin banner section provides a “Синхронизировать баннеры с сайта” button and displays the sync report.
- The public home banner API returns Horoshop rows when available and falls back to legacy manual banners before the first successful sync.
- Category API responses preserve the legacy `banners` URL list and add clickable `banner_items` metadata.
- Manual banner management is secondary and remains available for compatibility.
- Deployment requires a backend restart for the idempotent migrations and an EAS Update for mobile JavaScript.
- A new Android binary build is not required.
