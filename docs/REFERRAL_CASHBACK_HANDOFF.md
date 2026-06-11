# Referral + Cashback Handoff

Last updated: 2026-06-11

This document is the source of truth for the DikorosUA referral, registration bonus, and cashback logic. Future chats must read this file before changing auth, profile, bonuses, cashback, deep links, or build versioning.

## Current production intent

The app must support:

1. A user can invite a friend from Profile.
2. The friend receives a referral web link like:

   ```text
   https://app.dikoros.ua/ref?referrer=<referrer_phone>
   ```

3. The referral web page redirects into the app by custom scheme:

   ```text
   dikoros://ref?referrer=<referrer_phone>
   ```

4. New SMS-registered user gets **150 грн** registration bonus.
5. Referrer gets **50 грн** only when the invited phone becomes a new SMS-registered user.
6. Minimum cashback is **5% from the first purchase**.
7. Accumulative cashback tiers remain:

   | Total spent | Cashback |
   | --- | ---: |
   | 0 - 4 999 грн | 5% |
   | 5 000 - 9 999 грн | 10% |
   | 10 000 - 24 999 грн | 15% |
   | 25 000+ грн | 20% |

## Important rules: do not break these

- Do **not** return to phone-only referral sharing. Profile sharing must use `/api/referral/me` and share the generated web link.
- Do **not** set first cashback tier to `0%` again. The minimum is `5%`.
- Do **not** award 150 грн registration bonus to existing or legacy users.
- Do **not** award 50 грн referral bonus unless the referrer is an existing user and the invited user is a new SMS registration.
- Do **not** allow self-referral. Referrer phone equal to the new user phone must be ignored.
- Do **not** change the app scheme from `dikoros` unless `/ref` HTML redirect and `app/ref.tsx` are updated together.
- Do **not** re-enable email/password auth or legacy phone endpoints while working on this area.
- Do **not** treat helper scripts as runtime logic. Runtime source of truth is backend routers/services and frontend screens.

## Backend implementation

### Files

- `routers/referral.py`
- `routers/auth.py`
- `models/schemas.py`
- `services/db_schema.py`
- `main.py`

### Endpoints

#### `GET /api/referral/me`

Requires JWT auth. It uses the current user phone and returns referral data:

```json
{
  "referrer": "380...",
  "web_link": "https://app.dikoros.ua/ref?referrer=380...",
  "app_link": "dikoros://ref?referrer=380...",
  "referral_bonus": 50,
  "registration_bonus": 150,
  "message": "..."
}
```

Profile sharing depends on this endpoint. Do not make the app build referral links manually from the phone unless this endpoint is unavailable and a deliberate fallback is approved.

#### `GET /ref?referrer=<phone>`

Public referral landing page. It returns `text/html` and redirects to:

```text
dikoros://ref?referrer=<phone>
```

This endpoint is intentionally public so the shared referral link can be opened from messengers/browsers.

### SMS auth referral behavior

`SmsAuthStartRequest` and `SmsAuthVerifyRequest` accept optional `referrer`.

At SMS start:

- normalize input phone;
- normalize optional `referrer`;
- block self-referral;
- store normalized referrer in pending SMS auth state.

At SMS verify:

- if the user is new:
  - create user;
  - set `phone_verified = true`;
  - set `bonus_balance = 150`;
  - set `cashback_percent = 5`;
  - save `referrer` in `users.referrer` when valid;
  - add `+50` to referrer `bonus_balance` only if the referrer exists;
- if the user already exists or is a migrated legacy user:
  - do not give registration bonus;
  - do not give referral bonus;
  - keep/raise cashback to at least `5%`;
  - set `phone_verified = true`.

### Database

