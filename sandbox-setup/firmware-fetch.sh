#!/usr/bin/env bash
# Runs INSIDE the sandbox. Firmware triage bootstrap: fetch a sample image +
# install binwalk. Generic: pass any firmware URL or skip to use the bundled
# OpenWrt x86 sample (downloads.openwrt.org must be temporarily scoped).
#
# Usage: firmware-fetch.sh [url]     # default: OpenWrt 23.05.5 x86-64 combined image
set -uo pipefail

STATUS=/tmp/firmware_status.txt
LOG=/tmp/fw.log
mkdir -p /tmp/artifacts/firmware

fail() { echo "FAILED $1" > "$STATUS"; tail -20 "$LOG" >> "$STATUS"; exit 1; }
log() { echo "[fw] $*" >> "$LOG"; echo "[fw] $*" > "$STATUS"; }

URL="${1:-https://downloads.openwrt.org/releases/23.05.5/targets/x86/64/openwrt-23.05.5-x86-64-generic-ext4-combined-efi.img.gz}"

log "fetching $URL"
F=/tmp/artifacts/firmware/target.img.gz
curl -sSL --retry 3 -o "$F" "$URL" >>"$LOG" 2>&1 || fail "download failed"
gunzip -f "$F" || fail "gunzip failed"

pip3 install -q binwalk >>"$LOG" 2>&1 || log "binwalk pip install had warnings"

echo "READY /tmp/artifacts/firmware/target.img (run binwalk per sentinel-firmware skill)" > "$STATUS"
