# Sentinel multi-target assessment (Juice Shop + DSVW + VAmPI)

Assessment complete — all 35 requests logged, every finding passes the 5-check validation gate. Final report:

---

## VAmPI Assessment Summary (localhost:5000)

**(1) Fingerprint** — Server `Werkzeug/2.2.3 Python/3.13.15`; Flask 2.2.2 + Connexion 2.14.2 + SQLAlchemy 2.0.41 + PyJWT 2.6.0; **zero security headers** (no CSP/HSTS/X-Content-Type-Options/X-Frame-Options); 12 endpoints from `/openapi.json` (books keyed by *title*, password change is `PUT /users/v1/{username}/password`; `/resetpassword`, `/debug`, `/changelog` are 404). Flask `debug=True`.

**(2) Confirmed findings** (OWASP API Top 10, all `verified:true`, evidence in `vampi.web.jsonl`):

- **CRITICAL — Mass Assignment / privilege escalation (API6:2019→BFLA)** — `POST /users/v1/register` with `"admin":true` creates admin user (c_X → `GET /me` returns `admin:true`); enables deleting any user. Evidence: `/me` response.
- **CRITICAL — SQL Injection (API1/BOLA vector, A03:2021)** — `GET /users/v1/{username}` builds raw SQL; `' UNION SELECT 99,'u','p','e',0-- ` returned `{"username":"u","email":"e"}`; `x' OR username='admin'-- ` exfiltrated the admin row; lone `'` → 500. Unauthenticated.
- **CRITICAL — JWT forgery / Broken Authentication (API2)** — `SECRET_KEY='random'` hardcoded (`config.py`); forged HS256 token `sub=admin` → `GET /me` 200 admin. Full auth bypass.
- **CRITICAL — BOLA on password change (API1)** — `PUT /users/v1/{username}/password` with *any* valid token changes any user's password (B changed name1's, then logged in as name1). Account takeover.
- **HIGH — BOLA (API1)** — `GET /books/v1/{book_title}`: user B read user A's book secret (`TOP-SECRET-OF-A`) with B's token.
- **HIGH — Excessive Data Exposure (API3)** — `GET /users/v1/_debug` (no auth) returns all users incl. plaintext passwords + admin flags (full capture: `users_v1__debug-full.json`).
- **MEDIUM — Debug mode / info disclosure (API8/API3)** — unhandled errors return Werkzeug HTML tracebacks (`sqlalchemy.exc.OperationalError`); debugger console w/ PIN exposed; missing security headers.
- **MEDIUM — User/password enumeration (API2)** — login differentiates `Username does not exist` vs `Password is not correct for the given username.`
- **Unverified lead (source-only, not probed to avoid DoS):** ReDoS regex in `PUT /users/v1/{username}/email` (API4).

**CVE correlation** (`vampi.cve.jsonl`): 0 matches for Connexion/SQLAlchemy; Flask (CVE-2023-30861, CVE-2026-27205) and PyJWT (CVE-2026-32597, CVE-2026-48522, CVE-2026-48524, CVE-2026-48526, CVE-2025-45768) **match versions but code paths are not exercised** (no Flask sessions/caching proxy; no PyJWKClient/JWK/crit) → informational only, not reported as exploitable.

**(3) Artifacts** (all in `/tmp/artifacts/`): `vampi.recon.jsonl`, `vampi.web.jsonl` (35 requests), `vampi.cve.jsonl`, `vampi-openapi.json`, `users_v1__debug-full.json`, `headers_root.txt`, `probe_vampi.py`.

```sandbox_artifacts
[vampi.recon.jsonl](/tmp/artifacts/vampi.recon.jsonl)
[vampi.web.jsonl](/tmp/artifacts/vampi.web.jsonl)
[vampi.cve.jsonl](/tmp/artifacts/vampi.cve.jsonl)
[users_v1__debug-full.json](/tmp/artifacts/users_v1__debug-full.json)
[vampi-openapi.json](/tmp/artifacts/vampi-openapi.json)
[headers_root.txt](/tmp/artifacts/headers_root.txt)
```