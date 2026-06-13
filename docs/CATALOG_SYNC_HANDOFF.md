# Catalog sync / price integrity handoff

Date: 2026-06-13
Project: `dikoros-platform`
Production server path: `/opt/dikoros-platform`
Repository: `katuz71/dikoros-platform`

This document is the current source of truth for product catalog synchronization, price integrity, and instructions for future chats.

## Final decision

Horoshop API is the only source of truth for products, prices, availability, promotions, hits, and new products.

Do not use XML feeds, old local exports, spreadsheets, manual copied price lists, or cached files as product/price sources.

The active sync path is:

```text
Horoshop API /api/auth/
  -> Horoshop API /api/catalog/export/
  -> PostgreSQL table products
  -> backend API /products
  -> mobile app
```

## Repository changes made

### 1. Removed stale XML source

Removed `services/products_feed.xml` from the repository.

Reason: it was a stale/secondary product source and could confuse future audits. Product truth must come from Horoshop API only.

Commit:

```text
0bf7000 Remove stale product XML feed source
```

### 2. Locked product price columns to floating-point type

Updated `db.py` migrations so existing PostgreSQL deployments convert product price columns to floating point:

```sql
ALTER TABLE products ALTER COLUMN price TYPE DOUBLE PRECISION USING price::double precision;
ALTER TABLE products ALTER COLUMN old_price TYPE DOUBLE PRECISION USING old_price::double precision;
```

Reason: production DB previously had `products.price` as `integer`, so Horoshop prices like `1.50`, `2.50`, `4.40`, `5.60` were rounded to `2`, `3`, `4`, `6` after sync.

Commit:

```text
2a934a7 Ensure product price columns stay double precision
```

## Server-side changes applied on production

These were created directly on the production server and are not regular application source files.

### 1. Fixed production DB column types

Executed on server:

```sql
ALTER TABLE products
  ALTER COLUMN price TYPE DOUBLE PRECISION USING price::double precision,
  ALTER COLUMN old_price TYPE DOUBLE PRECISION USING old_price::double precision;
```

Verified result:

```text
old_price | double precision
price     | double precision
```

### 2. Manual Horoshop sync run

Ran sync inside backend container:

```bash
cd /opt/dikoros-platform

docker compose exec -T app python3 - <<'PY'
import asyncio
from services.catalog_sync import sync_catalog_from_horoshop

result = asyncio.run(sync_catalog_from_horoshop())
print(result)
PY
```

Successful result:

```text
{'success': True, 'count': 507, 'stale_out_of_stock': 1, 'home_sections': {'hit': 8, 'new': 16, 'promotion': 0}, 'message': 'Synced products: 507; hidden stale products: 1'}
```

### 3. Price audit after fix

After fixing DB column types and syncing from Horoshop API, live Horoshop prices matched DB prices exactly:

```text
HOROSHOP_SKU 507
DB_SKU 508
STALE_HIDDEN 1 copy_МБ-05
ERRORS 0
```

`copy_МБ-05` exists only as a stale hidden product and is `out_of_stock`. It is not an active Horoshop SKU.

### 4. Automatic catalog sync timer

Created server script:

```text
/usr/local/bin/dikoros-catalog-sync
```

Current purpose:

- Run Horoshop sync from inside the app container.
- Fail if sync does not return success.
- Fail if sync returns zero products.
- Send Telegram alert if sync fails.

Created systemd units:

```text
/etc/systemd/system/dikoros-catalog-sync.service
/etc/systemd/system/dikoros-catalog-sync.timer
```

Current timer cadence:

```text
OnBootSec=2min
OnUnitActiveSec=5min
AccuracySec=30s
Persistent=true
```

Verified automatic run:

```text
Jun 13 13:15:47 Starting dikoros-catalog-sync.service
Jun 13 13:16:09 SYNC {'success': True, 'count': 507, ...}
Jun 13 13:16:09 Finished dikoros-catalog-sync.service
```

### 5. Telegram alert script

Created server script:

```text
/usr/local/bin/dikoros-telegram-alert
```

Uses env variables from `/opt/dikoros-platform/.env`:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

Verified alert send:

```text
telegram alert sent
```

### 6. Catalog sync watchdog

Created server script:

```text
/usr/local/bin/dikoros-catalog-watchdog
```

Created systemd units:

