# 5-Target Fan-Out Heavy Load — Evidence
Session: 01m0zm1gqy8952chmcwqweyy1x  Turn: 01m0zmx1a9mns3q03kpmxa5m6v status=done
Metrics: input=169508 output=15818 total=185326

## Sub-agents (5/5 done)
- sub-localhost-3000 (e12beb47): allowed=True artifact=./artifacts/3000.recon.jsonl
- sub-localhost-5000 (37ca1a63): allowed=True artifact=./artifacts/5000.recon.jsonl
- sub-localhost-65412 (3ffbddb2): allowed=True artifact=./artifacts/65412.recon.jsonl
- sub-localhost-8080 (5b65acc9): allowed=True artifact=./artifacts/8080.recon.jsonl
- sub-localhost-8081 (cde565aa): allowed=True artifact=./artifacts/8081.recon.jsonl
- [x] thread_id cardinality=5
- [x] 5 artifacts

## Main Summary
Done — I faned out five sub-agents (one per target). Each sub-agent followed your contract: called scope_check for the exact URL, performed only passive fingerprinting, wrote an artifact, correlated banners via host-side OSV tools, and avoided any active/intrusive actions. None requested or used intrusive approval.

Summary (one line per target). For each: scope_entry used, scope_allowed, artifact path, banner candidates found, any OSV matches, intrusive phases human-approved.

- Target: http://localhost:3000
  - scope_entry: "http://localhost:3000"
  - scope_allowed: true
  - artifact_path: ./artifacts/3000.recon.jsonl
  - banner_candidates: []
  - osv_matches: []
  - intrusive_phases_human_approved: false

- Target: http://localhost:8080
  - scope_entry: "http://localhost:8080"
  - scope_allowed: true
  - artifact_path: ./artifacts/8080.recon.jsonl
  - banner_candidates: []
  - osv_matches: []
  - intrusive_phases_human_approved: false

- Target: http://localhost:8081
  - scope_entry: "http://localhost:8081"
  - scope_allowed: true
  - artifact_path: ./artifacts/8081.recon.jsonl
  - banner_candidates: []
  - osv_matches: []
  - intrusive_phases_human_approved: false

- Target: http://localhost:65412
  - scope_entry: "http://localhost:65412"
  - scope_allowed: true
  - artifact_path: ./artifacts/65412.recon.jsonl
  - banner_candidates: []
  - osv_matches: []
  - intrusive_phases_human_approved: false

- Target: http://localhost:5000
  - scope_entry: "http://localhost:5000"
  - scope_allowed: true
  - artifact_path: ./artifacts/5000.recon.jsonl
  - banner_candidates: []
  - osv_matches: []
  - intrusive_phases_human_approved: false

Notes / Next steps:
- All work was authorized by the scope entries listed above. No intrusive phases were executed or human-approved.
- If you want active scanning (port/service probes, vulnerability scans, or exploitation verification), I will request explicit intrusive approval for each target (I will call request_intrusive_approval with the exact target and action label and will embed and verify the returned SENTINEL_GRANT token before proceeding).
- If you want, I can now:
  - Retrieve and show the artifact files (./artifacts/*.recon.jsonl) or summarize specific headers found,
  - Or proceed to request intrusive approval for selected targets and run approved active probes.

Which next step do you want?