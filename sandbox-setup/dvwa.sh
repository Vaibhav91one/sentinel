#!/usr/bin/env bash
# Runs INSIDE the sandbox. Boots OWASP DVWA (PHP + MariaDB) deterministically.
# Contract: /tmp/dvwa_status.txt -> "READY http://localhost:8081" | "FAILED <reason>"
# Log: /tmp/dvwa.log
set -uo pipefail

STATUS=/tmp/dvwa_status.txt
LOG=/tmp/dvwa.log
PORT=8081
DIR=/tmp/dvwa

fail() { echo "FAILED $1" > "$STATUS"; tail -30 "$LOG" >> "$STATUS" 2>/dev/null; exit 1; }
log() { echo "[dvwa] $*" >> "$LOG"; echo "[dvwa] $*" > "$STATUS"; }

echo "[dvwa] $(date -Is) start" > "$STATUS"
: > "$LOG"

# ---------- 1. packages (Debian mirrors; host must be temporarily scoped) ----------
log "apt install php + mariadb"
export DEBIAN_FRONTEND=noninteractive
(apt-get update -qq \
  && apt-get install -y -qq php-cli php-mysqli php-gd mariadb-server mariadb-client unzip git) \
  >>"$LOG" 2>&1 || fail "apt package install failed"

# ---------- 2. acquire DVWA ----------
rm -rf "$DIR"
git clone --depth 1 https://github.com/digininja/DVWA "$DIR" >>"$LOG" 2>&1 || fail "clone failed"

# ---------- 3. database up ----------
(mysqld_safe --skip-grant-tables=0 >>"$LOG" 2>&1 &) || true
for i in $(seq 1 24); do
  mysqladmin ping >/dev/null 2>&1 && break
  sleep 5
done
mysqladmin ping >/dev/null 2>&1 || fail "mariadb never became ready"
mysql -e "CREATE DATABASE IF NOT EXISTS dvwa; CREATE USER IF NOT EXISTS 'dvwa'@'127.0.0.1' IDENTIFIED BY 'p@ssw0rd'; GRANT ALL ON dvwa.* TO 'dvwa'@'127.0.0.1'; FLUSH PRIVILEGES;" >>"$LOG" 2>&1 || fail "db bootstrap failed"

# ---------- 4. config ----------
cp "$DIR/config/config.inc.php.dist" "$DIR/config/config.inc.php"
sed -i "s/'db_user'  ] = 'root';/'db_user'  ] = 'dvwa';/; s/\$_DVWA\[ 'db_password' \] = 'p@ssw0rd'/\$_DVWA[ 'db_password' ] = 'p@ssw0rd'/" \
  "$DIR/config/config.inc.php" 2>/dev/null || true

# ---------- 5. serve ----------
cd "$DIR"
nohup php -S 127.0.0.1:$PORT </dev/null >>"$LOG" 2>&1 &
echo $! > /tmp/dvwa.pid
disown 2>/dev/null || true

# ---------- 6. readiness ----------
for i in $(seq 1 24); do
  sleep 5
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 8 "http://127.0.0.1:$PORT/login.php" || true)
  if [ "$CODE" = "200" ]; then
    # run DVWA's own table setup via its endpoint
    curl -s "http://127.0.0.1:$PORT/setup.php" >/dev/null
    echo "READY http://localhost:$PORT (login.php 200; admin/admin after setup)" > "$STATUS"
    exit 0
  fi
done
fail "login page never returned 200"
