---
name: sentinel-recon
description: Authorized-target recon playbook for the Sentinel security agent. Use when asked to scan, probe, fingerprint or enumerate an in-scope target. Enforces scope checks and human approval before intrusive steps.
---

# Sentinel recon playbook

You are doing authorized security assessment of a scoped target. Authorization is
mechanical, not assumed: the scope-guard MCP server is the single source of truth.

## Non-negotiable rules

1. Before ANY network contact with a host — even one HTTP request — call
   `scope_check` with that exact target. If it returns `allowed: false`, do not
   touch the target and report why.
2. Before any ACTIVE step (port sweep, directory brute force, exploit probe,
   fuzzing), call `request_intrusive_approval` with the target and a short action
   label. If it returns a `grant_token`, include it in every command of that
   phase: `SENTINEL_GRANT=<token>`, and confirm it with `verify_grant` before
   scanning. The token records human consent; network-layer enforcement of the
   variable is roadmap. If the tool returns `approved: false`, stop.
3. Never contact cloud metadata endpoints (169.254.169.254,
   metadata.google.internal). The guard hard-denies them; attempting anyway is a
   violation.
4. One target at a time per subagent. Each subagent re-runs `scope_check` itself.
5. The sandbox has RESTRICTED egress (package registries + git hosts only).
   Never try to bypass that firewall. If an external target is unreachable,
   say so and offer the in-sandbox lab mode below. CVE lookups use the host-side
   `osv_query` / `osv_get` MCP tools — they work because they run outside the
   sandbox, not because you should curl OSV yourself.

## Phase 0 — in-sandbox lab (when the target should be local)

For demos and self-contained assessments, build the range inside the sandbox.

**Option A — bundled vulnerable app (default):**

```bash
git clone --depth 1 https://github.com/Vaibhav91one/sentinel /tmp/sentinel
node /tmp/sentinel/target/vuln-app.mjs &        # serves 127.0.0.1:3000 inside the sandbox
curl -s -m 5 http://localhost:3000/ | head -20  # confirm it is up
```

**Option B — any operator-provided app (generic runner):**

```bash
git clone --depth 1 https://github.com/Vaibhav91one/sentinel /tmp/sentinel
bash /tmp/sentinel/sandbox-setup/serve-app.sh "<source>" [port]   # git URL, dir, .zip/.tgz
cat /tmp/lab_status.txt                                           # READY ... or FAILED <reason>
```

Works with anything that has a package.json, requirements.txt, or static files -
Juice Shop, DVWA-style apps, an internal service clone, a raw directory.
Read `/tmp/lab_status.txt`. On `READY`, treat `http://localhost:<port>` as the
target. On `FAILED`, report the reason and stop - do NOT improvise alternative
install paths; that is what caused past failures. If bootstrap needs package
repos or CDNs, authorize them with `scope_add_temporary` (autonomous,
self-expiring) - never permanent `scope_add` without explicit human approval.

Examples: Juice Shop release zip, your own microservice repo, any internal
tool source the operator hands over. Scanner + target stay co-located in one
disposable cloud VM regardless of stack.

## Phase 0b — black-box targets (no source, restricted sandbox egress)

For internet-facing targets you cannot self-host: use the host-side relay tool.

```text
http_probe {url, method?, headers?, body?}
```

Doctrine:
1. Target not in scope → expect denial → `scope_add_temporary` the hostname
   (operator pre-authorization assumed for black-box missions) → re-check.
2. Probe with http_probe (GET/POST/HEAD). Redirects come back UNFOLLOWED with
   a Location header — scope_check / probe the new URL explicitly so every hop
   is re-authorized.
3. Responses capped at 32 KB; full bodies stay in evidence notes.
4. LIMITATION: HTTP(S) transport only — no port sweeps or raw TCP through the
   relay. Deep exploitation of reachable web targets still uses in-sandbox lab
   mode; document which path each finding came from.

## Phase 1 — passive fingerprint (no approval needed)

Run in the sandbox:

```bash
curl -sS -m 10 -D - -o /tmp/body.html http://<target>/ | head -60
grep -ioE 'server: .*|x-powered-by: .*' /tmp/headers 2>/dev/null || true
```

Record: server banner, framework hints from body HTML, TLS info if https
(`curl -vI`), response timing. Write findings as JSON lines to
`artifacts/<host>.recon.jsonl`, one finding per line:

```json
{"kind":"banner","value":"nginx/1.24","confidence":"high"}
```

## Phase 2 — service enumeration (needs grant)

With a valid grant token for this target:

```bash
SENTINEL_GRANT=<token> nmap -Pn -sV --top-ports 100 <host> -oA artifacts/<host>-nmap
```

If nmap is unavailable in the sandbox, fall back to a bash TCP connect scan and
say so in the report. Keep scan rates polite: no `-T5`, no aggressive timing.

## Phase 3 — web surface (needs grant)

- `nuclei -u <url> -severity low,medium,high,critical -rl 20` if installed;
  otherwise curated curl probes for common admin paths (`/admin`, `/.git/HEAD`,
  `/console`, `/.env`) — max 20 requests, 1s apart.
- Log every probe to `artifacts/<host>.web.jsonl`.

## Phase 2b — deep probes (grant-gated)

The prebaked lab image ships the exploitation toolchain — assume these are on
PATH, no install step: `sqlmap nuclei ffuf gobuster httpx dalfox nikto jwt_tool
testssl.sh wfuzz arjun` (web), `binwalk unblob firmwalker squashfs-tools`
(firmware), `jadx apktool androguard apkleaks mobsfscan` (mobile). If a tool is
missing (image not backing this sandbox), `command -v <tool>` first and fall
back to a curl/bash equivalent, noting the degraded path. Tool-backed recipes
live in `sentinel-payloads`. Examples:
- `SENTINEL_GRANT=<t> sqlmap -u "<url>" --data="<params>" --batch --level=2 --risk=2 --output-dir=artifacts/sqlmap`
- `SENTINEL_GRANT=<t> nuclei -u <url> -severity low,medium,high,critical -rl 20 -o artifacts/nuclei.txt`
All outputs are evidence artifacts. Cite them in the report; never paste raw dumps into chat.

## Wrap-up rule (MANDATORY - prevents mid-run stalls)

When assessment phases complete, produce the FINAL ranked DRAFT report as a
PURE-TEXT final answer with ZERO further tool calls. Pull numbers from memory
of this conversation; reference artifact paths for raw evidence. Do not call
tools to "double-check" during the wrap-up message.

**Exception — challenge-clearing missions:** when following `sentinel-challenges`
(clear every level/challenge, not sample), the wrap-up rule YIELDS while any
`todo` remains in `artifacts/<host>.challenges.jsonl`. Keep looping through
challenges; only emit the final pure-text report once the list has no `todo`
(or the operator budget is hit).

## Handoff

When done, hand `*.jsonl` artifact paths back to the caller (root agent or user).
The triage skill consumes them. Never paste raw nmap dumps into chat — point at
the files.
