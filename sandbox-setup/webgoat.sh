#!/usr/bin/env bash
# Runs INSIDE the sandbox. Boots OWASP WebGoat (Java) deterministically.
# Contract: /tmp/webgoat_status.txt -> "READY http://localhost:8080" | "FAILED <reason>"
# Log: /tmp/webgoat.log
set -uo pipefail

STATUS=/tmp/webgoat_status.txt
LOG=/tmp/webgoat.log
PORT=8080
DIR=/tmp/webgoat-runtime

fail() { echo "FAILED $1" > "$STATUS"; tail -30 "$LOG" >> "$STATUS" 2>/dev/null; exit 1; }
log() { echo "[webgoat] $*" >> "$LOG"; echo "[webgoat] $*" > "$STATUS"; }

echo "[webgoat] $(date -Is) start" > "$STATUS"
: > "$LOG"

# ---------- 1. Java runtime (Temurin JRE via GitHub releases - in-scope host) ----------
if ! command -v java >/dev/null 2>&1; then
  log "fetching Temurin JRE 21"
  mkdir -p /opt/jre
  ASSET_URL=$(curl -sSL https://github.com/adoptium/temurin21-binaries/releases/latest \
    | grep -oE 'href="[^"]*OpenJDK21U-jre_x64_linux_hotspot_[^"]*\.(zip|tar\.gz)"' \
    | head -1 | sed 's/^href="//; s/"$//')
  [ -n "$ASSET_URL" ] || fail "no Temurin JRE asset found"
  F="https://github.com${ASSET_URL}"
  BF=$(basename "$F")
  curl -sSL --retry 3 -o "/tmp/$BF" "$F" >>"$LOG" 2>&1 || fail "JRE download failed"
  case "$BF" in
    *.zip) unzip -q "/tmp/$BF" -d /opt/jre || fail "unzip failed" ;;
    *) tar xf "/tmp/$BF" -C /opt/jre --strip-components=1 || fail "untar failed" ;;
  esac
  export JAVA_HOME=$(find /opt/jre -maxdepth 1 -type d -name 'jdk*' | head -1)
  export PATH="$JAVA_HOME/bin:$PATH"
fi
command -v java >/dev/null 2>&1 || fail "java still missing after bootstrap"
log "java: $(java -version 2>&1 | head -1)"

# ---------- 2. WebGoat executable jar ----------
cd /tmp
WG_JAR_URL=$(curl -sSL https://github.com/WebGoat/WebGoat/releases/latest \
  | grep -oE 'href="[^"]*webgoat[^"]*\.jar"' | head -1 | sed 's/^href="//; s/"$//')
[ -n "$WG_JAR_URL" ] || fail "no webgoat jar asset found"
WG_JAR="https://github.com$WG_JAR_URL"
WG_FILE=$(basename "$WG_JAR_URL")
log "downloading $WG_FILE"
curl -sSL --retry 3 -o "/tmp/$WG_FILE" "$WG_JAR" >>"$LOG" 2>&1 || fail "jar download failed"

# ---------- 3. launch (detached; WebGoat serves :8080 + WebWolf :9090) ----------
mkdir -p "$DIR"
export JAVA_OPTS="-Xmx600m"
nohup java -jar "/tmp/$WG_FILE" --server.port=$PORT --webgoat.port=$PORT \
  </dev/null >>"$LOG" 2>&1 &
echo $! > /tmp/webgoat.pid
disown 2>/dev/null || true

# ---------- 4. readiness poll (JVM boot is slow: up to 5 min) ----------
for i in $(seq 1 60); do
  sleep 5
  kill -0 "$(cat /tmp/webgoat.pid)" 2>/dev/null || { log "--- tail ---"; tail -40 "$LOG"; fail "jvm died during boot"; }
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 8 "http://127.0.0.1:$PORT/WebGoat/login" || true)
  if [ "$CODE" = "200" ] || [ "$CODE" = "302" ]; then
    echo "READY http://localhost:$PORT (pid $(cat /tmp/webgoat.pid), $(basename $WG_FILE))" > "$STATUS"
    exit 0
  fi
done
fail "WebGoat never returned 200 within 5 min"