```text
/etc/systemd/system/dikoros-catalog-watchdog.service
/etc/systemd/system/dikoros-catalog-watchdog.timer
```

Current watchdog cadence:

```text
OnBootSec=10min
OnUnitActiveSec=15min
AccuracySec=1min
Persistent=true
```

Watchdog checks that a successful sync appeared in `journalctl` during the last 30 minutes. If not, it sends a Telegram warning.

Verified watchdog run:

```text
Last catalog sync found: Jun 13 13:21:38
```

## Current production state

Catalog sync protection is now:

```text
1. Every 5 minutes: sync products/prices/availability from live Horoshop API.
2. If sync fails: Telegram alert.
3. Every 15 minutes: watchdog checks that successful sync happened recently.
4. If successful sync is missing for 30 minutes: Telegram alert.
5. Product price fields support decimals and do not round Horoshop prices.
6. XML feed source is removed from repository and must not be reintroduced.
```

## Commands for quick verification

### Check timers

```bash
systemctl list-timers 'dikoros-catalog-*' --no-pager
```

Expected:

```text
dikoros-catalog-sync.timer
dikoros-catalog-watchdog.timer
```

### Check last sync logs

```bash
journalctl -u dikoros-catalog-sync.service -n 40 --no-pager
```

Expected recent line:

```text
SYNC {'success': True, 'count': 507, ...}
```

### Check watchdog logs

```bash
journalctl -u dikoros-catalog-watchdog.service -n 40 --no-pager
```

Expected recent line:

```text
Last catalog sync found: ...
```

### Check price column types

```bash
docker exec postgres_db psql -U postgres -d app_db -P pager=off -c "
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'products'
  AND column_name IN ('price', 'old_price')
ORDER BY column_name;
"
```

Expected:

```text
old_price | double precision
price     | double precision
```

### Check repository cleanup on server

```bash
cd /opt/dikoros-platform
git status --short
```

Expected: no `services/products_feed.xml` and no `_disabled_sources/`.

If server still has local cleanup leftovers after pulling commits, run:

```bash
cd /opt/dikoros-platform
rm -rf _disabled_sources
git pull
```

## Instructions for future chats

At the start of any new chat related to catalog, prices, products, categories, or app product cards:

1. Read this file first:

```text
docs/CATALOG_SYNC_HANDOFF.md
```

2. Treat this file as the source of truth for catalog synchronization unless a newer handoff explicitly supersedes it.

3. Do not use or recreate `services/products_feed.xml`.

4. Do not use XML, spreadsheets, local product exports, screenshots, or manual price tables as the authoritative catalog source.

5. Use Horoshop API `/api/catalog/export/` as the only product source.

6. Never manually edit product prices in DB except as an emergency diagnostic step. If any manual DB edit is made, immediately run Horoshop sync and price audit again.

7. If a product price mismatch is reported, check in this order:

```text
A. systemctl list-timers 'dikoros-catalog-*' --no-pager
B. journalctl -u dikoros-catalog-sync.service -n 80 --no-pager
C. products.price and products.old_price column types
D. live Horoshop API value for the SKU
E. DB products row for the SKU
F. backend /products response
G. frontend card display logic
```

8. If prices are rounded again, immediately check whether `products.price` reverted to `integer`. It must be `double precision`.

9. If sync fails intermittently with timeout, do not add a second full-catalog API audit immediately after sync. That doubled Horoshop API load and caused a `ReadTimeout`. The timer should run one sync only; the watchdog monitors recent successful syncs separately.

10. The user prefers operational work one command at a time. Provide exact commands and wait for output.

11. Preserve encoding. Be careful with Cyrillic SKUs such as `ЧБ-01С`, `НМК-01`, `МХМЧ-01С24`.

12. For product card display issues, remember prior fixes:

```text
- category cards should show product/card price from selected main variant, not minPrice.
- grouped category cards should avoid selecting micro-variants as main cards when regular variants exist.
- old_price/title on grouped cards should come from the selected main variant, not arbitrary group aggregate.
```

## Known current values

As of 2026-06-13:

```text
Horoshop live SKU count: 507
DB SKU count: 508
Hidden stale SKU: copy_МБ-05
Price audit result: ERRORS 0
Sync interval: every 5 minutes
Watchdog interval: every 15 minutes
Watchdog stale threshold: no successful sync in last 30 minutes
```
