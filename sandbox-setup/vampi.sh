#!/usr/bin/env bash
# Runs INSIDE the sandbox. Boots VAmPI deterministically.
# Contract: /tmp/vampi_status.txt -> "READY http://localhost:5000" | "FAILED <reason>"
# Log: /tmp/vampi.log
set -uo pipefail

STATUS=/tmp/vampi_status.txt
LOG=/tmp/vampi.log
PORT=5000
DIR=/tmp/vampi-src

fail() { echo "FAILED $1" > "$STATUS"; tail -30 "$LOG" >> "$STATUS" 2>/dev/null; exit 1; }
log() { echo "[vampi] $*" >> "$LOG"; echo "[vampi] $*" > "$STATUS"; }

echo "[vampi] $(date -Is) start" > "$STATUS"
: > "$LOG"

command -v python3 >/dev/null 2>&1 || fail "python3 missing"

# ---------- acquire ----------
rm -rf "$DIR"
git clone --depth 1 https://github.com/erev0s/VAmPI "$DIR" >>"$LOG" 2>&1 || fail "clone failed"
cd "$DIR"

# ---------- deps ----------
# Pin uvicorn to a version that still supports running WSGI (Flask) apps.
grep -q "uvicorn" requirements.txt || echo "uvicorn==0.29.0" >> requirements.txt
pip3 install -q -r requirements.txt "uvicorn==0.29.0" >>"$LOG" 2>&1 || fail "pip install failed"

# ---------- launch (fully detached from exec session) ----------
export PYTHONUNBUFFERED=1
setsid nohup python3 -m uvicorn app:app --host 127.0.0.1 --port "$PORT" \
  </dev/null >>"$LOG" 2>&1 &
echo $! > /tmp/vampi.pid
disown 2>/dev/null || true

# ---------- bounded readiness poll ----------
for i in $(seq 1 36); do   # 36 x 5s = 3 min
  sleep 5
  kill -0 "$(cat /tmp/vampi.pid)" 2>/dev/null || { log "--- app log ---"; tail -30 "$LOG"; fail "app process died during boot"; }
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$PORT/openapi.json" || true)
  if [ "$CODE" = "200" ]; then
    echo "READY http://localhost:$PORT (pid $(cat /tmp/vampi.pid))" > "$STATUS"
    exit 0
  fi
done

fail "openapi.json never returned 200 within 3 min"
