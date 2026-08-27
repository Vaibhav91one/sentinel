#!/usr/bin/env bash
# Runs INSIDE the sandbox. Boots the deliberately-vulnerable Next.js lab
# (next 14.2.20 < 14.2.25) that demonstrates CVE-2025-29927 middleware
# auth-bypass. Self-hosted `next start` — the bypass only works off-Vercel.
# Contract: /tmp/nextjs_status.txt -> "READY http://localhost:3000" | "FAILED <reason>"
# Log: /tmp/nextjs.log
set -uo pipefail

STATUS=/tmp/nextjs_status.txt
LOG=/tmp/nextjs.log
PORT="${1:-3000}"
SRC=/tmp/sentinel/target/nextjs-cve-lab
DIR=/tmp/nextjs-cve-lab

fail() { echo "FAILED $1" > "$STATUS"; tail -30 "$LOG" >> "$STATUS" 2>/dev/null; exit 1; }
log()  { echo "[nextjs-cve] $*" >> "$LOG"; echo "[nextjs-cve] $*" > "$STATUS"; }

: > "$LOG"; echo "[nextjs-cve] $(date -Is) start" > "$STATUS"
command -v npm >/dev/null 2>&1 || fail "npm missing"

# ---------- acquire (repo is cloned by the recon skill Phase 0) ----------
[ -d "$SRC" ] || fail "lab source not found at $SRC (clone the sentinel repo first)"
rm -rf "$DIR"; cp -r "$SRC" "$DIR"; cd "$DIR"
rm -rf node_modules .next

# ---------- deps + build ----------
log "npm install (next 14.2.20)"
npm install --omit=dev --no-audit --no-fund >>"$LOG" 2>&1 || fail "npm install failed"
log "next build"
npm run build >>"$LOG" 2>&1 || fail "next build failed"

# ---------- launch (detached) ----------
log "next start on :$PORT"
PORT="$PORT" nohup npm start -- -p "$PORT" </dev/null >>"$LOG" 2>&1 &
echo $! > /tmp/nextjs.pid
disown 2>/dev/null || true

# ---------- bounded readiness poll ----------
for i in $(seq 1 36); do   # 36 x 5s = 3 min
  sleep 5
  kill -0 "$(cat /tmp/nextjs.pid)" 2>/dev/null || { tail -30 "$LOG"; fail "app died during boot"; }
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$PORT/" || true)
  if [ "$CODE" = "200" ]; then
    echo "READY http://localhost:$PORT (pid $(cat /tmp/nextjs.pid); protected route /admin; run target/nextjs-cve-lab/detect.sh)" > "$STATUS"
    exit 0
  fi
done
fail "home never returned 200 within 3 min"
