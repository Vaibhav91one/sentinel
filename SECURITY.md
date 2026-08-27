# Sentinel — Security Register & Disclosures

Status legend: **ENFORCED** · **DOCUMENTED-RESIDUAL** (accepted, tracked) · **OPEN**

| ID | Risk | Status | Notes |
|----|------|--------|-------|
| R1 | Console/harness unauthenticated access | **MITIGATED** | `CONSOLE_TOKEN` cookie/bearer gate on console; harness should run bound to localhost or behind OIDC when shared |
| R2 | Local processes can reach scope-guard | **MITIGATED** | `GUARD_TOKEN` bearer enforced by guard; TrueForge connector holds the same secret. `REQUIRE_GUARD_TOKEN=1` fails closed all mutations |
| R3 | Grant tokens not network-enforced | **DOCUMENTED-RESIDUAL** | Consent bookkeeping only. Roadmap: sandbox egress proxy validating tokens per connection |
| R4 | Secret management plaintext | **PARTIAL** | `.env` + harness SQLite; no KMS/rotation. Rotate any key that transits chat/shared channels |
| R5 | Sandbox isolation class unverified | **DOCUMENTED-RESIDUAL** | Daytona Tier-1 internals unpublished. Obtain vendor confirmation or migrate runtime (OpenSandbox evaluated) |
| R6 | `http_probe` host-side SSRF surface | **MITIGATED** | Scope-checked per request incl. DNS rebinding defense; scheme lock; redirects unfollowed; size caps; depends on R2 being armed |
| R7 | TOCTOU DNS re-resolution window | **DOCUMENTED-RESIDUAL** | Check-time resolution narrows rebinding; connection-time re-resolution possible. Egress proxy closes it |
| R8 | Prompt-injection evolution | **TESTED-PARTIAL** | Tripwire attack resisted live; sophisticated multi-stage injection untested. Validation skill = procedural control |
| R9 | Target-data confidentiality vs model providers | Inherent | Probe content transits the configured LLM provider. Disclose to target owners |
| R10 | Audit tamper-evidence | **MITIGATED** | sha256 hash-chain per entry (`prev`+`hash`); local file edits detectable. Host-root tampering still possible |
| R11 | Daytona dependency (OSS dead upstream Jun-2026) | **TRACKED** | OpenSandbox evaluated as migration target |
| R12 | Harness turn-stall at `finish_reason=tool_calls` | **OPEN** upstream | Workaround shipped (wrap-up rule + resume). Filed upstream |
| R13 | Driver edge cases for cold users | Improved twice | drive-turn v3 handles running-state, batches, subagent threads |
| R14 | Prebaked-image fast-path unexercised | Code + Dockerfile ready | Needs registry/build access |
| R15 | Sandbox install supply chain | Pinned versions | npm/pip/apt drift residual |
| R16 | Lab-mode multi-use grants | **OPT-IN, off by default** | `SENTINEL_LAB_MODE=1` trades per-action human consent for throughput so one approval clears a full challenge sweep. Scoped to **loopback targets only**; non-loopback ignores it; every use still hash-chain audited. Enable only for intentionally-vulnerable labs you own — never for real targets |

## Disclosure posture

- Findings on operator-owned lab targets stay in artifacts; nothing auto-publishes.
- Black-box reports are DRAFT until human sign-off; severities are proposals.
- Target-served content is treated as untrusted input, never as authorization.

## Reporting

Security issues with Sentinel itself: open a private advisory via GitHub
(Security tab) rather than a public issue.
