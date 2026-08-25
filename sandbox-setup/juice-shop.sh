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
# Resolve newest tag whose assets include a Linux build (zip OR tgz).
# Upstream v20.2.0 dropped Linux zips entirely; older tags ship .tgz.
find_asset() {
  local tag="$1"
  curl -sSL "https://github.com/juice-shop/juice-shop/releases/expanded_assets/$tag" \
    | grep -oE 'href="[^"]*(linux_x64\.(zip|tgz)|linux_x64.tar\.gz)"' \
    | sed 's/^href="//; s/"$//' | head -1
}

TAG=""
ASSET=""
# Releases atom feed lives on github.com itself -> stays inside default scope
# (api.github.com is a separate host and deliberately NOT allow-listed).
RELEASES_FEED="https://github.com/juice-shop/juice-shop/releases.atom"
for TAG_CAND in $(curl -sSL "$RELEASES_FEED" \
                    | grep -oE 'releases/tag/[^<]+' | sed 's#releases/tag/##'); do
  ASSET=$(find_asset "$TAG_CAND")
  if [ -n "$ASSET" ]; then TAG="$TAG_CAND"; break; fi
done
[ -n "$ASSET" ] || fail "no linux_x64 asset found across last 10 releases"

URL="https://github.com$ASSET"
ASSET_FILE=$(basename "$ASSET")
echo "[js] selected $TAG -> $ASSET_FILE" | tee -a "$STATUS" "$LOG"

curl -sSL --retry 3 -o "$ASSET_FILE" "$URL" 2>>"$LOG" || fail "download failed"

# ---------- 2. unpack (zip or tgz) ----------
rm -rf "$DIR"; mkdir -p "$DIR"
case "$ASSET_FILE" in
  *.zip) unzip -q "$ASSET_FILE" -d "$DIR" 2>>"$LOG" || fail "unzip failed" ;;
  *.tgz|*.tar.gz) tar xzf "$ASSET_FILE" -C "$DIR" 2>>"$LOG" || fail "untar failed" ;;
  *) fail "unknown archive format: $ASSET_FILE" ;;
esac
cd "$DIR" || fail "unpack dir missing"
# flatten single top-level dir if present
if [ -d "$DIR"/juice-shop_* ] && [ ! -f "$DIR"/package.json ]; then
  cd "$DIR"/juice-shop_* || fail "flatten failed"
fi

# ---------- 3. locate a runtime ----------
# Packaged builds usually bundle their own Node runtime; fall back to system node.
ENTRY=$(find . -maxdepth 3 \( -path ./node_modules -o -path ./*/node_modules \) -prune -o -type f -name app.js -print 2>/dev/null | head -1)
BUNDLED_NODE=$(find . -maxdepth 4 -type f -name node -path "*bin*" 2>/dev/null | head -1)

if [ -x "./juice-shop" ]; then
  RUN=(./juice-shop)
elif [ -n "$BUNDLED_NODE" ] && [ -n "$ENTRY" ]; then
  echo "[js] using bundled runtime: $BUNDLED_NODE" >> "$LOG"
  RUN=("$BUNDLED_NODE" "$ENTRY")
elif [ -n "$ENTRY" ]; then
  command -v node >/dev/null 2>&1 || fail "no entrypoint runtime (system node missing)"
  RUN=(node "$ENTRY")
else
  fail "no entrypoint found (no juice-shop bin, bundled node, or app.js)"
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
