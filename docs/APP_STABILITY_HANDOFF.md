# App Stability Handoff

Last updated: 2026-06-12

This file is mandatory source of truth for the DikorosUA mobile app. Every future chat must read this document first, then `docs/PRODUCT_CATALOG_SYNC_HANDOFF.md`, before changing catalog, categories, product cards, prices, auth, profile, checkout, cart, OneBox, analytics, or build config.

## Current post-build state

A recent Android build was made from `main` with Android `versionCode = 37`.

Reported regressions after that build:

1. Products disappeared from category screens.
2. Product prices in the app do not match Horoshop / website prices.
3. The client data/profile page regressed and an old modal appeared again.
4. Google authorization was working before and is now broken.

These must be fixed in a development build first. Do not make another production build until the QA checklist below passes.

## Absolute rule: do not break finished work

Future work must be additive and isolated. Do not rewrite, clean up, simplify, or replace working features while fixing another area.

Protected areas:

- SMS registration and SMS login.
- Google authorization.
- JWT `/me` profile flow.
- Client data/profile page.
- Cart and checkout.
- OneBox order payload and delivery/payment fields.
- Nova Poshta / Ukrposhta delivery logic.
- Product detail variants.
- SKU/article display under the price.
- Hidden unavailable product-detail variant buttons.
- Homepage Horoshop blocks: hits, promotions, new products.
- Product sync and Horoshop source-of-truth logic.
- Firebase/Meta analytics.
- Android package and app config.

If a task touches one protected area, do not modify the others in the same commit.

## Recent completed work that must be preserved

- Product catalog sync from Horoshop is source of truth.
- Homepage sections were aligned with Horoshop: hits 8, promotions 1, new products 16.
- `/api/catalog/home/debug` was removed.
- Parent category filtering was restored so parent categories include child categories.
- Product detail page shows SKU/article under the price.
- Product detail variant buttons hide unavailable variants.
- Android `versionCode` is now 37.
- BOM was removed from `app.json`.

## Immediate priority

Fix regressions in this order:

1. Restore the client data/profile page and remove the old modal regression.
2. Restore Google authorization.
3. Fix category screens showing zero products.
4. Fix product prices so they match Horoshop.
5. Repair category filters only after category parity and price parity are confirmed.
6. Build and test a development build.

Do not start with UI polish. Restore broken core behavior first.

## Required prompt for a new chat

Use this prompt at the start of the next chat:

```text
Продолжаем проект dikoros-platform.

Сначала обязательно прочитай:
1. docs/APP_STABILITY_HANDOFF.md
2. docs/PRODUCT_CATALOG_SYNC_HANDOFF.md

Не пиши код, пока полностью не прочитаешь оба документа.

Текущая задача: после последнего Android build сломались категории, цены, страница данных клиента и Google authorization. Нужно безопасно восстановить рабочее состояние, ничего из уже готового не ломать. Сначала диагностика, потом минимальные патчи, потом dev build.
```

## Mandatory diagnostics before code changes

Run locally:

```powershell
cd C:\Work\dikoros-platform

git status
git branch --show-current
git log --oneline -20
npx tsc --noEmit
```

Then inspect recent changes:

```powershell
git show --stat HEAD
git show --stat HEAD~1
git show --stat HEAD~2
git diff HEAD~5..HEAD -- "app/(tabs)/index.tsx" app.json
```

Find the commit that introduced category filters. Do not blindly keep it if it hides all products.

## Category and price rules

Horoshop / website is source of truth.

Default category behavior:

- Open category.
- Show the same products as Horoshop/category API for that category.
- Preserve Horoshop/API order by default.
- Do not apply a default frontend filter that removes all products.
- Do not sort default `Популярні` by id unless that is proven to match Horoshop order.
- Parent category must include child categories.

Price behavior:

- Product card price must match Horoshop/backend API.
- Do not invent price from variants unless backend explicitly uses that as card price.
- If variants exist, inspect backend response and Horoshop price behavior before changing display logic.
- `minPrice` can be used only when it matches the intended website/app card price.
- If product detail price and category card price disagree, diagnose backend response first.

Availability behavior:

- Do not enable any default filter that changes category contents until parity with Horoshop is verified.
- Default category view must not hide valid products.
- A `В наявності` filter can exist, but it must be user-controlled and tested with real API data.

## Category filter requirements after parity is fixed

Only after categories and prices match Horoshop, add or repair filters.

The filter UI must be normal e-commerce style:

- filter icon in category header;
- bottom sheet/modal;
- sorting block;
- price from/to;
- availability checkbox;
- promotions checkbox;
- reset button;
- show button.

Do not add a horizontal row of filter chips above products.

Filter logic must be scoped to the current category only. Filters must not pull products from other categories.

## Profile/client data page rules

The client data/profile page was already implemented and must be restored.

Do not replace it with an old modal. If a modal is visible instead of the page, find the regression and revert only that part.

Keep the JWT `/me` flow intact.

## Google auth rules

Google authorization was working before and must be restored.

Do not disable Google auth. Do not replace it with email/password. Do not allow Google auth changes to break the existing SMS registration/login flow.

Expected auth principles:

- SMS registration/login remains the primary phone-verification path.
- Google login must work according to the previously implemented safe logic.
- `/me` must remain JWT-based.
- Legacy phone-based endpoints must remain closed if already closed.

## Safe repair strategy

Use small commits. One domain per commit.

Recommended order:

1. `Restore profile data screen`
2. `Restore Google authentication flow`
3. `Fix category product visibility and prices`
4. `Repair category filter modal`
5. `Bump Android versionCode only after QA`

After each commit:

```powershell
npx tsc --noEmit
git diff --check
```

For local development testing:

```powershell
npx expo run:android
```

For EAS development build:

```powershell
eas build --platform android --profile development
```

Do not make a production build until the development build is manually checked on device.

## QA checklist before production

Catalog/category:

- Products appear in each main category.
- Parent category includes child category products.
- Default category order matches Horoshop/API order.
- Prices in category cards match Horoshop.
- Product detail price/variants match Horoshop.
- Missing/out-of-stock variants do not appear as selectable product detail options.
- Filter icon opens bottom sheet/modal.
- Filter reset restores default category list.
- Empty state appears only when filters legitimately return zero products.

Auth/profile:

- SMS login works.
- Google login works.
- `/me` returns current user with JWT.
- Client data/profile page opens as a page, not an old modal.
- Existing user data is not wiped.
- Logout/login does not break profile.

Checkout/integrations:

- Cart opens.
- Checkout opens.
- OneBox payload is not changed by catalog/profile fixes.
- Delivery/payment fields still exist.

Build:

- `npx tsc --noEmit` passes.
- `git diff --check` passes.
- Android development build installs and passes manual QA.

## Hard stop conditions

Stop and ask for review if any of these happens:

- Category list becomes empty after a filter/category patch.
- Product prices no longer match Horoshop.
- Google login stops working.
- Client data page is replaced by a modal.
- A patch changes more than one protected domain.
- A patch touches backend sync, OneBox, auth, and category UI together.
- A change requires guessing Horoshop semantics instead of inspecting API data.

## Notes for future assistants

The user wants decisive execution, but not broad rewrites. Keep responses concise. Provide exact PowerShell commands for Windows. Avoid bash heredocs. Do not ask unnecessary questions. When a change is risky, split it into smaller commits and verify after each one.
