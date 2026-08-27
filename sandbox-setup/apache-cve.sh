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

# Docker isn't guaranteed present in every sandbox instance (confirmed absent
# at least twice this session, even though docker-in-sandbox is supported) -
# try installing it before failing outright.
ensure_docker() {
  command -v docker >/dev/null 2>&1 && return 0
  log "docker missing, attempting apt install docker.io"
  apt-get update -qq >>"$LOG" 2>&1 && apt-get install -y -qq docker.io >>"$LOG" 2>&1 || return 1
  command -v dockerd >/dev/null 2>&1 || return 1
  nohup dockerd >>"$LOG" 2>&1 &
  for i in $(seq 1 20); do docker info >/dev/null 2>&1 && return 0; sleep 1; done
  return 1
}

: > "$LOG"; echo "[apache-cve] $(date -Is) start" > "$STATUS"
ensure_docker || fail "docker unavailable even after apt install docker.io fallback"
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
