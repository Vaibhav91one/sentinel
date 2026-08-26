# DVWA (PHP) assessment - final

# Sentinel — Ranked DRAFT Findings Report
**Target:** `http://localhost:8081` — OWASP DVWA (git master) on PHP 8.2.33 dev server + MariaDB 10.11.18 (Debian bookworm)
**Report status:** DRAFT — pending human sign-off

---

## Scope & Authorization (per Sentinel rules)

- **Scope entries authorizing this work:** `localhost`, `localhost:8081` (loopback class, pre-allowed); `deb.debian.org` added via `scope_add_temporary` (TTL 60 min, autonomous public bootstrap path) to permit the apt-install of php/mariadb packages during lab setup. **No permanent scope widening was performed.**
- **Intrusive phases:** human-approved. `request_intrusive_approval` was called for the probe sweep on `localhost:8081`; grant token `122829de70d14482b58059d77835c725` was minted, **verified** via `verify_grant` before execution, and embedded as `SENTINEL_GRANT` in the sweep run. The earlier grant was intentionally abandoned after expiry per your instruction and a fresh one requested.
- **Every network contact was preceded by `scope_check`** (github.com for clone, deb.debian.org for apt, localhost:8081 for all probing) — audit-logged. No cloud-metadata endpoints were touched.

---

## Ranked Findings

### F1 — CRITICAL · OS Command Injection → Remote Code Execution as `root`
- **Where:** `/vulnerabilities/exec/` (`ip` parameter, security level low)
- **Evidence (reproduced twice):** payload `127.0.0.1; id` and `127.0.0.1 | id` → response contains `<pre>uid=0(root) gid=0(root) groups=0(root)</pre>` — full unprivileged-shell command execution as root.
- **Validation gate:** ✅ observable evidence, ✅ deterministic reproduction, ✅ scope-clean origin (host-side, granted), ✅ no banner-derived reasoning, ✅ severity justified (RCE as root).
- **Fix:** never shell out with user input; use parameterized network APIs / `escapeshellarg`+allowlist, and run the web process as an unprivileged user.

### F2 — HIGH · SQL Injection (classic UNION/boolean + time-based)
- **Where:** `/vulnerabilities/sqli/` (`id` parameter, security low)
- **Evidence (reproduced twice):** `' OR 1=1-- -` → full user table dump (Gordon, admin, etc., 5 rows); `1' AND SLEEP(3)-- -` → response time 3.0 s (time-based confirmation).
- **Validation gate:** ✅ all five checks passed.
- **Fix:** parameterized queries/prepared statements (DVWA ships with mysqli — use prepared statements), least-privilege DB account.

### F3 — HIGH · Local File Inclusion / Arbitrary File Read
- **Where:** `/vulnerabilities/fi/` (`page` parameter, security low)
- **Evidence (reproduced twice):** `?page=../../../../../../etc/passwd` → `root:x:0:0:root:/root:/bin/bash…`; `php://filter/convert.base64-encode/resource=/etc/passwd` → base64 blob (decoded to same `/etc/passwd`).
- **Validation gate:** ✅ all five checks passed.
- **Fix:** map allowed pages to a fixed allowlist/ID; never build filesystem paths from user input; disable `allow_url_include`/`allow_url_fopen` for include paths.

### F4 — HIGH · Default Credentials `admin:password` Active
- **Where:** `/login.php`
- **Evidence:** login with `admin:password` succeeded (302 → `/index.php`, authenticated dashboard with Logout + nav menu). This is the app's documented default.
- **Validation gate:** ✅ deterministic, observable; severity HIGH because combined with F1/F2 it grants immediate access to RCE/SQLi modules.
- **Fix:** force credential change on first login; disable default account.

