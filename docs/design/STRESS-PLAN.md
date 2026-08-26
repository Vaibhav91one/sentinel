# STRESS-PLAN — 5-target fan-out heavy load (dry-run)

> Lightweight verification + plan. No long-running mission executed. See tasks 1-3 for config/evidence checks.

## 1. Config verification (done 2026-08-26)

- `agent/sentinel.agent.json:50-63` — `config.dynamic_sub_agents.enabled=true`, `iteration_limit=80`, `sandbox.enabled=true`
- `agent/sentinel.agent.json:9` instructions line 5: `Fan out one subagent per target when assessing multiple hosts; each subagent re-verifies scope itself.`
- `skills/recon/SKILL.md:25` — `One target at a time per subagent. Each subagent re-runs scope_check itself.` Confirms prompt with "one sub-agent per target" hits a coded playbook path, not just free-form prompting.
- `mcp/scope-guard` — `scope_check` (read-only, no approval) + `request_intrusive_approval` (approval-gated, mints `SENTINEL_GRANT` 10-min TTL) per `agent/sentinel.agent.json:16-18` + `mcp/scope-guard/src/index.ts:94,295`.
- Prior evidence: `demo/evidence/multi-target-run.md` exists (34 lines, VAmPI summary) — shows multi-target reporting shape succeeded before, but covers 1 detailed target in file; original 3-target harness run referenced in task description. Gap: no persisted 5-target run yet.

Result: harness **supports** 5-way fan-out; no config gate would block it.

## 2. Heavy-load prompt (copy-paste ready)

Single mission, forces scheduler to fork 5 threads:

```
Assess these 5 targets: http://localhost:3000, http://localhost:8080, http://localhost:8081, http://localhost:65412, http://localhost:5000 — one sub-agent per target.

Per-target contract (each sub-agent independently):
1. scope_check that exact http://localhost:<port> URL before any network contact.
2. Passive fingerprint only (curl -sS -m 10 -D - http://localhost:<port>/, headers/timing) — write artifacts/<port>.recon.jsonl.
3. If you intend any active step, call request_intrusive_approval with target + action label first and only proceed on grant; embed SENTINEL_GRANT=<token> and verify_grant.
4. Correlate banner findings via osv_query/osv_get (host-side, not curl).
5. Report per-target verdict + which scope entry authorized it.

Do NOT collapse targets into one agent. Fan out 5.
```

Notes:
- Ports 3000/8080/8081/65412/5000 are all loopback `private` class — `scope_check` should allow them if `localhost`/`127.0.0.1` is in `data/scope.json` (default). Some ports may have no listener; sub-agents should report `unreachable + scope allowed` rather than fail the mission.
- Do not pre-add grants; let each sub-agent request its own — this stresses approval coalescing.

## 3. Expected behavior

- **Sub-agent count:** 5 child threads + 1 root coordinator = 6 threads. `agent/sentinel.agent.json:63` `iteration_limit=80` is shared/budgeted per thread — sufficient for passive phase (2-3 turns each).
- **Tool call fan-out:** 5× `scope_check` (parallel, immediate), then 5× passive `curl`/`probe`, then up to 5× `request_intrusive_approval` if active steps attempted (approval queue pressure test).
- **Failure modes to observe:** scheduler throttling, approval queue batching vs. 5 separate `tool.approval_required` events, thread_id collision, sandbox egress limits irrelevant (localhost).

## 4. How to verify (when live run is executed)

1. **Approval queue:** `console` dock + `GET /sessions/{id}/events` should show 1 `tool.approval_required` per sub-agent that requested intrusive phase (up to 5). Each carries distinct `threadId` + `toolCallId` + `target` (`localhost:3000` etc.). Check `docs/design/UI-SPEC.md §4.5` batch vs separate semantics — here expect **separate cards**, not a batch.
2. **Events fan-out:** `GET /sessions/{id}/events` replay — filter `event.type=tool.call where tool=scope_check` — must show 5 entries with distinct `thread_id` values. `turn.created` per sub-agent also fans out.
3. **Scope enforcement:** each sub-agent's first tool must be `scope_check`; audit log `data/audit.jsonl` should have 5 `scope_check ALLOWED private` entries (or DENIED if scope file stripped down).
4. **Artifacts:** `artifacts/3000.recon.jsonl`, `8080.recon.jsonl`, etc. — 5 files, one per target, even if body is `unreachable`.
5. **Grant lifecycle:** if intrusive phase entered, `verify_grant` per target + `audit_read` grant fingerprinted entries 5×.

Quick dry-run check (no mission):
```bash
cat agent/sentinel.agent.json | jq .manifest.config.dynamic_sub_agents
grep -n "Fan out one subagent" agent/sentinel.agent.json
grep -n "One target at a time per subagent" skills/recon/SKILL.md
ls demo/evidence/multi-target-run.md && wc -l demo/evidence/multi-target-run.md
```

## 5. Metrics to collect (during live run)

| Metric | How | Target / alert |
|---|---|---|
| **time-to-fan-out** | `turn.created` ts (root) → first child `scope_check` ts | <30s for 5; >60s = scheduler contention |
| **scope_check p50/p95 latency** | 5 parallel scope_check durations | p95 <500ms (local guard) |
| **approval coalescing** | count `tool.approval_required` events vs sub-agents that called `request_intrusive_approval` | 1:1 (no coalescing); if <5, harness batched — document |
| **approval decision latency** | `approval_required` ts → `user.tool_approval` ts per target | operator SLO; track per-thread |
| **thread_id cardinality** | distinct `thread_id` in events | must be 5 (or 6 inc. root) |
| **artifact completeness** | files written / 5 | 5/5 even on unreachable |
| **failure rate** | sub-agents that error before `turn.done` | 0/5 expected |
| **token/turn cost** | `turn.done.metrics` per thread aggregated | compare 3-target vs 5-target scaling (linear = healthy) |

## 6. Execution guardrails

- Do NOT run with `SENTINEL_GRANT` pre-injected; test real approval flow.
- Keep sandbox egress restricted; no need to widen for localhost.
- Cap run at ~5 min; if any sub-agent stalls on missing listener, it should emit final report with `unreachable` finding, not spin.
- Collect `GET /sessions/{id}/events` dump + `data/audit.jsonl` tail as evidence for next `demo/evidence/5-target-run.md`.

## 7. Next step

When budget allows: launch the prompt above as a single mission via `POST /sessions/{id}/turns` (or console), approve/deny per-target grants in the dock, then snapshot events + artifacts into `demo/evidence/5-target-run.md`.
