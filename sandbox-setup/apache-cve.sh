#!/usr/bin/env bash
# Runs INSIDE the sandbox. Boots the deliberately-vulnerable Apache lab
# (httpd 2.4.49) demonstrating CVE-2021-41773 path traversal -> RCE. Uses
# Docker (supported in-sandbox). Contract:
#   /tmp/apache_status.txt -> "READY http://localhost:8080" | "FAILED <reason>"
# Log: /tmp/apache.log
set -uo pipefail
STATUS=/tmp/apache_status.txt
LOG=/tmp/apache.log
PORT="${1:-8080}"
SRC=/tmp/sentinel/target/apache-cve-lab

fail() { echo "FAILED $1" > "$STATUS"; tail -30 "$LOG" >> "$STATUS" 2>/dev/null; exit 1; }
log()  { echo "[apache-cve] $*" >> "$LOG"; echo "[apache-cve] $*" > "$STATUS"; }

: > "$LOG"; echo "[apache-cve] $(date -Is) start" > "$STATUS"
command -v docker >/dev/null 2>&1 || fail "docker missing (this lab needs docker-in-sandbox)"
[ -d "$SRC" ] || fail "lab source not found at $SRC (clone the sentinel repo first)"

log "docker build apache-cve-lab:vuln (httpd 2.4.49)"
docker build -t apache-cve-lab:vuln -f "$SRC/Dockerfile" "$SRC" >>"$LOG" 2>&1 || fail "docker build failed"
docker rm -f apache-cve-lab >/dev/null 2>&1 || true
log "docker run on :$PORT"
docker run -d --name apache-cve-lab -p "$PORT:80" apache-cve-lab:vuln >>"$LOG" 2>&1 || fail "docker run failed"

for i in $(seq 1 24); do   # 24 x 5s = 2 min
  sleep 5
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$PORT/" || true)
  if [ "$CODE" = "200" ]; then
    echo "READY http://localhost:$PORT (CVE-2021-41773; run target/apache-cve-lab/detect.sh http://localhost:$PORT)" > "$STATUS"
    exit 0
  fi
done
fail "home never returned 200 within 2 min"
