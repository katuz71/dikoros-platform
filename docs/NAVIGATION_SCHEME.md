# Navigation scheme

This document defines the default navigation contract for the mobile app.

## Route groups

### Root tabs

Root tabs are stable app sections and must not build a deep stack when the user switches between them:

- `/(tabs)` / `/(tabs)/index` — home/catalog
- `/(tabs)/favorites` — favorites
- `/(tabs)/cart` — cart
- `/(tabs)/profile` — profile

Use `router.replace(...)` for root tab navigation.

### Secondary account screens

Secondary account screens belong to profile and should fall back to profile when there is no stack history:

- `/profile-info`
- `/profile-cashback`
- `/profile-reviews`
- `/profile-notifications`
- `/login`
- `/(tabs)/orders`

Use `router.push(...)` when opening them from a concrete source screen.

### Detail and flow screens

Detail/flow screens may be opened on top of the current context:

- `/product/[id]`
- `/checkout`
- `/news-detail`
- `/blog-detail`
- `/policies`
- `/about`

Use `router.push(...)` for detail screens. If they are opened without stack history, their fallback is resolved by `utils/navigation.ts`.

## Back behavior

All visible back arrows should use `safeBack(router, pathname)`.

Android system back follows the same rule:

1. If the native stack can go back, call `router.back()`.
2. If there is no stack and the screen is not home, replace to the screen fallback.
3. If the user is on home and there is no stack, return `false` so Android can close/background the app.

## Header behavior

`AppHeader` is the default app header.

Default actions:

- left: search
- center: logo or title
- right: favorites and notifications

The header back arrow uses the same `safeBack(...)` rule as Android system back.

## Bottom navigation behavior

`AppFooter` is the default bottom navigation. It should use `replace` for root tabs and should not create stacked copies of root sections.
