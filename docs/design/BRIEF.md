# SUBAGENT BRIEF — Sentinel Console UI Specification

You are a product designer-engineer. Produce a complete UI specification for **Sentinel Console** — the operator interface for a security-recon AI agent.

**Deliverable**: write the full spec DIRECTLY to:
`/Users/vaibhavtomar/Desktop/sentinel/docs/design/UI-SPEC.md`

Do not ask questions. Make expert decisions. Ship thorough.

## PRODUCT CONTEXT

Sentinel = scope-enforced security recon agent on the TrueForge harness (local mode, SQLite, currently UI-less via bundled chat — we're building its dedicated console).

Core loop: operator gives target → agent checks authorization allowlist ("scope") before ANY network contact → passive fingerprinting inside isolated cloud sandbox (Daytona) → intrusive scans (port sweeps, exploit probes) REQUIRE human Allow/Deny pause → approved scans run with single-use consent tokens → findings correlated vs CVE data (OSV) → severity-ranked report (DRAFT until human sign-off) → every decision lands in append-only audit log.

Domain objects:
- **Mission** (= session): one assessment run; turns, streaming events; status running/done/cancelled; `required_actions` when paused
- **Finding**: id (CVE/GHSA/custom), severity critical/high/medium/low/info, title, evidence_ref, verified bool, fix
- **ScopeEntry**: hostname[:port] | IP | CIDR | wildcard; permanent OR temporary-with-expiry (autonomous lab-bootstrap); classes public/private/link-local/reserved/metadata
- **Grant**: single-use consent token, target-bound host[:port], 10-min TTL, states minted→consumed/expired
- **AuditEvent**: ts, actor (agent|human-via-agent), auth (bearer-verified|open-local), action, args, verdict allowed/denied/mutated, reason
- **Approval**: pending tool_call awaiting Allow/Deny (blocks the turn)
- Also: models/providers, MCP connectors (+ per-tool list), skills, sandbox provider settings

Backend API (TrueForge HTTP :8790/api/v1):
- POST /sessions {agent:{name}} · GET /sessions · GET/DELETE /sessions/{id}
- POST /sessions/{id}/turns {input:[...],stream} → SSE events: turn.created, model.message(+usage), tool.call, tool.response, tool.approval_required(toolCalls[]), tool.response_required(agent questions), sandbox.created, turn.done(final message+metrics+required_actions)
- Resume: POST turns input [{type:"user.tool_approval",threadId,toolCallId,approval:{status:"allow"|"deny",reason?}}] or [{type:"user.tool_response",threadId,toolCallId,content}]
- GET /sessions/{id}/events (replay/poll) · subscribe-to-running-turn (SSE resume) · GET turns
- /agents CRUD · model catalog/settings · connectors CRUD + tools list · skills CRUD · sandbox settings

## DESIGN REFERENCES

1) **Agent Orchestrator (aoagents.dev)**: kanban fleet board — columns Working / Needs you / In review / Ready to merge; dense calm dark UI; session cards with agent icon + status chips + test counts; command palette; collapsible sidebar. STEAL: board-as-home-screen; "Needs you" column = our pending approvals; card density.

2) **Beautiful UI (beautifului.dev)** primitives — reference these BY NAME when mapping components per screen:
Loading State (pixel-grid shimmer+elapsed) · Thinking (expandable traces tabs steps/reasoning/search/coding) · Streaming Text · Approval Card · Tool Chips · Task Rows · Chat composer · Prompt Bar (@sources /commands model picker) · Recommendation Card (confidence meter) · Context Cards · Diff Table · Records Table (grid w/ tags/sort) · Filter Table (status chips) · Sidebar Nav · Search/command palette · Flowchart (dotted canvas trigger/if-else) · Insight Cards (paged charts) · Code Block (line numbers + diff tab) · Fine-tune Card (inspector) · Selection Actions

## REQUIRED SPEC CONTENT (in this order)

1. **Product principles** (5 bullets max): e.g. "the approval IS the product", audit-first, calm density, fail-visible.
2. **Sitemap**: full tree of screens/routes with one-line purpose each.
3. **Per-screen wireframes**: ASCII box wireframes (like `┌─…┐` layouts showing regions) for EVERY screen in sitemap, each with: purpose, key regions annotated, live-data behaviors (what streams/polls), empty/loading/error states, Beautiful-UI component mapping table (region → component), API binding notes.
4. **Approval flow deep-dive**: dedicated section — how a pending approval surfaces globally (badge/column/card/modal), Allow/Deny interaction, deny-with-reason, timeout/expiry handling, multi-call batches.
5. **Live data strategy**: SSE vs polling per surface, reconnect/resume behavior, optimistic updates.
6. **Component inventory**: table mapping beautifului primitives → console usage → any custom variants needed (e.g., GrantChip, ScopeEntryRow, SeverityBadge, AuditTimeline).
7. **Visual language**: dark terminal aesthetic consistent with existing docs/ARCHITECTURE.html palette (#0d1117/#161b22/#58a6ff accent etc.), typography, spacing.
8. **Build phases**: P0 MVP (which screens first) → P1 → P2, with rough effort.
9. **Open questions** (max 5).

Tone: dense, concrete, no marketing fluff. Wireframes must be detailed enough that an engineer could build without asking questions.
