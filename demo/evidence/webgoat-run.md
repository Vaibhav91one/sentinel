# WebGoat (Java) assessment - final report

# DRAFT — Sentinel WebGoat Assessment Report

**Target:** `http://localhost:8080/WebGoat` (OWASP WebGoat 2025.3, Java/Spring Boot) + companion `http://localhost:9090/WebWolf`
**Status:** DRAFT — passive findings verified; active probe sweep approved but **not executed** (see compliance)
**Date:** 2026-08-26 · **Assessment ID:** webgoat-localhost-20260826
**Artifacts:** `/tmp/artifacts/localhost.recon.jsonl` (12 entries), `/tmp/artifacts/wg_env.json`, `/tmp/artifacts/wg_mappings.json`, `/tmp/artifacts/login.html`, `/tmp/artifacts/hsqldb.html`, `/tmp/webgoat.log`

---

## 1. Scope & Grant Compliance

| Item | Status |
|---|---|
| Authorizing scope entry | `localhost` (loopback class) — matched by `scope_check(http://localhost:8080/WebGoat)` → **allowed** |
| Bootstrap hosts | `github.com` + self-expiring temporary entries (`objects.githubusercontent.com`, `release-assets.githubusercontent.com`) — used only for Temurin JRE 23 / WebGoat jar downloads; TTL-limited, public class |
| Cloud metadata | **Never contacted** (hard-denied by guard, no attempts) |
| Intrusive approval | `request_intrusive_approval(localhost:8080, "login probe sweep")` → **human-APPROVED**, token `ab052e…784e` issued (single-use, 10 min) |
| Active probes executed | **None.** The probe sweep was approved but not run (wrap-up ordered before execution). `verify_grant` **not consumed** — token remains unconsumed. |
| Traffic sent | Benign GET fingerprinting only (login, root, HSQLDB path, actuator endpoints, WebWolf) |

**Compliance statement:** The work was authorized by the `localhost` scope entry. The intrusive phase received explicit human approval, but no intrusive traffic was sent — all findings below derive from passive observation and the application's own boot logs. No out-of-scope contact occurred.

---

## 2. Ranked Findings (DRAFT)

| # | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| F1 | **Medium** | **Unauthenticated Spring Boot Actuator exposure** — `/WebGoat/actuator`, `/actuator/health`, `/actuator/env` return 200 with no session. `/actuator/**` sits in the Spring Security permitAll matcher list. | `actuator` 200 (links: health, health-path, configprops, configprops-prefix, env, env-toMatch); `health` 200 (see F2); boot log: *"Exposing 3 endpoints beneath base path '/actuator'"* | ✅ Verified |
| F2 | **Medium** *(High → Medium, redacted-values reducer)* | **`/actuator/env` structure leak** — 8.4 KB of property sources exposed unauthenticated: `commandLineArgs`, `systemEnvironment`, `systemProperties`, `applicationInfo`, `server.ports`, `application-webgoat.properties`. Key **names** disclosed include `server.ssl.key-store-password`, `spring.security.oauth2.client.registration.github.client-secret`, `spring.datasource.*`, `webgoat.server.directory`, and sandbox env var names (`GPG_KEY`, `TFY_NATS_URL`, …). **Severity reducer applied:** all values are redacted (`******`, Spring Boot `show-values=NEVER` verified on 5 secret-bearing keys) — topology/configuration blueprint leaks, but no credential material. | `env` HTTP 200, 8412 bytes; jq redaction checks: `GPG_KEY`, `TFY_NATS_URL`, ssl keystore pw, oauth client-secret all `is_redacted=true` | ✅ Verified |
| F3 | **Medium** | **`/actuator/health` info disclosure** — leaks DB engine identity (HSQL Database Engine, both data sources), filesystem layout (`diskSpace.path=/tmp/.`), disk capacity (total 3.22 GB / free 2.84 GB), and TLS chain state (`ssl.validChains: []`). | `health` 200 response body | ✅ Verified |
| F4 | **Low** | **HSQLDB console reachable at `/WebGoat/HSQLDB`** — DB admin console path exposed. **Auth enforced** (302 → login), so unauth access denied; rated Low for the live surface, would be High/ Critical if the gate failed. | 302 + `Location: /WebGoat/login`, `JSESSIONID` issued | ✅ Verified |
| F5 | **Low** | **Tomcat version banner disclosure** — 404 pages expose `Apache Tomcat/10.1.36`, enabling version-targeted exploit research. | 404 body footer | ✅ Verified |
| F6 | **Low** | **Missing security headers / cookie flags** — no `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, or HSTS on the login response; `JSESSIONID` is `HttpOnly` but **not** `Secure` (plain-HTTP deployment; flag becomes relevant behind TLS). | `login` response headers | ✅ Verified |
| F7 | **Low** | **Admin credential printed in plaintext at boot** — log line *"Password for admin: \<uuid\>"* (per-boot random, so no static default — but logging credentials undermines the randomness; any log reader gets admin access). | `/tmp/webgoat.log` (app's own output) | ✅ Verified |
| F8 | **Info** | **WebWolf companion app on `:9090`** — second Spring context (WebWolf 200 on `/WebWolf/login`) adjacent to the primary target; doubles the attack surface if reachable in a real deployment. (Here loopback-bound by design.) | HTTP 200 on 9090 | ✅ Verified |
| F9 | **Info** | **Spring Security matcher hygiene warning** — log WARN: pattern `fonts/**` in the permitAll list lacks a leading slash; other entries (`/favicon.ico`, `/css/**`, `/actuator/**`, `/registration`, `/register.mvc`) suggest public registration + actuator permitted. Ambiguous matchers risk unintended permit-all behavior after framework upgrades. | Boot log WARN | ✅ Verified |
| F10 | **Info / by-design** | **Deliberately vulnerable lesson surface** — lesson dirs `ClientSideFiltering`, `PathTraversal` incl. `path-traversal-secret.jpg` created at boot; the PathTraversal lesson is the intended vulnerable endpoint class. Auth-gated; flagged so a real deployment never copies this pattern. | Filesystem observation + boot logs | ✅ Verified |

---

## 3. Verified vs Unverified

**✅ Verified (passive/observational, evidence in artifacts):**
- Login page 200 (`text/html;charset=UTF-8`, form `action="/WebGoat/login"`); root 302 → login
- Auth gates hold on: `/WebGoat/HSQLDB`, `/actuator/mappings`, `/actuator/beans` (all 302 → login)
- Unauthenticated exposure: `/actuator`, `/actuator/health`, `/actuator/env` (200, no session)
- **All** secret-bearing env values redacted (`******`) — redaction empirically confirmed
- Stack fingerprint from logs: Spring Boot 3.x, Tomcat 10.1.36, HSQLDB 2.7 (file DB at `/root/.webgoat-2025.3/webgoat`), Flyway, Hibernate, Spring Security, Thymeleaf, Actuator (3 endpoints)
- Cookie flags, missing headers, Tomcat banner, admin-password-in-log, WebWolf 9090 — as tabled

**❌ Unverified / NOT TESTED (intrusive probes not executed):**
- SQLi auth bypass on `/WebGoat/login` (`' OR '1'='1`, `' OR 1=1--`) — grant approved, **probe not sent**
- Reflected/persisted XSS markers, command injection, SSRF, path-traversal payloads on lesson endpoints — **not tested**
- `/actuator/configprops` content (link listed; not fetched) — **not tested**
- Registration flow (`/register.mvc`, `/registration`) behavior, credential lockout/rate-limit behavior — **not tested**
- Whether the boot-logged admin password actually authenticates — **not tested** (would require POST login under grant)

Per sentinel-validation gates: F1–F7 pass the 5-check gate (observable evidence, deterministic reproduction, scope-clean origin, no tainted reasoning, severity justified). No injection-class findings are claimed because no injection probes were executed — the absence of a finding here is **absence of testing**, not absence of risk. The login handler and lesson endpoints of a deliberately-vulnerable app should be treated as **suspected-unsafe until probed** in a follow-up (grant token `ab052e…784e` remains valid for that run).

---

## 4. Remediation Notes

1. **Actuator (F1–F3):** restrict `management.endpoints.web.exposure.include=health` (drop `env`, `configprops`), set `management.endpoint.health.show-details=never`, and remove `/actuator/**` from the permitAll matcher list — require an authenticated role. Keep `show-values=NEVER` (already effective) and disable `env` outright in production.
2. **HSQLDB console (F4):** keep auth-gated; in production, disable the console entirely or bind to a dedicated admin interface — never ship a DB console path on a public context.
3. **Banner/header hardening (F5–F6):** set `server.error.include-stacktrace=never`, `server.server-header=` (or `ErrorReportValve showServerInfo=false`); add CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and HSTS + `Secure` cookie flag once TLS is enabled.
4. **Credential hygiene (F7):** stop logging the admin password; source it from an injected env var/secret manager; the per-boot UUID is good randomness, negated by the log line.
5. **Config hygiene (F9):** fix the missing leading slash on `fonts/**`; audit the whole request-matcher list for unintended permit-all; evaluate whether public self-registration is required.
6. **Follow-up testing required:** run the approved login-probe sweep (SQLi auth-bypass), then lesson-endpoint probes (path traversal, XSS) with per-batch grants — re-assess F1–F3 severity only after `configprops` is inspected.

---

## 5. Bottom Line

WebGoat 2025.3 is up and stable on `localhost:8080` (READY, pid 4365; WebWolf on 9090) after 6 deterministic bootstrap fixes (JRE 21→23, memory-bound JVM flags, expanded-assets download, WebWolf/WebGoat port separation). The highest-confidence **real** findings are the unauthenticated Actuator exposure (F1–F3 — severity capped at Medium by value redaction) and the plaintext admin-password log line (F7). Everything else is standard hardening. **The vulnerable-by-design lesson surface (SQLi login, path-traversal lessons) remains untested — this DRAFT is not a clean bill of health; the intrusive sweep is approved, token in hand, and should be the immediate next step.**

— *DRAFT: awaiting active-probe results and human review before finalization.*