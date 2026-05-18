#!/usr/bin/env bash
set -euo pipefail

python tools/migrate_db_module.py
python tools/check_duplicate_routes.py

echo "DB module migration applied and duplicate route check passed."
