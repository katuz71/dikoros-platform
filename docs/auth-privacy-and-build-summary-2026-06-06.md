# Auth/privacy migration, app build and next database work

Date: 2026-06-06
Project: `dikoros-platform`
App: DikorosUA / `com.dikorosua.app`

## What was completed

### 1. Frontend was moved from phone/path-based private endpoints to JWT `/me` endpoints

The mobile app no longer requests or mutates private user data by passing a phone number in the URL or body.

Updated areas:

- `app/(tabs)/orders.tsx`
  - Reads orders through `GET /api/client/orders/me`.
  - Sends `Authorization: Bearer <accessToken>`.
  - Removed client-side order deletion/clear UI.

- `app/(tabs)/profile.tsx`
  - Reads profile through `GET /api/user/me`.
  - Reads orders through `GET /api/client/orders/me`.
  - Reads user reviews through `GET /api/user/reviews/me`.
  - Saves profile information through `PUT /api/user/info/me`.
  - Deletes reviews through `DELETE /api/reviews/{id}` with JWT.
  - Push token saving uses `POST /api/user/push-token/me` with JWT.
  - Google/SMS login stores `accessToken` before calling push-token attach logic.

- `app/product/[id].tsx`
  - Review creation now requires login/JWT.
  - `Authorization: Bearer <accessToken>` is sent to `POST /api/reviews`.
  - `user_phone` was removed from review payload.

- `app/(tabs)/index.tsx`
  - Home-screen review creation now uses `GET /api/user/me` for user name.
  - Review creation uses JWT and no longer sends `user_phone`.
  - Home-screen categories now show only root categories. If product category is like `Parent / Child`, only `Parent` appears in the top category chips, but selecting `Parent` still shows products from its child categories.

- `app/_layout.tsx`
  - Push-token registration now uses `POST /api/user/push-token/me` with JWT.
  - Legacy `userPhone/auth_id` push-token flow was removed from layout.

### 2. Backend legacy public endpoints were disabled

These endpoints now return `410 Gone`:

- `GET /user/{phone}`
- `PUT /api/user/info/{phone}`
- `GET /api/client/orders/{phone}`
- `GET /api/user/reviews/{phone}`
- `POST /api/user/push-token`
- `DELETE /api/client/orders/{order_id}` was already disabled for accounting preservation.
- `DELETE /api/client/orders/clear/{phone}` was already disabled for accounting preservation.

Working JWT endpoints:

- `GET /api/user/me`
- `PUT /api/user/info/me`
- `GET /api/client/orders/me`
- `GET /api/user/reviews/me`
- `POST /api/user/push-token/me`
- `POST /api/reviews`
- `DELETE /api/reviews/{id}` only deletes the authenticated user's own review.

Internal helper functions were separated from legacy routes:

- `routers/users.py`
  - `_get_user_profile_by_identifier(...)`
  - `_update_user_info_by_identifier(...)`
  - `_save_push_token_for_user(...)`

- `routers/orders.py`
  - `_get_client_orders_by_phone(...)`

- `routers/reviews.py`
  - `_get_user_reviews_by_phone(...)`

### 3. Server verification was completed

After deploy/restart on the server:

```bash
cd /opt/dikoros-platform

git pull --rebase origin main
python3 -m py_compile routers/users.py routers/orders.py routers/reviews.py
docker restart fastapi_app
```

Health checks passed:

- `GET /` returned `200`.
- `GET /docs` returned `200`.

Legacy endpoint checks returned `410`:

- `/user/380000000000`
- `/api/client/orders/380000000000`
- `/api/user/reviews/380000000000`
- `PUT /api/user/info/380000000000`
- `POST /api/user/push-token`

JWT `/me` endpoints without token returned `401`, which is correct:

- `/api/user/me`
- `/api/client/orders/me`
- `/api/user/reviews/me`
- `PUT /api/user/info/me`
- `POST /api/user/push-token/me`

### 4. Android app build was prepared and completed

`app.json` was bumped:

- Android `versionCode`: `27` -> `28`.

The production Android build was started with:

```powershell
eas build --platform android --profile production
```

The user confirmed the build completed successfully.

## Important implementation notes

### Category behavior on home screen

Root category helper added in `app/(tabs)/index.tsx`:

```ts
const getRootCategoryName = (value: any) => {
  const raw = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';

  const separators = ['/', '>', '›', '»', '→'];
  let root = raw;

  separators.forEach((separator) => {
    if (root.includes(separator)) {
      root = root.split(separator)[0].trim();
    }
  });

  return root.replace(/\s+/g, ' ');
};
```

This means category chips display only parent/root categories while category filtering still includes products belonging to child categories.

### Current privacy posture

Private app data is now tied to JWT authentication instead of trusting phone numbers from frontend URLs or request bodies.

The main remaining area for future review is database identity merging, because old sources may contain different identifiers for the same client: phone formats, app account IDs, site accounts, order phone fields, cashback/bonus fields, and review/order history.

## Next chat context: database import and cashback account linking

Goal for the next session:

- Load old databases from the previous mobile app and from the website into the current project.
- Analyze user/order/cashback data structures.
- Merge clients into the current `users` table without losing progress.
- Connect existing clients to the cashback program so when they log into the new app account, their old progress, bonuses, orders, reviews and cashback state are preserved.

Expected input files from user:

- Old mobile app database export.
- Website database export.
- Current production database backup/export if needed.
- Any CSV/SQL dumps that contain users, orders, bonuses, referrals, cashback or reviews.

First tasks for the next chat:

1. Inspect current database schema in the repo and/or production backup.
2. Identify key tables and fields:
   - `users`
   - `orders`
   - `reviews`
   - cashback/bonus/referral-related fields
   - phone/auth/social-login fields
   - push-token fields
3. Inspect old app DB and website DB schemas.
4. Build a mapping plan:
   - normalize phone numbers with the existing `normalize_phone` logic;
   - match users by normalized phone first;
   - then match by email/name only as secondary low-confidence signals;
   - preserve current JWT/account identity;
   - migrate old orders/reviews/bonus/cashback into the matched current user;
   - create missing user records for clients that exist only in old sources.
5. Create a safe import script that runs in dry-run mode first.
6. Produce a report before any write:
   - total old users;
   - matched users;
   - ambiguous matches;
   - new users to create;
   - orders to attach;
   - bonus/cashback balances to migrate;
   - conflicts requiring manual decision.
7. Only after confirmation run the real migration.

Important constraints for next work:

- Do not delete old data.
- Do not overwrite higher-confidence current data without backup.
- Keep a full backup before migration.
- Prefer additive migration and explicit audit tables/logs.
- Keep phone normalization consistent with `services.users.normalize_phone`.
- Keep private data protected by JWT `/me` endpoints; do not reintroduce phone-based public endpoints.

Recommended next-chat opening prompt:

```text
Продолжаем проект dikoros-platform. В прошлом чате мы закрыли phone-based legacy endpoints, перевели frontend на JWT /me endpoints, проверили сервер, сделали Android versionCode 28 и собрали production build. Теперь нужно заняться базами: я загружу старые базы из старого приложения и сайта. Нужно проанализировать схемы, сопоставить пользователей по телефону/email, подключить клиентов к программе кешбека и сохранить их прогресс, заказы, отзывы, бонусы/кешбек в новом аккаунте. Работать безопасно: сначала dry-run, отчет по совпадениям и конфликтам, потом миграция после подтверждения.
```
