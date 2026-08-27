---
name: sentinel-challenges
description: Systematic challenge/level clearing for deliberately-vulnerable lab apps (DVWA, Juice Shop, WebGoat, VAmPI, DSVW) and multi-level targets. Use when the goal is to CLEAR as many of a target's challenges/levels as possible rather than sample a few vuln classes. Enumerates the app's own challenge set, tracks per-challenge progress in an artifact that survives grant/wrap-up boundaries, and loops until exhausted.
---

# Sentinel challenge-clearing playbook

Default recon (`sentinel-recon`) SAMPLES vuln classes: confirm-or-deny a
representative few, then stop. This skill is the opposite mode — enumerate a
lab app's FULL challenge/level set and work each item to evidence-grade proof,
tracking progress so a run resumes instead of one-shotting. Use it only for
deliberately-vulnerable labs the operator owns (loopback targets).

Everything in `sentinel-recon` still applies: scope_check first, grants before
active steps, artifacts for all evidence, the 5-check validation gate per
confirmed challenge. This skill adds enumeration + progress state + the loop.

## 1. Get one grant that covers the sweep (lab-mode)

When the guard runs with `SENTINEL_LAB_MODE=1` and the target is loopback, a
single `request_intrusive_approval` mints a MULTI-USE 60-min grant — reuse the
same `SENTINEL_GRANT` across the whole challenge sweep, `verify_grant` before
each batch. Without lab-mode the grant is single-use and you must request a
fresh approval per batch (say so and proceed).

## 2. Enumerate the app's OWN challenge set (don't hand-maintain lists)

Most lab apps expose their challenge/level taxonomy — pull it at runtime:

- **Juice Shop**: `GET /api/Challenges/` → JSON of every challenge (name,
  category, `solved`). This IS the scoreboard and the progress signal.
- **WebGoat**: `GET /service/lessonmenu.mvc` (authenticated) lists lessons and
  completion; `/WebGoat/service/lessonoverview.mvc` per-lesson assignments.
- **DVWA**: modules are fixed (Brute Force, Command Injection, CSRF, File
  Inclusion, File Upload, Insecure CAPTCHA, SQLi, Blind SQLi, Weak Session IDs,
  XSS DOM/Reflected/Stored, CSP Bypass, JavaScript, Open HTTP Redirect). Each
  runs at 4 levels via the `security` cookie (`low|medium|high|impossible`).
  The matrix = modules × levels.
- **VAmPI**: finite documented set (SQLi on users, mass assignment, hardcoded
  JWT secret, IDOR/BOLA, unauth `/createdb` + `/users/v1/_debug`, excessive data
  exposure, user enumeration, ReDoS).
- **DSVW**: ~17 endpoints, each a distinct vuln (`?id=` SQLi bool/union/time,
  `?query=` XSS, `?path=` traversal/RFI, `?xml=` XXE, `?name=` XPath, `?url=`
  SSRF, `?size=` DoS, unsafe pickle, SSTI). Enumerate from the landing page.

For anything else: crawl (`gobuster`/`ffuf` + `httpx`) and treat each distinct
sink as a challenge.

## 3. Seed the progress artifact

Write one JSON line per challenge to `artifacts/<host>.challenges.jsonl`. This
file is the mission's memory — it survives grant expiry and the wrap-up rule,
and a resumed subagent reads it to skip finished work:

```json
{"id":"dvwa/sqli/low","class":"sqli","level":"low","status":"todo"}
{"id":"juiceshop/scoreDcp/loginAdmin","class":"sqli","level":"n/a","status":"todo"}
```

`status` ∈ `todo | confirmed | blocked | not-applicable`. On resume, re-read the
file and only work `todo` items.

## 4. Work each challenge → update its line

Per challenge: pick the tool-backed recipe (`sentinel-payloads`), run it with
the grant, capture raw evidence to `artifacts/<id>.<ext>`, apply the 5-check
gate (`sentinel-validation`), then rewrite that challenge's line:

```json
{"id":"dvwa/sqli/low","class":"sqli","level":"low","status":"confirmed",
 "evidence_ref":"artifacts/dvwa-sqli-low.txt","because":"union dump of users table"}
```

For the app's own scoreboard (Juice Shop), re-`GET /api/Challenges/` after each
exploit to confirm `solved:true` — that's ground-truth, better than self-report.

## 5. Honest ceiling — mark, don't force

Some challenges are infeasible for an autonomous CLI agent. Mark them
`blocked` with a one-line reason and move on — never fake a solve:

- Crypto/hash-cracking with real work factor, timing side-channels.
- Challenges requiring external services, email, or real payment.
- CSP/interaction challenges needing a real user to click a live victim page.
- Mobile **dynamic** (Frida/objection) without a device/emulator.

DOM XSS is NO LONGER auto-blocked: the image prebakes headless `chromium`
(verified working: a `location.hash` → `innerHTML` sink payload executed and
mutated `document.title`, captured correctly in the dumped DOM). Prefer a
payload that MUTATES something observable post-load (title, a new attribute,
an appended node) over a bare `alert()` — headless has no dialog to catch, but
a DOM mutation shows up in `--dump-dom` unambiguously. Render the post-JS DOM
and grep for your marker instead of blocking:

```bash
chromium --headless --no-sandbox --disable-gpu --disable-dev-shm-usage --dump-dom \
  "<url>#<img src=x onerror=document.title='SENTINEL_MARKER'>" > artifacts/<id>.dom.html
grep -q SENTINEL_MARKER artifacts/<id>.dom.html && echo CONFIRMED
```
`--disable-dev-shm-usage` avoids a crash on the sandbox's small `/dev/shm`.
Stderr `dbus`/`NameHasOwner` lines are harmless noise (no session bus in a
minimal container) — not a failure signal, ignore them.

## 6. Loop, then wrap up

Repeat step 4 until `challenges.jsonl` has no `todo` (or the operator's budget
is hit). ONLY THEN produce the final ranked DRAFT report as pure text — the
`sentinel-recon` wrap-up rule yields to this loop while any `todo` remains.
Report coverage as `confirmed / blocked / total` per class, and cite the
progress artifact.
