# We gave an LLM a license to scan — and made it ask permission first

*Build log for Sentinel, our Agent Harness Hackathon submission (TrueForge track).*

## The job

Security recon is exactly the kind of work you want to hand to an agent: tedious,
repeatable, and full of rabbit holes. It's also exactly the kind of work you
**don't** want to hand to an agent unsupervised, because "the agent port-scanned
something it shouldn't have" is a career-defining sentence.

Sentinel is our answer: a recon agent where authorization isn't a prompt hint —
it's machinery. Every layer of the TrueForge harness does one job in the design:

| Layer | Job |
|---|---|
| MCP policy server (`scope-guard`) | allowlist gate, hard-denied metadata IPs, single-use grant tokens |
| Tool approval checkpoint | intrusive scans physically pause until a human clicks Allow |
| Sandbox | every scanning command runs in a disposable cloud VM |
| Host-side OSV tools | CVE enrichment happens outside the sandbox by design |

## The constraint that became the architecture

Daytona's free-tier sandboxes block arbitrary outbound traffic — package
registries and git hosts pass, everything else gets TLS-reset by an envoy proxy.
Our first end-to-end run died when the agent tried to curl the target and got
nothing. Its next message was the highlight of the week: it diagnosed the
firewall from inside, listed exactly what *was* reachable, and **refused to try
to bypass the filter**, on the grounds that dodging a sandbox access control
would violate the point of having one.

Instead of fighting the firewall we redesigned around it: the agent now clones
our deliberately-vulnerable demo app *inside* the sandbox and scans it there.
The whole range — scanner and target — lives and dies inside one disposable VM.
CVE lookups moved host-side into two read-only MCP tools (`osv_query`,
`osv_get`). The egress restriction turned out to be the best architecture
documentary we could have asked for.

## The pause is the product

The demo moment everyone remembers: the agent finishes passive fingerprinting,
wants to run `nmap`, calls `request_intrusive_approval` — and the chat stops.
Allow / Deny card, tool name and arguments visible. On Allow, the guard mints a
single-use token that expires in ten minutes; every active command must embed
it as `SENTINEL_GRANT=<token>`. Kill the whole harness mid-pause, restart it,
reopen the browser: the session is still there, still waiting. The pause isn't
lost state — it's durable.

Deny works too. The agent thanks you for nothing and degrades gracefully to
passive findings.

## What the audit log knows

Every decision lands in an append-only JSONL: scope checks, grants minted,
metadata-IP attempts refused (you literally cannot allowlist 169.254.169.254 —
the guard refuses the entry), intrusive requests allowed or denied with reasons.
Compliance teams pay real money for logs like this; ours is 200 lines of
TypeScript behind an MCP tool called `audit_read`.

## Numbers

- Full assessment, start to ranked report: ~6 minutes
- DeepSeek bill per assessment: about two cents
- Planted vulnerabilities found: 5/5 (exposed `.env`, unauthenticated admin
  panel, user records API, git metadata leak, backup dump)
- Real CVEs correlated against the lab's Node runtime: 16 unfixed advisories

## Try it

The repo is public: clone, `pnpm i && pnpm build`, run the guard and the
harness, follow SETUP.md. The README maps every judging criterion to the file
that implements it.

## What we'd build next

A network-enforcement layer that makes the grant token *technically* required —
sandbox-side egress proxy that drops packets without a valid token, not just a
procedural check. And subagent-per-target fan-out with per-subagent scopes, so
one human approval can authorize a scoped fleet without authorizing the world.
