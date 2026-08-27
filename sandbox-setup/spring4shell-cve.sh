#!/usr/bin/env bash
# Runs INSIDE the sandbox. Builds + boots the Spring4Shell (CVE-2022-22965)
# lab via docker (multi-stage Maven build). Heavy first build (Maven deps).
# Contract: /tmp/spring_status.txt -> "READY http://localhost:8080" | "FAILED <reason>"
set -uo pipefail
STATUS=/tmp/spring_status.txt; LOG=/tmp/spring.log; PORT="${1:-8080}"
SRC=/tmp/sentinel/target/spring4shell-cve-lab
fail(){ echo "FAILED $1" > "$STATUS"; tail -30 "$LOG" >> "$STATUS" 2>/dev/null; exit 1; }
log(){ echo "[spring4shell] $*" >> "$LOG"; echo "[spring4shell] $*" > "$STATUS"; }

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

: > "$LOG"; echo "[spring4shell] $(date -Is) start" > "$STATUS"
ensure_docker || fail "docker unavailable even after apt install docker.io fallback"
[ -d "$SRC" ] || fail "lab source not found at $SRC"
log "docker build spring4shell-lab (maven build + tomcat)"
docker build -t spring4shell-lab -f "$SRC/Dockerfile" "$SRC" >>"$LOG" 2>&1 || fail "docker build failed"
docker rm -f spring4shell-lab >/dev/null 2>&1 || true
docker run -d --name spring4shell-lab -p "$PORT:8080" spring4shell-lab >>"$LOG" 2>&1 || fail "docker run failed"
for i in $(seq 1 36); do sleep 5
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$PORT/greeting?name=x" || true)
  [ "$CODE" = "200" ] && { echo "READY http://localhost:$PORT (CVE-2022-22965; run target/spring4shell-cve-lab/detect.sh http://localhost:$PORT /greeting)" > "$STATUS"; exit 0; }
done
fail "/greeting never returned 200 within 3 min"
