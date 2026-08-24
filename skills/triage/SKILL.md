---
name: sentinel-triage
description: Vulnerability triage and report writing for the Sentinel security agent. Use after recon artifacts exist. Correlates findings against public CVE data, ranks by real exploitability, and produces the final report.
---

# Sentinel triage playbook

Input: recon JSONL artifacts (e.g. `artifacts/<host>.recon.jsonl`,
`artifacts/<host>.web.jsonl`). Output: one ranked report per host.

## Procedure

1. **Inventory** — read the artifacts, list distinct services + versions +
   web tech. No network calls needed for this.
2. **CVE correlation** — use the host-side OSV MCP tools (the sandbox cannot
   reach api.osv.dev; these tools run outside it):
   - `osv_query` with `{name, ecosystem, version}` per versioned package
     found in the inventory. Ecosystem examples: `npm`, `PyPI`, `Go`.
   - `osv_get` with an advisory id for full details on anything promising.
   Only correlate advisories whose affected ranges plausibly cover the
   observed version. If a lookup fails or returns nothing, mark findings
   `unverified` instead of guessing.
3. **Reachability reasoning** — downgrade CVEs that require conditions the
   recon did not confirm (auth bypass needing an admin route that returned
   404, etc.). Upgrade ones matching observed surface. Every verdict gets a
   one-line `because:` justification.
4. **Severity** — rank by: confirmed-exploitable > exposed-sensitive-path >
   outdated-but-patched-unknown > info. Map to CVSS when OSV returned a score.

## Report format

Write `artifacts/<host>.report.md`:

```markdown
# Findings — <host>

Scope authorization: <scope entry matched> · Grant used: yes/no
## Critical / High
### <title> (CVE-XXXX-YYYY, CVSS X.X)
Evidence: <artifact line or probe>
Impact: <1 sentence>
Fix: <1 sentence>
## Medium / Low / Info
...
```

Also emit machine-readable `artifacts/<host>.report.json`:

```json
{"host":"...","generated_at":"...","findings":[{"id":"CVE-...","severity":"high","title":"...","evidence_ref":"artifacts/x.jsonl#12","verified":true,"fix":"..."}]}
```

## Rules

- Never invent CVEs. If correlation is empty, say so plainly — a clean report
  is a valid result.
- Remediation advice stays advisory: propose fixes, never apply changes to the
  target. Fixing is out of scope and would need its own approval flow.
