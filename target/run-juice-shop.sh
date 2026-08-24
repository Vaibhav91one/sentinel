#!/usr/bin/env bash
# Starts OWASP Juice Shop on http://localhost:3000 as the authorized demo target.
# Works with Docker or the Apple container CLI.
set -euo pipefail

IMAGE="ghcr.io/juice-shop/juice-shop:latest"
NAME="sentinel-juice-shop"

RUNNER=""
if command -v docker >/dev/null 2>&1; then
  RUNNER="docker"
elif command -v container >/dev/null 2>&1; then
  RUNNER="container"
else
  echo "error: need 'docker' or Apple 'container' CLI installed" >&2
  exit 1
fi

echo "removing old instance (if any)..."
"$RUNNER" rm -f "$NAME" >/dev/null 2>&1 || true

echo "starting $NAME via $RUNNER..."
"$RUNNER" run --name "$NAME" -d -p 3000:3000 "$IMAGE"

echo
echo "Juice Shop starting on http://localhost:3000 (first boot takes ~20s)."
echo "localhost is already in Sentinel's default scope."
