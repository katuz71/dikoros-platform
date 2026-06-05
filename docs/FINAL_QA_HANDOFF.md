# Dikoros Platform — final QA handoff

## MUST READ FIRST

This document is the required starting point for the next assistant/chat. Before changing code, running builds, or giving recommendations, read this file completely and use it as the source of truth for the current state of the project.

Do not skip directly to coding. First confirm that you understand the current authentication, SMS, Meta/Firebase analytics, OneBox, and production-readiness state described here.

## Repository and paths

- GitHub repository: `katuz71/dikoros-platform`
- Local Windows path used by the owner: `C:\work\dikoros-platform`
- Server path: `/opt/dikoros-platform`
- Backend Docker container: `fastapi_app`
- Database container: `postgres_db`
- Current branch: `main`

Important note: the old GitHub remote URL may still appear as `katuz71/DikorosUA.git` in local/server git output, but GitHub says the repository moved to `katuz71/dikoros-platform.git`. If needed, update remote URLs later. Do not block final QA on this unless it causes git failures.

## Current product decision

The app must use this auth model:

1. Registration: SMS only.
2. Login: SMS + Google.
3. Email/password: disabled.
4. Google must not create a brand-new account by itself. If Google is not linked to an existing account, backend must return an error and instruct the user to login/register by SMS first.
5. Every real user account should have a verified phone number.

## What was completed

### 1. AlphaSMS provider connected

Files changed:

- `services/alphasms.py`
- `routers/auth.py`

Implementation state:

- AlphaSMS JSON API is used for sending SMS codes.
- API key is read from environment variable `ALPHASMS_API_KEY`.
- Sender/alpha-name is read from `ALPHASMS_SENDER`.
- Approved sender in AlphaSMS cabinet is `Dikoros`.
- Do not hardcode API keys or secrets into the repo.
- Server `.env` must contain:
  - `ALPHASMS_API_KEY=...`
  - `ALPHASMS_SENDER=Dikoros`

Provider behavior fixed:

- Payload uses AlphaSMS fields `sms_signature` and `sms_message`.
- API response is checked correctly.
- If AlphaSMS returns HTTP error or item-level `success: false`, backend must not return fake OK; it raises provider error.

Manual server verification already passed:

- `/api/auth/sms/start` sends SMS.
- SMS arrives on the phone.
- `/api/auth/sms/verify` accepts the code.
- Response includes `access_token`.
- Response includes `phone_verified: true`.

### 2. SMS code input fixed

Files changed:

- `app/(tabs)/profile.tsx`
- `routers/auth.py`

Reason:

- App initially showed bad placeholder text like `SMS-\u043a\u043e\u0434`.
- App also sometimes sent code in a format that backend rejected as invalid.

Fix state:

- Frontend now strips non-digits before sending SMS code.
- Backend also sanitizes SMS code by keeping only digits.
- SMS input was manually tested through USB Android build and worked.

### 3. Profile login UI changed to SMS + Google

File changed:

- `app/(tabs)/profile.tsx`

Current UI state:

- Login/registration modal shows phone number input.
- User can request SMS code.
- After SMS is sent, modal shows SMS code input.
- User can resend SMS code.
- Google button remains as alternative login before SMS step.
- Email/password UI has been removed from the modal.

### 4. Email/password disabled in backend

File changed:

- `routers/auth.py`

Current backend state:

- `/api/auth/email/register` returns HTTP 410.
- `/api/auth/email/login` returns HTTP 410.
- These endpoints are intentionally left as disabled stubs instead of deleting the route immediately.

### 5. Google/social login restricted

File changed:

- `routers/auth.py`

Current backend behavior:

- If user exists by `google_id` / `facebook_id`, social login works.
- If request includes `phone` and a user exists by that phone, backend links `google_id` / `facebook_id` to that phone account.
- If no linked account exists and no matching phone account exists, backend returns HTTP 409:
  - `Use SMS login or registration first. Then Google can be linked to the account.`
- Backend no longer creates `google_*` or `fb_*` users with bonus just from social login.

Potential follow-up:

- The frontend currently calls social login with only the Google token. If Google is not linked, it should show a clean user-facing message telling the user to login by SMS first. Check current error handling and improve the message if needed.
- If we want automatic Google linking after SMS login, implement a deliberate flow: SMS login first, then allow the user to link Google while authenticated, or pass verified phone to `/api/auth/social-login` only after SMS confirmation.

### 6. Meta/Facebook SDK and App Events added

Files changed:

- `package.json`
- `package-lock.json`
- `app.json`
- `utils/analytics.ts`

Current state:

- `react-native-fbsdk-next` installed.
- Expo config plugin added in `app.json`.
- Meta App ID is configured in app config.
- Meta Client Token is configured in app config.
- App Events are logged through the shared `trackEvent` function.
- `Purchase` uses `AppEventsLogger.logPurchase`.
- Other mapped events include registration, add to cart, checkout, content view, and search.

Important:

- Meta SDK will not work in Expo Go. It needs dev build or release build.
- USB build with `npx expo run:android --device` has been used for testing.

### 7. Firebase analytics already present

Files involved:

- `utils/firebaseAnalytics.ts`
- existing calls from app screens

Current state:

- Firebase Analytics is installed through `@react-native-firebase/app` and `@react-native-firebase/analytics`.
- Firebase events are still separate from Meta events.
- Do not remove Firebase while doing final QA.

### 8. OneBox order payload enriched

Files changed earlier:

