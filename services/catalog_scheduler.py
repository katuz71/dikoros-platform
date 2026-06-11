"""Background catalog sync scheduler."""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time

from services.catalog_sync import sync_catalog_from_horoshop


logger = logging.getLogger(__name__)

SYNC_INTERVAL_SECONDS = 60 * 60
INITIAL_SYNC_DELAY_SECONDS = 60
SYNC_RETRY_ATTEMPTS = 3
SYNC_RETRY_DELAY_SECONDS = 5 * 60
_started = False


def _has_horoshop_credentials() -> bool:
    return all(
        (os.getenv(name) or "").strip()
        for name in ("HOROSHOP_DOMAIN", "HOROSHOP_LOGIN", "HOROSHOP_PASSWORD")
    )


def _run_sync_with_retries() -> dict:
    last_error: Exception | None = None

    for attempt in range(1, SYNC_RETRY_ATTEMPTS + 1):
        try:
            return asyncio.run(sync_catalog_from_horoshop())
        except Exception as exc:
            last_error = exc
            logger.warning(
                "Hourly Horoshop catalog sync attempt %s/%s failed: %s",
                attempt,
                SYNC_RETRY_ATTEMPTS,
                exc,
            )
            if attempt < SYNC_RETRY_ATTEMPTS:
                time.sleep(SYNC_RETRY_DELAY_SECONDS)

    raise RuntimeError(f"Hourly Horoshop catalog sync failed after retries: {last_error}")


def _sync_loop() -> None:
    time.sleep(INITIAL_SYNC_DELAY_SECONDS)

    while True:
        try:
            result = _run_sync_with_retries()
            logger.info("Hourly Horoshop catalog sync completed: %s", result)
        except Exception as exc:
            logger.exception("Hourly Horoshop catalog sync failed: %s", exc)

        time.sleep(SYNC_INTERVAL_SECONDS)


def start_catalog_sync_scheduler() -> None:
    global _started

    if _started:
        return
    if not _has_horoshop_credentials():
        logger.info("Horoshop catalog sync scheduler skipped: credentials are not configured")
        return
    _started = True
    thread = threading.Thread(target=_sync_loop, name="catalog-sync", daemon=True)
    thread.start()
    logger.info("Horoshop catalog sync scheduler started")
