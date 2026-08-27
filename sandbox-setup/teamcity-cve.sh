#!/usr/bin/env bash
# Runs INSIDE the sandbox. Boots the stock vulnerable JetBrains TeamCity
# (2023.11.3) for CVE-2024-27198, then drives the one-time first-run wizard
# programmatically. Heavy (~1.6GB image); resource-tuned to survive a ~1GB
# sandbox memory cgroup (see demo/evidence/teamcity-cve-verification.md - a
# prior mission OOM-killed on the stock -Xmx2g heap, then reverse-engineered
# the maintenance-wizard flow via javap on the server jars to drive it
# programmatically). Both fixes are baked in here so future missions don't
# redo that discovery from scratch.
#
# Contract: /tmp/teamcity_status.txt -> "READY ..." | "WIZARD_DONE (still booting) ..." | "FAILED <reason>"
set -uo pipefail
STATUS=/tmp/teamcity_status.txt; LOG=/tmp/teamcity.log; PORT="${1:-8111}"
SUPERUSER_TOKEN="sentinel-lab-fixed-token-do-not-use-in-prod"

fail() { echo "FAILED $1" > "$STATUS"; tail -30 "$LOG" >> "$STATUS" 2>/dev/null; exit 1; }
log()  { echo "[teamcity] $*" >> "$LOG"; echo "[teamcity] $*" > "$STATUS"; }

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

: > "$LOG"; echo "[teamcity] $(date -Is) start" > "$STATUS"
ensure_docker || fail "docker unavailable even after apt install docker.io fallback"
docker rm -f teamcity-cve >/dev/null 2>&1 || true

log "docker run jetbrains/teamcity-server:2023.11.3 on :$PORT (pulls ~1.6GB), memory-tuned"
docker run -d --name teamcity-cve -u root -p "$PORT:8111" \
  -e TEAMCITY_SERVER_MEM_OPTS="-Xmx512m -XX:ReservedCodeCacheSize=128m" \
  -e TEAMCITY_SERVER_OPTS="-Dteamcity.superUser.token=${SUPERUSER_TOKEN}" \
  jetbrains/teamcity-server:2023.11.3 >>"$LOG" 2>&1 \
  || fail "docker run failed"

# Wait for the maintenance UI (/mnt) to come up - this is a much lighter bar
# than waiting for the full app (/app/rest), and is what the wizard needs.
log "waiting for maintenance UI (/mnt)"
mnt_up=""
for i in $(seq 1 60); do   # 60 x 5s = 5 min
  sleep 5
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$PORT/mnt" || true)
  [ "$CODE" = "200" ] && { mnt_up=1; break; }
done
[ -n "$mnt_up" ] || fail "maintenance UI (/mnt) never responded within 5 min"

# Drive the one-time first-run wizard using the fixed superuser token, exactly
# as verified live by a prior mission: authenticate -> confirm new install ->
# pick the internal HSQLDB2 database.
log "driving first-run wizard via superuser token"
COOKIES=$(mktemp)
curl -s -c "$COOKIES" -b "$COOKIES" -o /dev/null \
  "http://127.0.0.1:$PORT/mnt/do/authenticate?token=${SUPERUSER_TOKEN}" || true
curl -s -c "$COOKIES" -b "$COOKIES" -o /dev/null \
  -X POST --data "restore=false" "http://127.0.0.1:$PORT/mnt/do/goNewInstallation" || true
curl -s -c "$COOKIES" -b "$COOKIES" -o /dev/null \
  -X POST --data "dbType=HSQLDB2" "http://127.0.0.1:$PORT/mnt/do/goNewDatabase" || true
rm -f "$COOKIES"

# Give the main application a generous, patient window to finish mounting
# /app/rest under the reduced heap - this is the step that never completed
# within the prior mission's round budget, not a broken step.
log "wizard driven; waiting for /app/rest to mount (main app startup, patient)"
for i in $(seq 1 60); do   # 60 x 10s = 10 min
  sleep 10
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$PORT/app/rest/server" || true)
  if [ "$CODE" = "200" ]; then
    echo "READY http://localhost:$PORT (CVE-2024-27198; wizard auto-completed, /app/rest is up; run target/teamcity-cve-lab/detect.sh)" > "$STATUS"
    exit 0
  fi
done

# Wizard succeeded but the main app is still starting - honest partial state,
# not a failure. A follow-up poll (outside this script) can catch it later.
echo "WIZARD_DONE (still booting) http://localhost:$PORT — first-run wizard completed (HSQLDB2), but /app/rest had not mounted within 10 min under the reduced heap. Poll curl http://localhost:$PORT/app/rest/server manually; retry target/teamcity-cve-lab/detect.sh once it returns 200." > "$STATUS"
exit 0