- `services/onebox_api.py`

Current state:

- OneBox payload now includes more client/order/product fields.
- Added/expanded data includes email, account phone, city/warehouse refs, bonuses, client comment, app product id, SKU, variant/pack/unit, and expanded description.
- Server was rebuilt after this change.

Final QA should still verify a real app order reaches OneBox with enough data.

## Server state already tested

After recent updates, server was pulled and rebuilt at `/opt/dikoros-platform`.

Known working backend tests:

```bash
cd /opt/dikoros-platform

curl -X POST "http://127.0.0.1:8000/api/auth/sms/start" \
  -H "Content-Type: application/json" \
  -d '{"phone":"0999232030"}'

curl -X POST "http://127.0.0.1:8000/api/auth/sms/verify" \
  -H "Content-Type: application/json" \
  -d '{"phone":"0999232030","code":"CODE_FROM_SMS"}'
```

Expected verify result:

- `access_token` exists
- `phone_verified: true`
- `is_new_user` is correct for existing/new user

## Required final QA task for the next chat

The next assistant must perform a final code review and pre-production readiness pass.

### First instruction for next chat

Before doing anything else:

1. Read this document completely.
2. Inspect the current code in the repository.
3. Confirm whether the implemented code matches this document.
4. Only then make changes.

### Code areas to inspect

1. `app/(tabs)/profile.tsx`
   - SMS login modal.
   - Placeholder text.
   - SMS code sanitization.
   - Google login UX when backend returns 409.
   - Removal of email/password UI.

2. `routers/auth.py`
   - SMS start/verify.
   - `phone_verified` update.
   - email endpoints returning 410.
   - social login no longer creating new accounts.
   - Google linking logic if phone is provided.
   - inconsistent SQL placeholder usage: inspect whether this repo currently uses SQLite `?` or Postgres `%s` in this file and whether any route can break depending on connection implementation.

3. `services/alphasms.py`
   - No secrets in code.
   - Uses `ALPHASMS_API_KEY` and `ALPHASMS_SENDER`.
   - Validates provider `success` properly.
   - Phone normalization is correct for UA numbers.

4. `utils/analytics.ts`
   - Meta events do not crash app if SDK unavailable.
   - Purchase event value/currency are correct.
   - Event names are aligned with existing app calls.

5. `app.json`
   - Meta SDK plugin config is present.
   - Android package remains `com.dikorosua.app`.
   - Version/versionCode are correct for the intended build.

6. `services/onebox_api.py`
   - Order payload still compiles.
   - No mojibake or broken placeholders in important user-facing descriptions.
   - No secrets committed.

7. Product/order flow files:
   - Cart item quantity type consistency.
   - Variant products.
   - Order creation request includes all necessary data for OneBox.

### Commands to run locally

Use Windows PowerShell from the project folder:

```powershell
cd C:\work\dikoros-platform
.\.venv\Scripts\Activate.ps1

npx tsc --noEmit --pretty false
python -m py_compile routers\auth.py services\alphasms.py services\onebox_api.py
```

If the repo has backend tests, run them. If no tests exist, do not invent that they passed.

### Commands to run on server

```bash
cd /opt/dikoros-platform

git status --short
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
docker logs --tail 80 fastapi_app
```

If changes are pushed:

```bash
cd /opt/dikoros-platform

git pull origin main
docker compose up -d --build
docker logs --tail 80 fastapi_app
```

### USB Android build command

From Windows:

```powershell
cd C:\work\dikoros-platform
.\.venv\Scripts\Activate.ps1

adb devices
npx expo run:android --device
```

If `adb` is not in PATH:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
```

### Manual app checklist

1. Clean install or logout.
2. Open profile login modal.
3. Confirm only phone/SMS + Google are shown; no email/password UI.
4. Request SMS code.
5. Confirm SMS arrives.
6. Enter SMS code.
7. Confirm login succeeds.
8. Confirm profile persists after app restart.
9. Try Google login on unlinked account and confirm clear message.
10. Add product to cart.
11. Test product variants if present.
12. Create an order.
13. Confirm order reaches backend.
14. Confirm order reaches OneBox with enriched fields.
15. Confirm chat still opens and works.
16. Confirm Firebase/Meta events do not crash the app.
17. Check backend logs for errors after manual use.

## Known risks / things to verify carefully

1. Google linking UX may be incomplete. Backend supports linking if `phone` is provided, but frontend may not pass phone in social login yet.
2. SQL placeholder style in `routers/auth.py` appears mixed in places (`?` and `%s`). Final QA must inspect actual `get_db_connection()` implementation and verify all relevant routes work with the configured database.
3. Some legacy routes such as `/api/auth` may still create users by phone without SMS. Decide whether this route is still used by old flows and whether it should also be restricted before production.
4. Text encoding in older files has had mojibake issues before. Inspect visible UI strings that were recently edited.
5. Meta SDK requires native build. Do not test it in Expo Go.
6. Do not run `npm audit fix --force` blindly; it may break Expo dependencies.
7. Do not commit `.env`, API keys, App Secret, or any private secrets.

## Definition of done for final QA

The project can proceed to production/release build only when:

- TypeScript passes.
- Backend Python files compile.
- Server starts cleanly.
- SMS login works from the app.
- Email/password is absent from UI and disabled in backend.
- Google cannot create new users without SMS registration.
- Order flow creates a valid OneBox order.
- No secrets are committed.
- Final USB build installs and basic flows work on a physical Android device.
