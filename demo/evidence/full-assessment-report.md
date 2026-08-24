# Sentinel full assessment - 2026-08-24T20:13:45.583Z

Assessment complete end-to-end. Here's the summary.

## Workflow executed (sentinel-recon Phase 0 lab)

1. **Lab build** — Cloned `Vaibhav91one/sentinel` into the sandbox, installed Node (18.20.4 via Debian apt), started `target/vuln-app.mjs` on `127.0.0.1:3000`.
2. **Scope gate** — `scope_check http://localhost:3000` → **allowed**, matched scope entry `localhost` (loopback).
3. **Passive fingerprint (Phase 1)** — No approval needed. Captured banner `sentinel-target/0.1.0 nodejs/22 express-lookalike`, `X-Powered-By: Express-wannabe`, body leaks (`/admin`, `/api/users`, debug TODO). Logged to `localhost.recon.jsonl`.
4. **Active phase (human-approved)** — `request_intrusive_approval` returned grant token; embedded as `SENTINEL_GRANT=…` in all active commands:
   - Port sweep: `nmap -Pn -sV -T3 --top-ports 100` → only **3000/tcp open**, 99 closed (nmap couldn't ID the service; custom banner).
   - Web probes: 9 curated routes, 1s apart → `/.env`, `/admin`, `/api/users`, `/.git/HEAD`, `/backup.sql` all **200**; `/.git/config`, `/console`, `/robots.txt` **404**. Full bodies captured as evidence.
5. **CVE correlation (sentinel-triage)** — `osv_query nodejs@Debian 18.20.4` → 54 advisories; precisely filtered against installed `18.20.4+dfsg-1~deb12u2`: **21 fixed**, **16 list this exact version as unfixed** (CVE-2026-21717/48618/48619/48928/48930/48931/48933/48934/48937, 56846/56848/56850, 58040/58042/58044/58045). `osv_get` on the promising ones shows upstream advisories target supported lines (22/24/26) and components this app doesn't use (TLS, HTTP/2, WebCrypto, DNS, client agents) → **no CVE confirmed exploitable**; runtime exposure marked unverified. `express` CVEs: none — the banner is a decoy, source is a raw `node:http` server.

## Key findings (ranked)

| Severity | Finding |
|---|---|
| High | Exposed `/.env` (DB password, Stripe key, JWT secret) |
| High | Unauthenticated `/admin` panel (users + roles) |
| High | Unauthenticated `/api/users` (records incl. `api_key`) |
| Medium | Exposed `/backup.sql` dump · exposed `/.git/HEAD` |
| Medium | EOL Node 18.20.4, 16 unfixed advisories (unverified for this surface) |
| Low/Info | Verbose/misleading banner, missing security headers, debug TODO |

## Authorization statement

- **Scope entry that authorized the work:** `localhost` (default allowlist; target `http://localhost:3000`, loopback class).
- **Intrusive phases human-approved:** Yes — port sweep + web probes were explicitly approved via `request_intrusive_approval`, grant token embedded in every active command. No out-of-scope contact occurred; no cloud-metadata endpoints touched.

All artifacts (no raw dumps in chat, per policy):

```sandbox_artifacts
[Findings report (Markdown)](/tmp/sentinel-artifacts/localhost.report.md)
[Findings report (JSON)](/tmp/sentinel-artifacts/localhost.report.json)
[Passive recon log](/tmp/sentinel-artifacts/localhost.recon.jsonl)
[Web probe log](/tmp/sentinel-artifacts/localhost.web.jsonl)
[nmap port sweep output](/tmp/sentinel-artifacts/localhost-nmap.nmap)
[Evidence: /.env](/tmp/sentinel-artifacts/evidence/.env.txt)
[Evidence: /api/users](/tmp/sentinel-artifacts/evidence/api-users.txt)
[Evidence: /admin](/tmp/sentinel-artifacts/evidence/admin.txt)
[Evidence: /backup.sql](/tmp/sentinel-artifacts/evidence/backup.sql.txt)
```

One honest caveat worth repeating: every high-severity finding here is an intentional planted misconfiguration in a demo app with **fake** data, and the CVE layer is **not confirmed exploitable** — the runtime finding is an EOL/update-debt issue rather than a proven remote exploit.