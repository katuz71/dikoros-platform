# Horoshop discount price fix

Date: 2026-06-13

This addendum updates `docs/CATALOG_SYNC_HANDOFF.md` with the final discount-price interpretation found during live SKU verification.

## Problem found

SKU checked:

```text
ЛН-01С25
```

Horoshop live API returned:

```text
article = ЛН-01С25
parent_article = ЛН-01ЕС
price = 4
discount = 15
old_price = None
```

Horoshop website displayed:

```text
current price = 3.40 грн
old price = 4.00 грн
```

The app/backend previously displayed:

```text
current price = 4.00 грн
old price = 4.71 грн
```

## Root cause

The sync code interpreted `item["price"]` as the already-discounted/current price and reconstructed old price as:

```text
old_price = price / (1 - discount / 100)
```

That was wrong for Horoshop discount products. For these products, Horoshop API sends `price` as the regular catalog price and `discount` separately. The site applies the discount on top of `price`.

## Correct rule

When Horoshop API sends `discount > 0`:

```text
regular_price = item["price"]
current_app_price = regular_price * (1 - discount / 100)
old_price = regular_price, unless Horoshop sends a valid explicit old_price greater than the discounted price
```

For SKU `ЛН-01С25`:

```text
regular_price = 4.00
discount = 15%
current_app_price = 3.40
old_price = 4.00
```

## Server hotfix applied

Production server file patched:

```text
/opt/dikoros-platform/services/catalog_sync.py
```

After patch and sync, DB result for `ЛН-01С25`:

```text
sku      price  old_price  discount
ЛН-01С25 3.4    4          15
```

## Required repository persistence

This server hotfix must be committed to the repository in `services/catalog_sync.py`, otherwise future deploys can revert the fix.

Expected code direction:

```python
def _discounted_price_from_discount(price: float, discount_percent: float) -> float:
    """Apply Horoshop discount percent to regular catalog price."""
    if price <= 0 or discount_percent <= 0 or discount_percent >= 100:
        return price
    return round(price * (1 - discount_percent / 100), 2)
```

and inside `sync_catalog_from_horoshop()`:

```python
regular_price = _parse_float(item.get("price"))
discount_percent = int(_parse_float(item.get("discount")))
old_price = _parse_float(item.get("old_price"))
price = regular_price
if discount_percent > 0:
    price = _discounted_price_from_discount(regular_price, discount_percent)
    if old_price <= price:
        old_price = regular_price
```

## Future chat instruction

Any new chat working on prices must read both:

```text
docs/CATALOG_SYNC_HANDOFF.md
docs/HOROSHOP_DISCOUNT_PRICE_FIX.md
```

Never assume Horoshop API `price` is always final/current price when `discount > 0`.
