# VAmPI assessment (complete)

# VAmPI API Security Assessment — Ranked DRAFT Report

**Authorization:** Work was authorized by scope entry **`localhost:5000`** (`scope_check` passed before every contact; entry present in the allowlist). All active/intrusive phases were **human-approved** — four `request_intrusive_approval` grants were issued (`c89ca17d`, `61c36238`, `dc01ed97` verified consumed after their runs; `3aea4c52` expired before any network contact) and each probe command embedded its `SENTINEL_GRANT`. No out-of-scope contact, no cloud metadata endpoints touched. Full report saved to `/tmp/vampi/artifacts/FINAL_report.md`; raw evidence per probe in `/tmp/vampi/artifacts/NN_*.txt`.

**Target:** VAmPI (erev0s/VAmPI, `vulnerable=1`) — Connexion 2.14.2 / Flask 2.2.2 / Werkzeug 2.2.3 (debug) / PyJWT 2.6.0 / SQLAlchemy 2.0.36 / SQLite, JWT HS256 bearer, dev server on 127.0.0.1:5000.

---

| # | Sev | Finding | Vector / Evidence |
|---|-----|---------|-------------------|
| F-01 | **Critical** | **SQLi in `GET /users/v1/{username}`** (CWE-89) — anonymous string-interpolated query | Boolean oracle 200/404 differential (29,31,32); UNION extracted admin's plaintext password: `{"username":"pass1"}` (41), 404 control (42). CVSS 9.8 |
| F-02 | **Critical** | **Mass assignment → privilege escalation** (CWE-915) — anonymous `register {admin:true}` → `/me` shows `admin:true` (22); new admin deleted alice (23) | CVSS 9.8 |
| F-03 | **Critical** | **Hardcoded JWT secret `'random'` → token forgery / auth bypass** (CWE-798/347) — forged HS256 `sub=admin` accepted (26); alg:none & tampered rejected (27,28) — validation exists, secret is the flaw | CVSS 9.8 |
| F-04 | **High** | **IDOR cross-user password reset** (CWE-639) — alice resets bob's password (18, 204) → login as bob (19). Any-user account takeover | CVSS 8.8 |
| F-05 | **High** | **Unauthenticated destructive `GET /createdb`** (CWE-306) — anonymous DB drop/reseed, 200 "Database populated." (01,44,45) | CVSS 9.1 |
| F-06 | **High** | **Excessive data exposure — plaintext passwords, anonymous** (CWE-312) — `GET /users/v1/_debug` leaks all users incl. `admin/pass1` (05); `/users/v1` & `/{username}` leak data anon (04,06) | CVSS 7.5 |
| F-07 | Med-High | **BOLA on `GET /books/v1/{book_title}`** (CWE-639) — token required (08: 401) but no ownership check: alice reads name1's book secret (16) | CVSS 6.5 |
| F-08 | Medium | **ReDoS in `PUT /users/v1/{username}/email`** (CWE-1333) — control 204 in <1s; malicious email hung >3s and wedged the single-threaded server (33,34,36) | CVSS 6.5 |
| F-09 | Medium | **User/password enumeration + default creds** (CWE-204) — distinct login errors (13,14); seeded `admin/pass1` logs in (15) | CVSS 5.3 |
| F-10 | Info | **Dep CVEs:** Flask 2.2.2 → CVE-2023-30861 (HIGH, low applicability — JWT not sessions); PyJWT 2.6.0 → GHSA-752w-5fwx-jx9f (HIGH, `crit` header; JWK CVEs N/A — no JWK client); Werkzeug 2.2.3 → GHSA-2g68-c3qc-8985 (debugger RCE, relevant since debug=True), multipart DoS (MOD). connexion/sqlalchemy/jsonschema/markupsafe/flask-sqlalchemy: clean | host-side OSV |

**Validation gate (sentinel-validation):** ① every finding backed by saved raw responses; ② deterministic reproduction with differentials and paired controls (SQLi true/false/404, BOLA owner-vs-foreign, IDOR reset-then-login, mass-assignment `/me` confirm); ③ all traffic in-scope with verified grants; ④ no tainted reasoning — source review only steered probes, results come from live responses; ⑤ CVSS 3.1 vectors per finding. Negative controls recorded (alg:none/tampered JWT rejected).

**Top remediation:** parameterized queries (F-01), whitelist registration fields / reject unknown keys (F-02), rotate to env-managed secret (F-03), enforce `requester == target` (F-04), remove/authenticate `/createdb` & `/_debug` (F-05/06), object ownership checks (F-07), bounded regex / allowlist email (F-08), uniform login errors + credential rotation (F-09), upgrade Flask≥2.2.5, PyJWT≥2.10.0, Werkzeug≥2.3.x and disable debug in prod (F-10).

**Cleanup:** DB restored to seeded state; app stopped. This is a DRAFT for review — no production deployment was involved.

```sandbox_artifacts
[Full ranked DRAFT report](/tmp/vampi/artifacts/FINAL_report.md)
[Raw evidence artifacts](/tmp/vampi/artifacts)
```