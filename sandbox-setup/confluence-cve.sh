#!/usr/bin/env bash
# Runs INSIDE the sandbox. Brings up the Confluence CVE-2023-22515 lab via
# docker compose (Confluence 8.5.1 + Postgres). NOTE: Confluence is NOT
# headless — it needs a trial license entered once via the web UI on first
# boot before the app (and the CVE) are live. This script only starts the
# stack and waits for the setup page to respond.
# Contract: /tmp/confluence_status.txt -> "SETUP http://localhost:8090 ..." | "FAILED <reason>"
set -uo pipefail
STATUS=/tmp/confluence_status.txt; LOG=/tmp/confluence.log; PORT=8090
SRC=/tmp/sentinel/target/confluence-cve-lab
fail(){ echo "FAILED $1" > "$STATUS"; tail -30 "$LOG" >> "$STATUS" 2>/dev/null; exit 1; }
: > "$LOG"; echo "[confluence] $(date -Is) start" > "$STATUS"
command -v docker >/dev/null 2>&1 || fail "docker missing"
[ -d "$SRC" ] || fail "lab source not found at $SRC"
(cd "$SRC" && docker compose up -d) >>"$LOG" 2>&1 || fail "docker compose up failed"
for i in $(seq 1 72); do sleep 5   # 6 min — Confluence is very slow to start
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$PORT/" || true)
  case "$CODE" in 200|302)
    echo "SETUP http://localhost:$PORT — complete the trial-license wizard once in the UI, then run target/confluence-cve-lab/detect.sh http://localhost:$PORT" > "$STATUS"; exit 0;; esac
done
fail "Confluence never responded within 6 min"
