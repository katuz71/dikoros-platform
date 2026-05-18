#!/usr/bin/env bash
set -euo pipefail

python tools/migrate_schemas_module.py
python tools/check_duplicate_routes.py

echo "Schemas module migration applied and duplicate route check passed."
