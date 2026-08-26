#!/usr/bin/env bash
# Shared helpers for in-sandbox lab bootstrapping. Sourced, not executed.
# All network here targets allow-listed package transports only.

log() { echo "[lab] $*" >> "${LAB_LOG:-/tmp/lab.log}"; }

# Pre-baked image fast-path: when the sandbox already ships the lab stack
# (custom snapshot/image with /opt/sentinel-lab/.prebaked), every bootstrap
# becomes a no-op.
PREBAKED=""
[ -f /opt/sentinel-lab/.prebaked ] && PREBAKED=1 && export PATH="/opt/node22/bin:$PATH"

fail_lab() {
  echo "FAILED $1" > "$LAB_STATUS"
  echo "--- log tail ---" >> "$LAB_STATUS"
  tail -40 "${LAB_LOG:-/tmp/lab.log}" >> "$LAB_STATUS" 2>/dev/null
  exit 1
}

# Ensure a usable Node.js (22 via official tarball from nodejs.org).
ensure_node22() {
  [ -n "$PREBAKED" ] && { log "prebaked image: node assumed present"; return 0; }
  command -v node >/dev/null 2>&1 && { log "system node $(node -v)"; return 0; }
  log "bootstrapping Node 22 from nodejs.org/dist"
  local NV
  NV=$(curl -fsSL https://nodejs.org/dist/index.json \
       | grep -oE '"version":"v22\.[0-9]+\.[0-9]+"' | head -1 \
       | grep -oE 'v[0-9.]+')
  [ -n "$NV" ] || fail_lab "could not resolve Node 22 version"
  local f="node-$NV-linux-x64.tar.xz"
  mkdir -p /opt/node22
  curl -fsSL "https://nodejs.org/dist/$NV/$f" -o "/tmp/$f" || fail_lab "nodejs.org download failed"
  tar xJf "/tmp/$f" -C /opt/node22 --strip-components=1 || fail_lab "tar extract failed"
  export PATH="/opt/node22/bin:$PATH"
  command -v node >/dev/null 2>&1 || fail_lab "node binary did not run after extract"
  log "using $(node -v) at /opt/node22"
}

# Acquire <src> into $LAB_DIR. Accepts:
#   local directory | local .zip/.tgz | https URL ending .zip/.tgz | https git URL
acquire() {
  local src="$1"
  rm -rf "$LAB_DIR"; mkdir -p "$LAB_DIR"

  if [ -d "$src" ]; then
    cp -r "$src"/. "$LAB_DIR"/ && return 0
  fi

  case "$src" in
    *.git|https://github.com/*|https://gitlab.com/*|git@*)
      git clone --depth 1 "$src" "$LAB_DIR" >>"${LAB_LOG}" 2>&1 || fail_lab "git clone failed: $src"
      return 0 ;;
    *.zip|*.tgz|*.tar.gz)
      local f="$LAB_DIR/$(basename "$src")"
      curl -sSL --retry 3 -o "$f" "$src" || fail_lab "download failed: $src"
      case "$f" in
        *.zip) unzip -q "$f" -d "$LAB_DIR" || fail_lab "unzip failed" ;;
        *) tar xf "$f" -C "$LAB_DIR" || fail_lab "untar failed" ;;
      esac
      # flatten single top-level dir
      local sub
      sub=$(find "$LAB_DIR" -mindepth 1 -maxdepth 1 -type d | head -1)
      if [ "$(find "$LAB_DIR" -mindepth 1 -maxdepth 1 | wc -l)" = "1" ] && [ -d "$sub" ]; then
        shopt -s dotglob; mv "$sub"/* "$LAB_DIR"/; rmdir "$sub"; shopt -u dotglob
      fi
      return 0 ;;
    *)
      # treat as a plain URL/file pointing at an archive we cannot classify
      fail_lab "unsupported source: $src (use dir, git URL, or .zip/.tgz)" ;;
  esac
}

# Detect and start the app on $PORT. Writes PID to $LAB_PIDFILE.
start_app() {
  cd "$LAB_DIR" || fail_lab "lab dir missing"

  if [ -f package.json ]; then
    ensure_node22
    log "node app detected"
    npm install --omit=dev --no-audit --no-fund >>"${LAB_LOG}" 2>&1 || log "npm install reported errors (continuing)"
    local entry
    entry=$(find . -path ./node_modules -prune -o -maxdepth 2 -type f \( -name server.js -o -name app.js -o -name index.js \) -print 2>/dev/null | head -1)
    local start_script
    start_script=$(node -e "try{console.log(require('./package.json').scripts.start||'')}catch(e){}" 2>/dev/null)
    if [ -n "$start_script" ]; then
      nohup npm start >"$LAB_OUT" 2>&1 &
    elif [ -n "$entry" ]; then
      nohup node "$entry" >"$LAB_OUT" 2>&1 &
    else
      log "package.json without start script or discoverable entry"
      return 1
    fi
    echo $! > "$LAB_PIDFILE"
    return 0
  fi

  if [ -f requirements.txt ] || ls *.py >/dev/null 2>&1; then
    log "python app detected"
    local py_entry
    py_entry=$(ls main.py app.py server.py 2>/dev/null | head -1)
    [ -n "$py_entry" ] || py_entry=$(find . -maxdepth 2 -name "*.py" | head -1)
    [ -n "$py_entry" ] || { log "no python entry found"; return 1; }
    (pip3 install -q -r requirements.txt 2>>"${LAB_LOG}" || true)
    nohup python3 "$py_entry" >"$LAB_OUT" 2>&1 &
    echo $! > "$LAB_PIDFILE"
    return 0
  fi

  # fallback: static hosting of whatever is there
  log "no recognized app; serving directory statically"
  nohup python3 -m http.server "$PORT" --bind 127.0.0.1 >"$LAB_OUT" 2>&1 &
  echo $! > "$LAB_PIDFILE"
  return 0
}

# Poll until the port answers (any HTTP code counts as listening).
wait_ready() {
  local deadline=$((SECONDS + 240))
  while [ $SECONDS -lt $deadline ]; do
    kill -0 "$(cat "$LAB_PIDFILE" 2>/dev/null)" 2>/dev/null || fail_lab "app process died during boot (see $LAB_OUT)"
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$PORT/" || true)
    case "$code" in
      000|"") sleep 3 ;;
      *) log "READY (HTTP $code after ${SECONDS}s)"; echo "READY http://localhost:$PORT (HTTP $code)" > "$LAB_STATUS"; return 0 ;;
    esac
  done
  fail_lab "port $PORT never answered within 240s"
}
