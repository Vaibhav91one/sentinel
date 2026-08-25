#!/usr/bin/env bash
# Runs INSIDE the sandbox. Boots OWASP Juice Shop deterministically.
# Model-independent: the agent runs this one script and reads the status file.
#
# Output contract (what callers check):
#   /tmp/js_status.txt   -> "READY http://localhost:3000"  or  "FAILED <reason>"
#   /tmp/js.log          -> full startup log for diagnosis
set -uo pipefail

STATUS=/tmp/js_status.txt
LOG=/tmp/js.log
PORT=3000
DIR=/tmp/juice-shop

fail() { echo "FAILED $1" > "$STATUS"; echo "--- log tail ---" >> "$STATUS"; tail -30 "$LOG" >> "$STATUS" 2>/dev/null; exit 1; }

echo "[js] $(date -Is) starting" > "$STATUS"
: > "$LOG"

# ---------- 1. fetch latest linux_x64 packaged release ----------
cd /tmp
TAG=$(curl -sSL -o /dev/null -w '%{url_effective}' https://github.com/juice-shop/juice-shop/releases/latest | sed 's#.*/tag/##')
[ -n "$TAG" ] && [ "$TAG" != "latest" ] || fail "could not resolve latest release tag"
ASSET=$(curl -sSL "https://github.com/juice-shop/juice-shop/releases/expanded_assets/$TAG" \
        | grep -oE 'href="[^"]*linux_x64\.zip"' | head -1 | sed 's/^href="//; s/"$//')
[ -n "$ASSET" ] || fail "no linux_x64.zip asset for $TAG"
URL="https://github.com$ASSET"
ASSET_FILE=$(basename "$ASSET")

echo "[js] downloading $ASSET_FILE" | tee -a "$STATUS" "$LOG"
curl -sSL --retry 3 -o "$ASSET_FILE" "$URL" 2>>"$LOG" || fail "download failed"

# ---------- 2. unpack ----------
rm -rf "$DIR"; mkdir -p "$DIR"
unzip -q "$ASSET_FILE" -d "$DIR" 2>>"$LOG" || fail "unzip failed"
cd "$DIR" || fail "unpack dir missing"

# ---------- 3. locate a runtime ----------
# Packaged builds usually bundle their own Node runtime; fall back to system node.
NODE_BIN=""
if [ -x "./juice-shop" ]; then
  RUN=(./juice-shop)
elif [ -x "./node/bin/node" ]; then
  NODE_BIN=./node/bin/node; RUN=("$NODE_BIN" build/app.js)   # older packaging layout
elif [ -f "build/app.js" ]; then
  RUN=(node build/app.js)
else
  APPJS=$(find . -maxdepth 2 -name "app.js" | head -1)
  [ -n "$APPJS" ] || fail "no entrypoint found (no juice-shop bin, node/, or app.js)"
  RUN=(node "$APPJS")
fi

# ensure *a* node exists for the fallback paths
if ! command -v node >/dev/null 2>&1 && [ -z "$NODE_BIN" ] && [ ! -x ./juice-shop ]; then
  export DEBIAN_FRONTEND=noninteractive
  (apt-get update -qq && apt-get install -y -qq nodejs) >>"$LOG" 2>&1 || fail "apt nodejs install failed"
fi

# ---------- 4. launch ----------
echo "[js] launching: ${RUN[*]}" | tee -a "$STATUS" "$LOG"
nohup "${RUN[@]}" >"$LOG" 2>&1 &
echo $! > /tmp/js.pid

# ---------- 5. bounded readiness poll (Juice Shop boots in 1-3 min) ----------
for i in $(seq 1 48); do   # 48 x 5s = 4 min ceiling
  sleep 5
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$PORT/" || true)
  if [ "$CODE" = "200" ] || [ "$CODE" = "301" ] || [ "$CODE" = "302" ]; then
    echo "READY http://localhost:$PORT (tag=$TAG pid=$(cat /tmp/js.pid))" > "$STATUS"
    exit 0
  fi
  # process died? stop waiting
  kill -0 "$(cat /tmp/js.pid)" 2>/dev/null || break
done

fail "port $PORT never returned 200 (last code: ${CODE:-none})"
