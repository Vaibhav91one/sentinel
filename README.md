# Sentinel

**A scope-enforced security recon agent built on the [TrueForge](https://github.com/truefoundry/trueforge) agent harness.**

Give Sentinel a target that is inside its authorization scope and it will:

1. **Fingerprint** it passively (banners, tech, TLS) inside an isolated sandbox
2. **Pause for a human** before any intrusive step (port sweeps, exploit probes) — enforced twice: once by the harness approval checkpoint, once by single-use grant tokens
3. **Correlate** discovered services against public CVE data (OSV)
4. **Deliver** a severity-ranked findings report with evidence references and fixes

Everything it does is written to an append-only audit log. Everything it touches
must match an explicit allowlist entry — cloud metadata endpoints are hard-denied
at the policy layer, before any human ever sees a prompt.

```
            ┌──────────────────────────────────────────────────┐
            │                 TrueForge harness                │
   user ──▶ │  model · approvals · subagents · sessions · UI   │
            └───────┬───────────────┬──────────────┬───────────┘
                    │ MCP           │ MCP          │ sandbox-as-tool
                    ▼               ▼              ▼
        ┌────────────────┐  ┌───────────────┐  ┌─────────────────────┐
        │  scope-guard   │  │  osv_query /  │  │  Daytona sandbox    │
        │  allowlist +   │  │  osv_get      │  │  disposable cloud VM│
        │  hard deny +   │  │  CVE data     │  │  scanner + target   │
        │  grants +      │  │  (host-side,  │  │  run isolated;      │
        │  append-only   │  │  full net)    │  │  secrets stay out   │
        │  audit         │  └───────────────┘  └─────────────────────┘
        └────────────────┘
```

## Why this is safe to run

| Layer      | Control                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| Policy     | `scope_check` gate: no contact with non-allowlisted hosts               |
| Rebinding  | public-scoped hostnames are DNS-resolved at check time; resolution into private/link-local space is denied fail-closed |
| Tripwire   | cloud metadata IPs hard-denied, literally or via DNS resolution          |
| Human      | intrusive actions require an Allow click in the TrueForge UI            |
| Token      | approved scans carry a single-use, 10-minute `SENTINEL_GRANT`           |
| Auth       | optional `GUARD_TOKEN` bearer lock so only the harness connector can reach the guard |
| Isolation  | all scanning runs in the TrueForge sandbox, never on the host           |
| Forensics  | every decision appended to `data/audit.jsonl`, readable via `audit_read`|

Known limits, stated honestly:
- **TOCTOU rebinding** — the guard resolves hostnames at check time, but the
  sandbox's own resolver answers again when the scan actually connects. A
  hostile DNS server with short TTLs can serve a different answer between the
  two. Check-time resolution narrows the window; it does not close it. The
  complete fix is a sandbox-side egress proxy that validates every connection
  (roadmap).
- The guard cannot see HTTP redirects made inside the sandbox (the recon skill
  forbids following them off-target).
- The grant token is procedural — commands are expected to embed
  `SENTINEL_GRANT`, nothing network-level forces it yet.
- Trust boundary: without `GUARD_TOKEN` set (and matching header auth on the
  TrueForge connector), any local process can call the guard. Set
  `REQUIRE_GUARD_TOKEN=1` to make intrusive grants fail closed when that
  invariant cannot be verified.

**You are responsible for only scanning targets you own or have written
permission to test.** The default scope is `localhost` so the demo target is
your own machine.

## Quickstart

Requirements: Node ≥ 22.14, pnpm, a Daytona API key (free tier), any
TrueForge-supported model.

```bash
pnpm install && pnpm build
pnpm scope-guard &        # MCP server on http://127.0.0.1:9930/mcp
pnpm harness              # TrueForge on http://localhost:8790
```

Then follow [`docs/SETUP.md`](docs/SETUP.md) to connect your model, the
scope-guard connector, the skills, and the sandbox — and save the Sentinel
agent.

## Demo target

Two modes:

**In-sandbox lab (default, fully self-contained)** — the agent clones this repo
*inside* the Daytona sandbox, starts `target/vuln-app.mjs` there, and scans it
on sandbox-localhost. Nothing on your network is ever touched. This works even
though Daytona's free tier blocks arbitrary egress, because git + npm hosts are
allowlisted for the clone.

**Local target** — run the same app on your machine and scan it via a tunnel or
localhost if you run the harness hosted-mode locally:

```bash
./target/run-target.sh        # deliberately weak app on http://localhost:3000
```

## Repo layout

```
mcp/scope-guard/   authorization MCP server (TypeScript, zero framework)
skills/recon/      passive-first recon playbook (SKILL.md)
skills/triage/     CVE correlation + report playbook (SKILL.md)
agent/             Sentinel agent manifest for TrueForge
docs/              setup guide, architecture notes
demo/              demo script and expected output
```

## Hackathon mapping (Agent Harness Hackathon)

| Criterion              | Where Sentinel shows it                                              |
| ---------------------- | -------------------------------------------------------------------- |
| Use of sponsor tools   | Every capability is native TrueForge: MCP connector, sandbox-as-tool, tool-approval pause, subagents per target, sessions surviving restart mid-scan |
| Control & safety       | Double-gated intrusive actions (harness checkpoint + grant token), metadata tripwire, append-only audit |
| Technical excellence   | Typed TypeScript MCP server with stateless streamable-HTTP transport, smoke-tested protocol layer |
| Potential impact       | Turns ad-hoc pentest recon into a policy-enforced, auditable workflow |
| Presentation           | The approval pause *is* the demo moment                              |

## License

MIT
