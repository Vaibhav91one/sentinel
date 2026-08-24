#!/usr/bin/env bash
# Starts the deliberately-weak demo target on http://localhost:3000.
# Zero dependencies - plain Node. All data is fake.
set -euo pipefail
exec node "$(dirname "$0")/vuln-app.mjs"
