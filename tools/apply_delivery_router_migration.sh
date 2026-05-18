#!/usr/bin/env bash
set -euo pipefail

python tools/migrate_delivery_router.py
python tools/check_duplicate_routes.py

echo "Delivery router migration applied and duplicate route check passed."