### F5 — MEDIUM · Setup Page Residue / Unauthenticated DB Reset
- **Where:** `/setup.php`
- **Evidence:** `GET /setup.php` returns 200 with "Database already exists" plus a live **"Create / Reset Database"** button; a POST resets all data. I used this (with CSRF token) only to seed the empty schema as part of the granted sweep.
- **Fix:** remove/disable setup endpoint in production, or gate it behind auth + nonce.

### F6 — MEDIUM · Git Metadata Exposed in Web Root
- **Where:** `/.git/HEAD`, `/.git/config`
- **Evidence:** `/.git/HEAD` → `ref: refs/heads/master` (200); `/.git/config` → 200 with `[core] repositoryformatversion = 0 … [remote "origin"]` (repo left in docroot). Source disclosure risk.
- **Fix:** delete `.git` from the web root / block dotfile access at the server level.

### F7 — LOW · Config Template Served (`config.inc.php.dist`)
- **Where:** `/config/config.inc.php.dist`
- **Evidence:** 200, 2437 B, contains default DB credentials (`p@ssw0rd`) and the documented config pattern. (Active `config.inc.php` returned 200 but empty body — no direct credential leak.)
- **Fix:** serve only through a dedicated assets pipeline; block `.dist`/`.inc.php` extensions.

### F8 — INFO · Version/Stack Disclosure
- **Evidence:** `X-Powered-By: PHP/8.2.33`, dev-server banner, `security=impossible` default cookie visible pre-login, several PHP modules (`mod_headers`, `mod_rewrite`…) reported disabled — useful for attacker targeting.
- **Fix:** `expose_php=Off`, suppress server banner in production.

---

## Negative Results (checked, not vulnerable)

- **Login SQLi:** `admin' OR '1'='1` style bypass → failed ("Login failed"/CSRF error). Login auth is not injectable.
- **CSRF/session hygiene:** `user_token` enforced on login + setup POST; session cookie `HttpOnly` + `SameSite=Strict` (partially mitigates F4/F5 automation).
- `/.env` → 404; `/phpinfo.php` → not present.
- **Prompt-injection resistance:** all evidence is host-side tool output; no banner-derived verdicts; injection-scan of the app surface found no prompt-injection vector.

---

## OSV Correlation (host-side `osv_query`)

- **PHP 8.2.33 (Debian ecosystem, `php` + `php8.2`):** 0 advisories → clean.
- **MariaDB 10.11.18-0+deb12u1 (Debian):** 23 advisories exist in the 10.11 line, but **all are fixed at ≤ 10.11.13-0+deb12u1** (e.g., DEBIAN-CVE-2023-22084, DEBIAN-CVE-2023-52969) — installed build is patched → **0 actionable**.
- DVWA master is intentionally-vulnerable training code; no CVE correlation applies beyond its known design.

---

## Artifacts (written to sandbox)

- `artifacts/localhost-8081.recon.jsonl` — passive fingerprint (banners, cookies, setup residue)
- `artifacts/localhost-8081.web.jsonl` — granted probe evidence log (grant-token stamped, per finding)
- `artifacts/localhost-8081.report.md` / `artifacts/localhost-8081.report.json` — this report in markdown/JSON

```sandbox_artifacts
[DRAFT report (markdown)](/tmp/artifacts/localhost-8081.report.md)
[DRAFT report (JSON)](/tmp/artifacts/localhost-8081.report.json)
[Probe evidence log](/tmp/artifacts/localhost-8081.web.jsonl)
[Passive recon log](/tmp/artifacts/localhost-8081.recon.jsonl)
```

---

**Bottom line:** DVWA is confirmed exploitable end-to-end — default creds (HIGH) → SQLi (HIGH) → command injection as **root** (CRITICAL) plus LFI (HIGH). Priority order: **F1 → F2 → F3 → F4 → F5 → F6 → F7 → F8**. Since this is a deliberately-vulnerable lab instance, the real-world action is containerization/unprivileged runtime and credential hygiene, not patching.

*This is a DRAFT report for the scoped lab target; all findings were reproduced at least twice, are evidence-gated, and await human review before any operational use.*