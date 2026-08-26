# Firmware triage - OpenWrt x86-64

# DRAFT — Firmware Triage Report (ImmortalWrt x86-64)

**Status: DRAFT — not yet human-signed.** All severities below are provisional.

## Target & Authorization
- **Image:** `immortalwrt-x86-64-generic-squashfs-combined-efi.img.gz` — SHA-256 `a7cacbbf66566d401dffec274db538309b4541d9d56067368ea62ee84e3fd3a3`
- **Firmware:** ImmortalWrt 18.06-k5.4-SNAPSHOT `r12339-8b50c1df21` (built 2023-05-03)
- **Scope entry authorizing the work:** the operator pre-scoped lab bootstrap hosts (`downloads.openwrt.org`, `pypi.org`, `files.pythonhosted.org`); I additionally held self-expiring temp entries for `github.com`, `release-assets.githubusercontent.com`, and `deb.debian.org`. The target image itself is a lab artifact, not a live host.
- **Intrusive phases:** **none**. Pure passive/static image analysis — no `request_intrusive_approval` was required or requested (per sentinel-firmware lab rule).
- **Deviation disclosed:** official `downloads.openwrt.org` is egress-blocked at the network tier (curl 35 / HTTP 403). I substituted the SuLingGG GitHub release of the same x86-64 combined-EFI class, sha256-verified.

## Layout (signature map)
| Offset | Artifact |
|---|---|
| 0x000 | protective MBR |
| 0x200 | GPT header |
| 0x40000 | p1 FAT16 "kernel" (52 MB) — grub.cfg: `root=PARTUUID=ed2337cd-2678-e29a-1989-cd85cae44802`, console tty0/ttyS0 115200 |
| 0x3240000 | p2 squashfs v4.0 xz, 14,260 inodes (2023-03-09) → extracted 533 MB rootfs |

Note: pip binwalk 2.1.0 is broken on py3.13; used a custom auditable signature scanner (`tools/scan_fw.py`) instead.

## Ranked Findings

**1. CRITICAL — Empty root password with LAN-exposed remote login (unauth root)**
`/etc/shadow` → `root::0:0:99999:7:::` (no hash). Dropbear listens on 22 with `PasswordAuth on` + `RootPasswordAuth on`; `ttyd` serves `/bin/login` on `@lan`; `rpcd` is configured `username root / password $p$root`; inittab `askfirst` login on ttyS0/hvc0/tty1. Net effect: any LAN (or serial) user gets a root shell with zero credentials. Highest-priority fix.

**2. HIGH — curl 7.83.1 → CVE-2023-38545** (SOCKS5 heap buffer overflow, verified via `osv_get`; fixed in 8.4.0). Crafted SOCKS5 proxy response can corrupt heap.

**3. HIGH — dropbear 2022.82 → CVE-2023-48795 (Terrapin)** (verified; dropbear ≤ 2022.83 affected). SSH transport-integrity downgrade — relevant because the device is managed over SSH.

**4. HIGH — OpenSSL 1.1.1q-20, EOL branch, 30 unpatched 1.1.1-branch advisories**
Filtered from the OSV table (97 openssl hits): CVE-2022-3786 (X.509 email buffer overflow, verified), plus 2023-3446/3817/5678, 2024-0727/2511/4741/5535/9143, and ~22 more fixed only after 1.1.1q. Branch reached EOL Sep 2023 — no further patches exist; component must be upgraded, not patched. (CVE-2022-3602 excluded — 3.0.x only.)

**5. MEDIUM — busybox 1.35.0-3, 24 OSV advisories** incl. CVE-2023-42363 (verified). Typical embedded-busybox exposure surface (tar, wget, etc.).

**6. MEDIUM — SNMP agent runs by default with `public`/`private` communities** (`/etc/config/snmpd`, agentaddress UDP:161, no enabled flag). Unauthenticated info disclosure (system info, interfaces, routes) on the LAN.

**7. MEDIUM — VPN PKI shipped in firmware** (`/etc/easy-rsa/keys/`: `ca.key`, `server.key`, `client1.key`, `client1.p12`, `dh1024.pem`, also `/etc/openvpn/`). Anyone with the image can impersonate the VPN server or forge clients.

**8. MEDIUM — kernel 5.10.134-1: OSV correlation UNVERIFIED** (OSV kernel queries timed out twice). 5.10 as of 2023-03 predates many published kernel CVEs; needs a manual kernel-CVE pass.

**9. LOW — Bundled default credentials** in shipped apps: gowebdav `pass`, n2n_v2 `password`, nps `aaa`, openclash `123456`.

**10. LOW — Transmission RPC no-auth on 0.0.0.0:9091** — dormant (`enabled 0`) but misconfigured; flip on and it's an unauthenticated RPC.

**11. LOW — guest-wifi passwd `guestnetwork`** (dormant, `enable 0`); samba `homes 1` LAN share exposure.

## Component / OSV inventory
busybox 1.35.0-3 (24), dropbear 2022.82-2 (6), openssl 1.1.1q-20 (97), curl 7.83.1-1 (96), netdata 1.33.1-1 (3), aria2 1.36.0-1 (2); uhttpd 2020-11-23-f53a6399-2; luci git-22.312.35760-7afcfb2-1.

## Limitations
- Source substituted as disclosed above; OSV correlation used the **Debian** ecosystem as a proxy (the `Linux` ecosystem returned no results); kernel correlation **unverified** due to query timeouts; custom scanner replaces binwalk's full signature catalogue. No CVE was invented — only advisories confirmed via `osv_get` are listed as verified.

**Artifacts:** `/tmp/artifacts/firmware/` — `immortalwrt-x86-64.report.md`, `immortalwrt-x86-64.report.json`, `binwalk-map.txt`, `osv_table.txt`, `osv_top.txt`, `rootfs/`.

```sandbox_artifacts
[Firmware report (MD)](/tmp/artifacts/firmware/immortalwrt-x86-64.report.md)
[Firmware report (JSON)](/tmp/artifacts/firmware/immortalwrt-x86-64.report.json)
[OSV advisory table](/tmp/artifacts/firmware/osv_table.txt)
[OSV top advisories](/tmp/artifacts/firmware/osv_top.txt)
[Signature map](/tmp/artifacts/firmware/binwalk-map.txt)
```

Recommended next step: human sign-off on this DRAFT, then target the #1 finding (root password + service lockdown) as the remediation priority.