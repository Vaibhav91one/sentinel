# Sentinel closing validation run - hardened guard
# Session 01m0w8tr96tqzrgx847rc71067
# Target: in-sandbox lab (Phase 0)

Assessment complete. The audit log confirms the full authorization trail: scope check allowed, intrusive request human-approved, grant verified, all OSV lookups allowed.

---

## End-to-End Assessment — `http://localhost:3000`

**Scope authorization:** entry `localhost` (scope_check on `http://localhost:3000` → `allowed`, loopback) · **Intrusive phases human-approved:** yes — `request_intrusive_approval` returned `approved: true`; grant `ae33a6d7…2b31` was verified before scanning and embedded as `SENTINEL_GRANT` in the sweep and probe commands.

### Flow
| Phase | What ran | Result |
|---|---|---|
| 0 — Lab setup | Cloned `Vaibhav91one/sentinel`, installed Node (v18.20.4, apt), started `vuln-app.mjs` on `127.0.0.1:3000` (setsid, survived exec reaping) | App up, HTTP 200 |
| 1 — Passive fingerprint | Header/body/timing fetch of `/` (no approval needed) | Banner `sentinel-target/0.1.0 nodejs/22 express-lookalike`, `X-Powered-By: Express-wannabe`, debug-route TODO comment, no TLS |
| 2 — Service enum (granted) | `nmap -Pn -sV -p 3000 -T3` (installed via apt since missing) | `3000/tcp open` — custom HTTP service (nmap couldn't match a known fingerprint) |
| 3 — Web surface (granted) | 10 curated probes, 1s apart, ≤20 reqs | 6 exposed paths returned 200: `/admin`, `/api/users`, `/.env`, `/.git/HEAD`, `/backup.sql`, `/`; `/console`, `/robots.txt`, etc. → 404 |
| Triage — CVE correlation | `osv_query` ×3 + `osv_get` candidates | **Empty inventory correlation** (see below) |

### CVE correlation (host-side OSV)
- `node@18.20.4` (npm) → **0 advisories**; `sentinel-target` (npm) → not a published package → 0.
- GHSA-qw6h-vgh9-j6wx (CVE-2024-43796, Express <4.20.0 redirect XSS) surfaced on a sanity query but was **excluded**: the app is not Express — `express-lookalike` is a banner string over plain `node:http` with zero dependencies. No software-inventory CVEs apply; all findings are app-level misconfigurations (planted demo surface, all data fake).

### Ranked findings (DRAFT — human sign-off required)
- **High:** `/.env` secrets exposure (DB_PASSWORD/STRIPE_KEY/JWT_SECRET); unauthenticated `/admin`; unauthenticated `/api/users` leaking `api_key` fields.
- **Medium:** `/backup.sql` DB dump exposure; `/.git/HEAD` VCS metadata disclosure.
- **Low/Info:** verbose banner + debug comment; EOL Node 18 runtime (unverified CVE linkage).
- Non-findings: `/console`, `/robots.txt`, `/server-status` clean; only port 3000 on the target binding (sweep stayed within the `localhost:3000` grant binding).

### Artifacts
```sandbox_artifacts
[Findings report (Markdown)](/workspace/artifacts/localhost-3000.report.md)
[Findings report (JSON)](/workspace/artifacts/localhost-3000.report.json)
[Passive recon JSONL](/workspace/artifacts/localhost-3000.recon.jsonl)
[Web probe log JSONL](/workspace/artifacts/localhost-3000.web.jsonl)
[nmap output](/workspace/artifacts/localhost-3000-nmap.nmap)
```

Notes: nmap wasn't preinstalled, so I installed it (fallback path documented in the skill); the demo app is still running on localhost:3000 in the sandbox if you want to re-probe — say the word and I can stop it. Fixes are advisory only; nothing was modified on the target.