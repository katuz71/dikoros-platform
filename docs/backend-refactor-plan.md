# Backend refactor plan

`main.py` is currently a legacy monolith. The target architecture is a small app entrypoint plus separate routers and services.

## Current safe state

The following modules have been added as preparation-only changes. They are not yet wired into `main.py`:

- `models/schemas.py`
- `db.py`
- `services/security.py`
- `services/images.py`
- `services/analytics.py`
- `services/auth.py`
- `services/users.py`
- `routers/health.py`
- `routers/public_pages.py`
- `routers/delivery.py`
- `routers/uploads.py`
- `routers/analytics.py`
- `routers/registry.py`

## Safety rule

Before connecting a router to `main.py`, remove or disable the matching legacy route decorators from `main.py`.

Run:

```bash
python tools/check_duplicate_routes.py
```

The command must not show duplicate method/path pairs before deployment.

## Recommended connection order

1. `health`
   - Remove legacy `GET /health` from `main.py`.
   - Include `routers.health.router`.

2. `public_pages`
   - Remove legacy public page endpoints from `main.py`:
     - `GET /delete-account`
     - `GET /privacy-policy`
     - `GET /delivery-payment`
     - `GET /returns`
     - `GET /about`
   - Include `routers.public_pages.router`.

3. `delivery`
   - Remove legacy delivery endpoints from `main.py`:
     - `GET /api/delivery/popular-cities`
     - `GET /api/delivery/cities`
     - `GET /api/delivery/warehouses`
   - Include `routers.delivery.router`.

4. `uploads`
   - Remove legacy upload/image endpoints from `main.py`:
     - `GET /api/image`
     - `POST /upload`
   - Mount static uploads once.
   - Include `routers.uploads.router`.

5. `analytics`
   - Remove duplicate `AnalyticsEventReq` classes and duplicate `POST /api/track` endpoints from `main.py`.
   - Include `routers.analytics.router`.

## Later router split

After the simple routers are wired, split the heavy business domains:

- `routers/products.py`
- `routers/orders.py`
- `routers/users.py`
- `routers/categories.py`
- `routers/banners.py`
- `routers/reviews.py`
- `routers/promocodes.py`
- `routers/chat.py`
- `routers/admin.py`
- `routers/sync.py`

## Final target

`main.py` should eventually contain only:

- env loading;
- FastAPI app creation;
- CORS/static setup;
- router registration;
- startup hooks;
- no HTML blob;
- no SQL schema creation;
- no business logic.
