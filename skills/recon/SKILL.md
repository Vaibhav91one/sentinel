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
   label. If it returns a `grant_token`, embed it in every command of that phase:
   `SENTINEL_GRANT=<token>`. If it returns `approved: false`, stop.
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

For demos and self-contained assessments, build the range inside the sandbox:

```bash
git clone --depth 1 https://github.com/Vaibhav91one/sentinel /tmp/sentinel
node /tmp/sentinel/target/vuln-app.mjs &        # serves 127.0.0.1:3000 inside the sandbox
curl -s -m 5 http://localhost:3000/ | head -20  # confirm it is up
```

Then treat `http://localhost:3000` as the target (`localhost` is in the default
scope). Everything runs inside one disposable cloud VM: scanner + target.

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

## Handoff

When done, hand `*.jsonl` artifact paths back to the caller (root agent or user).
The triage skill consumes them. Never paste raw nmap dumps into chat — point at
the files.
