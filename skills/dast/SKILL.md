---
name: sentinel-dast
description: Dynamic-scanning orchestration for the Sentinel agent - ZAP spider/active-scan pipelines and Nuclei template sweeps against authorized targets. Use when a target is confirmed bootable and the operator wants broad automated coverage beyond curated probes.
---

# Sentinel DAST orchestration

Broad automated scanning is a FORCE MULTIPLIER after manual recon maps the
surface — never a substitute for it. Order: manual map → DAST sweep → merge
results through the validation framework.

## When NOT to use

- Target not yet fingerprinted (you don't know what you'd be scanning)
- No intrusive grant obtained
- Sandbox lacks the tool and installing would exceed 5 minutes

## Nuclei path (preferred when available)

```bash
# install (github releases, allowlisted egress)
curl -sL https://github.com/projectdiscovery/nuclei/releases/latest/download/nuclei_3_linux_amd64.zip -o /tmp/nuclei.zip
cd /tmp && unzip -o nuclei.zip nuclei >/dev/null && chmod +x nuclei && mv nuclei /usr/local/bin/
nuclei -update-templates >/dev/null 2>&1 || true   # templates CDN may be blocked; offline ok

nuclei -u http://<target> -severity low,medium,high,critical -rl 20 \
       -o /tmp/artifacts/nuclei.txt -silent
```

Template selection by fingerprint:
- Node/Express → `technologies/nodejs`, `exposures`, `misconfig`
- Python → `technologies/python`, default `http/cves` set
- Always include `misconfiguration` + `exposures` tags; skip `fuzz` tag on
  fragile lab targets.

## ZAP path (when the MCP connector is wired)

Pipeline via zap tools:
1. `zap_create_context(url, include:".*")`
2. `zap_start_spider` → poll to 100%
3. `zap_start_ajax_spider` for SPA targets
4. `zap_start_active_scan` (policy: default)
5. Read `zap://alerts`, dedupe into findings format

## Merge discipline

- Every DAST alert enters the sentinel-validation 5-check gate before ranking.
- Nuclei/ZAP template matches are LEADS with `verified: false` until you confirm
  impact manually or via deterministic re-run.
- Dedupe against manual findings by (endpoint, vuln-class); keep the one with
  stronger evidence_ref.

## Rate & noise limits

- `-rl 20` max requests/sec for nuclei; no `-T5` nmap pairing in same phase.
- One scan pass per grant. Re-sweeps need a fresh grant.
