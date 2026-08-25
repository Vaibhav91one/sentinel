#!/usr/bin/env bash
# Generic in-sandbox lab runner — boots ANY app the operator hands over.
#
# Usage: bash serve-app.sh <source> [port] [status-file]
#   <source>  local dir | local/remote .zip/.tgz | git URL (github/gitlab)
#   [port]    default 3000
#
# Output contract: $STATUS file -> "READY http://localhost:<port>" or "FAILED <reason>"
# Runtime log:     $LOG file
#
# Model-agnostic: the agent runs this one script, reads the status file, and
# proceeds only on READY. No improvisation required for any stack with a
# package.json / requirements.txt / static files.
set -uo pipefail

SRC="${1:?usage: serve-app.sh <dir|zip|tgz|git-url> [port] [status-file]}"
PORT="${2:-3000}"
LAB_STATUS="${3:-/tmp/lab_status.txt}"
export LAB_LOG="${4:-/tmp/lab.log}"
export LAB_DIR="/tmp/lab-app"
export LAB_PIDFILE="/tmp/lab.pid"
export LAB_OUT="/tmp/lab-out.log"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "BOOTSTRAPPING $SRC port=$PORT" > "$LAB_STATUS"
: > "$LAB_LOG"

# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

SECONDS=0
acquire "$SRC" || exit 1
start_app || fail_lab "could not start app"
wait_ready || exit 1

log "artifacts: app=$LAB_DIR out=$LAB_OUT pid=$(cat "$LAB_PIDFILE")"
exit 0