`services/db_schema.py` must ensure this column exists:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer TEXT;
```

Existing user fields used by this logic:

- `users.phone`
- `users.bonus_balance`
- `users.cashback_percent`
- `users.total_spent`
- `users.phone_verified`
- `users.referrer`

## Frontend implementation

### Files

- `app/ref.tsx`
- `app/(tabs)/profile.tsx`
- `app.json`

### `app/ref.tsx`

Handles referral deep links and referral registration screen:

```text
dikoros://ref?referrer=<phone>
```

Behavior:

- reads `referrer` from route params;
- sends SMS start request with `{ phone, referrer }`;
- verifies SMS with `{ phone, code, referrer }`;
- stores `accessToken`, `userPhone`, optional `userName`;
- routes to profile after success;
- new users should see registration bonus success messaging.

### Profile sharing

`app/(tabs)/profile.tsx` must use JWT and `/api/referral/me`:

```ts
const res = await fetch(`${API_URL}/api/referral/me`, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
```

Then share:

- `referral.message`
- `referral.web_link`

Do not return to the old text:

```text
Вкажи мій номер ... при замовленні
```

That is obsolete.

### Profile cashback UI

`app/(tabs)/profile.tsx` must show minimum 5%:

```ts
let currentPercent = 5;
let nextLevel = 5000;
let nextPercent = 10;
let prevLevel = 0;

if (totalSpent < 5000) {
  currentPercent = 5;
  nextLevel = 5000;
  nextPercent = 10;
  prevLevel = 0;
}
```

The modal table must start with:

```text
0 - 4 999 ₴ -> 5%
```

Do not reintroduce:

```text
0 - 1 999 ₴ -> 0%
```

### App config

`app.json` currently uses:

```json
{
  "scheme": "dikoros",
  "android": {
    "package": "com.dikorosua.app",
    "versionCode": 34
  }
}
```

For Google Play Android builds, each new upload must have a higher `android.versionCode`.

## Verification already completed

### TypeScript

Local command completed clean after the final profile fix:

```powershell
npx tsc --noEmit --pretty false
```

### Server smoke

After server pull/restart, these were verified:

```bash
curl -i https://app.dikoros.ua/health
curl -i 'https://app.dikoros.ua/ref?referrer=380501112233'
```

Expected and observed:

- `/health` returns `HTTP/2 200` with JSON status ok;
- `/ref?referrer=380501112233` returns `HTTP/2 200`, `text/html`, and contains redirect to `dikoros://ref?referrer=380501112233`.

### Git commits related to this scope

Backend/referral:

- `387741d` Add referral link endpoints
- `18e9b85` Fix referral API module import
- `6bdbb89` Register referral router
- `675fec5` Add referral fields to auth schemas
- `66a9b8d` Apply referral bonuses during SMS registration
- `efe9062` Ensure referral user columns exist

Frontend/profile/deep link:

- `a14c5ca` Add referral registration deep link screen
- `0aedda2` Show minimum five percent cashback in profile
- `239ca4d` Fix referral share TypeScript error

Build version:

- `9e18dc5` Bump Android version code to 34

Documentation:

- this file.

## Production deployment checklist

### Backend server

Run on server:

```bash
cd /opt/dikoros-platform

git pull origin main
docker restart fastapi_app
sleep 10

docker logs fastapi_app --tail 120
```

There must be no `Traceback`.

Smoke:

```bash
curl -i https://app.dikoros.ua/health
curl -i 'https://app.dikoros.ua/ref?referrer=380501112233'
```

### Android production build

Run locally:

```powershell
cd C:\work\dikoros-platform

git pull origin main
npx tsc --noEmit --pretty false
eas build -p android --profile production
```

Upload resulting `.aab` to Google Play Internal testing.

### App QA after installing build

1. Open Profile.
2. Confirm cashback badge shows `5% Кешбек` for a new/low-spend user.
3. Tap `Запросити друга`.
4. Confirm share sheet contains `https://app.dikoros.ua/ref?referrer=...`.
5. Open referral web link on a phone with the app installed.
6. Confirm it opens the app referral registration screen.
7. Register a new phone by SMS through referral flow.
8. Confirm new user receives 150 грн bonus.
9. Confirm referrer receives +50 грн.
10. Confirm existing user login through a referral link does not receive registration/referral bonuses again.

## Known helper script

`scripts/apply-referral-profile-patch.js` was used only to patch `app/(tabs)/profile.tsx` safely on Windows. It is not runtime logic.

If future work changes profile cashback/referral code manually, do not rely on this helper as source of truth. Update the real source files and then update this document.
