#!/usr/bin/env bash
# Runs INSIDE the sandbox. Boots the stock vulnerable JetBrains TeamCity
# (2023.11.3) for CVE-2024-27198. Heavy (~GB image, ~2-3 min first boot).
# Contract: /tmp/teamcity_status.txt -> "READY http://localhost:8111" | "FAILED <reason>"
set -uo pipefail
STATUS=/tmp/teamcity_status.txt; LOG=/tmp/teamcity.log; PORT="${1:-8111}"
fail() { echo "FAILED $1" > "$STATUS"; tail -30 "$LOG" >> "$STATUS" 2>/dev/null; exit 1; }
log()  { echo "[teamcity] $*" >> "$LOG"; echo "[teamcity] $*" > "$STATUS"; }
: > "$LOG"; echo "[teamcity] $(date -Is) start" > "$STATUS"
command -v docker >/dev/null 2>&1 || fail "docker missing (needs docker-in-sandbox)"
docker rm -f teamcity-cve >/dev/null 2>&1 || true
log "docker run jetbrains/teamcity-server:2023.11.3 on :$PORT (pulls ~GB)"
docker run -d --name teamcity-cve -u root -p "$PORT:8111" jetbrains/teamcity-server:2023.11.3 >>"$LOG" 2>&1 \
  || fail "docker run failed"
for i in $(seq 1 60); do   # 60 x 5s = 5 min (TeamCity is slow to init)
  sleep 5
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$PORT/" || true)
  case "$CODE" in 200|302|401)
    echo "READY http://localhost:$PORT (CVE-2024-27198; run target/teamcity-cve-lab/detect.sh; may need to click through first-start setup for /app/rest to serve)" > "$STATUS"; exit 0;; esac
done
fail "TeamCity never became reachable within 5 min"
