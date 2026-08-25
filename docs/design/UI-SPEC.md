# Sentinel Console — UI Specification

Operator interface for the Sentinel scope-enforced recon agent, running against the
TrueForge harness (`http://localhost:8790/api/v1`, local mode). This spec is
build-ready: every screen has a wireframe, live-data behavior, state coverage,
component mapping, and API binding.

Companion docs: `docs/ARCHITECTURE.html` (system), `README.md` (product),
`docs/design/BRIEF.md` (this document's mandate).

---

## 1 · Product principles

1. **The approval IS the product.** The Allow/Deny moment is Sentinel's core value;
   it gets first-class real estate (board column, sidebar badge, dock, keyboard
   shortcuts) — never a buried modal.
2. **Audit-first.** Every surface that shows a decision shows its trail. Verdicts,
   actors, and grant fingerprints are visible inline; the audit explorer is one click
   from any event.
3. **Calm density.** Terminal-dark, mono-accented, information-dense like a fleet
   board — but generous line-height, no animation without meaning, severity color
   reserved for severity.
4. **Fail visible.** Scope denials, expired grants, dead SSE streams, sandbox loss:
   all render as explicit states with cause + next action. Nothing silently retries
   into looking healthy.
5. **Human is a role in the loop, not a bottleneck.** The console queues decisions
   across missions so one operator can supervise many runs; batch approvals exist,
   but destructive calls always show their target before consent.

---

## 2 · Sitemap

```
sentinel-console/
├── / ............................ Missions Board (home) — kanban of sessions: Running / Needs you / Done / Cancelled
├── /missions/new ................ New Mission modal — agent+model picker, target input, preflight scope_check preview
├── /missions/:id ................ Mission Workspace — tabbed detail view
│   ├── ?tab=stream .............. Stream — live SSE turn feed: model messages, tool chips, approval cards, composer
│   ├── ?tab=findings ............ Findings — severity-ranked records table w/ evidence links, verified flags, fixes
│   ├── ?tab=report .............. Report — DRAFT→signed-off markdown report w/ JSON artifact toggle + sign-off control
│   └── ?tab=audit ............... Mission Audit — this session's AuditTimeline slice
├── /approvals ................... Approval Queue — all pending tool_calls across missions ("Needs you" full page)
├── /scope ....................... Scope Manager — allowlist CRUD, entry classification, temporary-entry expiries
├── /grants ...................... Grants Ledger — consent token lifecycle (minted/consumed/expired) with TTL meters
├── /audit ....................... Audit Explorer — full append-only log browser: filter, search, export
├── /settings .................... Settings index (guarded sub-routes)
│   ├── /settings/agent .......... Agent config — manifest fields, require_approval tools, capabilities toggles
│   ├── /settings/models ......... Models & providers — catalog list, key status, default model selection
│   ├── /settings/connectors ..... MCP connectors — CRUD + per-tool annotation badges (readOnly/destructive)
│   ├── /settings/skills ......... Skills — CRUD, git-backed source viewer
│   └── /settings/sandbox ........ Sandbox — Daytona settings, idle teardown, egress posture readout
├── ⌘K ........................... Command palette overlay — navigation, actions, quick scope-add
└── global ....................... ApprovalDock — persistent bottom-right card stack whenever ≥1 approval is pending
```

Route conventions: `?tab=` is URL-synced (deep-linkable); mission ids are TrueForge
session ids; all mutating settings routes disable when guard auth is unverified.

---

## 3 · Per-screen wireframes

Legend: ①②③… = annotated regions. `●`=live indicator, `◌`=idle.

---

### S1 · `/` Missions Board

**Purpose:** home screen. Fleet overview of all assessment runs; launch point for new
missions; "Needs you" column makes pending human decisions impossible to miss.
(Stolen from aoagents.dev: board-as-home, column semantics, card density.)

```
┌──────────────┬───────────────────────────────────────────────────────────────────┐
│ ◉ sentinel   │ MISSIONS                                    [status▾] [sev▾] [+ NEW RUN] │
│ ⌘K search…   ├─────────────────┬─────────────────┬────────────────┬──────────────┤
├──────────────┤ ① RUNNING       │ ② NEEDS YOU (2) │ ③ DONE         │ ④ CANCELLED  │
│ ▸ Missions ② │ ┌─────────────┐ │ ┌─────────────┐ │ ┌─────────────┐│ (collapsed)  │
│ ◎ Scope      │ │ lab.local   │ │ │ acme.corp   │ │ │ demo target ││              │
│ ⛨ Grants     │ │ ● port sweep│ │ │ ⏸ nmap -sV  │ │ │ ✓ signed    ││              │
│ ☰ Audit      │ │ recon→scan  │ │ │ grant 9f2c  │ │ │ 5 findings  ││              │
│ ──────────   │ │ ⏱04:12 $0.02│ │ │ TTL 07:41   │ │ │ 2C·2H·1M    ││              │
│ ⚙ Settings   │ └─────────────┘ │ └─────────────┘ │ └─────────────┘│              │
│              │ ┌─────────────┐ │ ┌─────────────┐ │                │              │
│ guard ● :9930│ │ *.cloudflre │ │ │ 10.50.77.9  │ │                │              │
│ sandbox ●    │ │ ● osv_query │ │ │ ⏸ scope_add │ │                │              │
│ model ◍ ds-v4│ │ passive     │ │ │ TTL —       │ │                │              │
└──────────────┴─┴─────────────┴─┴─┴─────────────┴─┴────────────────┴──────────────┘
        ⑤ footer: harness :8790 ● · events sse ● · last sync 12:03:44
```

- **Regions:** ① Running columns cards stream phase chip (passive/scan/report);
  ② Needs you = pending approvals, card shows blocking tool call + grant countdown;
  ③ done cards carry severity histogram mini-badges + sign-off state; ④ collapsed by
  default; ⑤ global health strip.
- **Live data:** poll `GET /sessions` @5s (ETag-gated). Cards for running missions
  upgrade to SSE via subscribe-to-running-turn for phase/tool-chip updates.
  Needs-you count also drives sidebar badge + ApprovalDock.
- **States:** empty → "No missions yet" + big **[New run]** CTA + scope explainer.
  loading → Loading State shimmer skeletons (pixel-grid, elapsed counter). error →
  banner "harness unreachable at :8790 — retrying in 10s" + manual retry button;
  stale data dimmed 40% with `stale` tag.
- **Components:**

| Region | Beautiful-UI primitive |
|---|---|
| Board columns | Filter Table (status chips as columns) |
| Mission card | Task Rows + Tool Chips (current call) |
| Card skeleton | Loading State |
| Health strip | Context Cards (mini) |
| NEW RUN | Prompt Bar trigger |

- **API:** `GET /sessions` → board rows `{id,status,required_actions}`. Column mapping:
  running→running, required_actions.length>0→needs you, done→done, cancelled→cancelled.

---

### S2 · `/missions/new` New Mission modal

**Purpose:** start an assessment safely: pick agent/model, enter target, see a
preflight scope verdict *before* spending tokens.

```
┌──────────────── NEW MISSION ──────────────────────────────────────┐
│ agent  [ sentinel ▾ ]      model [ deepseek-v4-flash ▾  $0.04/M ] │
│                                                                   │
│ target  [ http://localhost:3000________________ ]  [check scope]  │
│ ① preflight:  ✓ matches entry "localhost" · class private         │
│               ✓ no metadata/link-local overlap                    │
│ prompt   [ Run full assessment: fingerprint, pause before any     │
│            intrusive scan, correlate CVEs, write report.       ]  │
│ ② ☑ auto-open stream   ☐ notify on approval (OS)                  │
│                              [cancel]  [ LAUNCH MISSION ⏎ ]      │
└───────────────────────────────────────────────────────────────────┘
```

- **Regions:** ① preflight panel calls `scope_check` read-only and renders verdict +
  matched entry + class before launch; deny = red block, LAUNCH disabled with reason;
  ② notification opt-in persists per-operator.
- **Live data:** none streaming; preflight is one-shot RPC. Model picker fetches
  catalog once, caches.
- **States:** preflight spinner (Loading State inline); deny → Recommendation Card
  variant "target out of scope — add entry?" linking to `/scope`; submit error →
  inline error row, form preserved.
- **Components:** Prompt Bar (target input, `/commands` hint for canned prompts),
  Recommendation Card (preflight verdict w/ confidence-style meter), Context Cards.
- **API:** `POST /sessions {agent:{name}}` then immediately `POST /sessions/{id}/turns`
  with composed prompt; navigate to `/missions/{id}?tab=stream`.

---

### S3 · `/missions/:id?tab=stream` Mission Stream

**Purpose:** the cockpit. Live turn feed (SSE), inline approval cards, right-rail
context, and the composer. Default tab of the workspace.

```
┌──────────────┬────────────────────────────────────────────────────────────────────┐
│ ▸ Missions   │ ← board   m_8f3k · lab.local:3000          ● RUNNING ⏱04:12  [⏸ stop]│
│              │ [Stream] Findings(5) Report·DRAFT Audit                            │
│              ├──────────────────────────────────────┬─────────────────────────────┤
│              │ ① TURN FEED                          │ ③ RIGHT RAIL                │
│              │ ┌──────────────────────────────────┐ │ ┌ TARGET ─────────────────┐ │
│              │ │ ▸ user  assess http://lab.local… │ │ │ lab.local:3000 private  │ │
│              │ │ ◆ thinking ▾ steps·reasoning     │ │ │ scope entry localhost   │ │
│              │ │   "planning passive recon…"      │ │ └─────────────────────────┘ │
│              │ │ 🔧 tool.call  curl -sI …    ✓120ms│ │ ┌ SANDBOX ────────────────┐ │
│              │ │ 🔧 tool.call  scope_check   allow│ │ │ daytona ● created 03:41 │ │
│              │ │ 📄 tool.response (artifact link) │ │ │ egress: git+npm only    │ │
│              │ │ 💰 usage  in 4.2k out 900 $0.001 │ │ └─────────────────────────┘ │
│              │ │ ┌ APPROVAL REQUIRED ───────────┐ │ │ ┌ GRANTS ─────────────────┐ │
│              │ │ │ nmap -sV --top-ports 1000    │ │ │ │ b7d911f6 port sweep     │ │
│              │ │ │ target lab.local:3000        │ │ │ │ TTL 07:41 ▓▓▓▓▓░░ CONSUMED│ │
│              │ │ │ scope✓ destructive⚠ single-use│ │ └─────────────────────────┘ │
│              │ │ │ reason [____________]        │ │                             │
│              │ │ │   [DENY ✗D]   [ALLOW ✓A]     │ │                             │
│              │ │ └──────────────────────────────┘ │ │                           │
│              │ └──────────────────────────────────┘ │                             │
│              │ ② COMPOSER  [@artifacts] [/commands] │                             │
│              │ [ message or instruction…        ] ⏎ │                             │
└──────────────┴──────────────────────────────────────┴─────────────────────────────┘
```

- **Regions:** ① chronological event feed — user turns, collapsible Thinking traces,
  Tool Chips per call (name, duration, verdict tint), usage lines, inline Approval
  Card pinned above composer when present; ② composer sends follow-up inputs incl.
  `user.tool_response` answers to agent questions; ③ right rail context cards:
  canonicalized target + matching scope entry, sandbox lifecycle, grant ledger slice.
- **Live data:** primary SSE `subscribe-to-running-turn`. Event → render map:
  `turn.created` (feed header), `model.message` (Streaming Text + usage), `tool.call`
  (Tool Chip pending→done), `tool.response` (chip resolve + artifact link),
  `tool.approval_required` (Approval Card + global surfaces), `tool.response_required`
  (question card w/ quick-reply chips), `sandbox.created` (rail card), `turn.done`
  (final message, metrics, unlock tabs). Replay on mount: `GET /sessions/{id}/events`.
- **States:** empty → "Mission queued — waiting for first turn". loading → replay
  skeleton then hydrate. reconnecting → amber top strip "stream interrupted —
  resuming from cursor #4821". cancelled → terminal grey banner w/ resume-as-new-mission
  action. error event → red event row, feed continues.
- **Components:** Thinking, Streaming Text, Tool Chips, Approval Card, Chat composer /
  Prompt Bar (@sources=/artifacts, /commands), Context Cards, Code Block (artifact
  previews, diff tab for evidence).

| Region | Component |
|---|---|
| Feed rows | Streaming Text + Tool Chips + Task Rows |
| Trace blocks | Thinking (tabs: steps/reasoning/search/coding) |
| Pause card | Approval Card |
| Question card | Approval Card variant `response_required` |
| Composer | Prompt Bar |
| Rail | Context Cards ×3 |

- **API:** mount `GET /sessions/{id}` (header meta) + `GET turns` + `GET /sessions/{id}/events`;
  open SSE; composer `POST /sessions/{id}/turns {input:[{type:"message",…}],stream:true}`;
  approvals/responses per §4; stop → `DELETE /sessions/{id}` w/ confirm.

---

### S4 · `/missions/:id?tab=findings` Findings

**Purpose:** severity-ranked result registry for this mission; evidence-linked,
verified-flagged, fix-attached.

```
│ [Stream] [Findings ⑤] Report·DRAFT Audit                                        │
│ filters: [all▾] [critical□ high□ med□ low□ info□]  [verified only☐]  [⤓ export] │
│ ┌───┬────────────────────────┬────────┬─────────┬──────────┬───────────────────┐│
│ │ □ │ FINDING                 │ SEVERITY│ VERIFIED│ EVIDENCE │ FIX               ││
│ ├───┼────────────────────────┼────────┼─────────┼──────────┼───────────────────┤│
│ │ □ │ CVE-2024-1234 express   │ ●CRIT  │ ✓ probed│ art#12 ↗ │ upgrade ≥4.19     ││
│ │ □ │ GHSA-x9y8 weak TLS ciph │ ●HIGH  │ ○ inferred│ art#09 ↗│ reconfigure TLS   ││
│ │ □ │ SEN-7 dir-listing on    │ ●MED   │ ✓ probed│ art#15 ↗ │ disable indexes   ││
│ │ □ │ SEN-11 server banner    │ ○INFO  │ ✓       │ art#03 ↗ │ —                 ││
│ └───┴────────────────────────┴────────┴─────────┴──────────┴───────────────────┘│
│ ① selected 1: [view evidence diff] [copy JSON] [push to report note]             │
```

- **Regions:** filter chips mirror SeverityBadge scale; Selection Actions bar appears
  on check; evidence links open Code Block drawer with raw artifact + diff tab vs
  baseline; verified=✓ means actively confirmed by probe, ○ = correlated-only.
- **Live data:** derived from `tool.response` payloads + artifacts; refresh on
  `turn.done` and on tab focus. No dedicated findings endpoint assumed (see OQ-3):
  parse from session events cache.
- **States:** empty (mission running) → "no findings yet — passive phase running"
  w/ pulse; empty (done) → "assessment complete, zero findings" success card;
  parse failure → raw JSON fallback view w/ warning.
- **Components:** Records Table (tags/sort) + Filter Table chips + Selection Actions
  + Code Block (drawer) + SeverityBadge (custom).
- **API:** session events store; export = client-side JSON/markdown serialization.

---

### S5 · `/missions/:id?tab=report` Report

**Purpose:** final deliverable. Markdown report rendered from turn output/artifact,
machine-readable toggle, DRAFT watermark until explicit human sign-off.

```
│ [Stream] [Findings] [Report · DRAFT] Audit                    [JSON|MD] [⤓]    │
│ ┌──────────────────────────────────────────────┬──────────────────────────────┐│
│ │ ░░░░░░░░ DRAFT ░░░░░░░░                      │ SUMMARY                      ││
│ │ # Assessment — lab.local:3000                │ 5 findings · 2 critical      ││
│ │ ## Executive summary …                       │ scan window 04:12            │
│ │ ## Findings                                  │ approvals 2 allow / 0 deny   │
│ │  1. ●CRIT CVE-2024-1234 … [evidence ↗]       │ spend $0.04                  │
│ │ …markdown rendered…                          │ ──────────────────────────── │
│ │                                              │ SIGN-OFF                     │
│ │                                              │ operator: vt                 │
│ │                                              │ [signature input__________]  │
│ │                                              │ [ SIGN OFF & FINALIZE ]      ││
│ └──────────────────────────────────────────────┴──────────────────────────────┘│
```

- **Regions:** MD/JSON segmented toggle swaps main pane (rendered markdown vs pretty
  JSON); sign-off requires typed confirmation; after finalize, watermark clears,
  tab label loses `· DRAFT`, sign-off block becomes read-only stamp (actor+ts).
- **Live data:** report text arrives via `turn.done` final message / artifact fetch;
  otherwise static. Sign-off is optimistic-local until persistence lands (OQ-2).
- **States:** no report yet → "report generates when triage completes" progress
  checklist tied to phases; JSON malformed → raw fallback; already-signed → stamp view.
- **Components:** Code Block (diff tab unused here; line-numbered JSON view),
  Fine-tune Card style inspector (summary rail), Selection Actions (export).
- **API:** artifact download endpoint / `turn.done` payload; sign-off console-local
  write + audit annotation via available mutation path (OQ-2).

---

### S6 · `/missions/:id?tab=audit` Mission Audit

**Purpose:** this mission's decision trail, interleaved with turn markers.

```
│ [Stream] [Findings] [Report] [AUDIT SLICE]                    [open full log ↗] │
│ 14:02:11 agent   scope_check  localhost:3000        ALLOWED  matches "localhost"│
│ 14:02:40 agent   curl -sI …                          ALLOWED  (read-only tool) │
│ 14:03:02 human   request_intrusive_approval port sweep ALLOWED  grant b7d911f6  │
│ 14:06:55 agent   verify_grant  b7d911f6              MUTATED  consumed (single)│
│ 14:08:12 agent   scope_check  169.254.169.254        DENIED   metadata tripwire│
│ …                                                                            ↓  │
```

- **Regions:** AuditTimeline rows colored by verdict (green/red/purple-left border);
  human rows carry actor badge `human-via-agent`; clicking a row expands args JSON.
- **Live data:** tail-poll filtered to session correlation (ts-window + threadId if
  present in args); else snapshot on tab open.
- **States:** empty → "no audited actions yet"; gap detected (log truncated) → notice.
- **Components:** AuditTimeline (custom), Diff Table styling for expanded args.
- **API:** `GET /sessions/{id}/events` cross-referenced w/ guard `audit_read` results.

---

### S7 · `/approvals` Approval Queue

**Purpose:** full-page inbox of every pending `tool.approval_required` across all
missions — the operator's desk when supervising several runs.

```
┌──────────────┬───────────────────────────────────────────────────────────────────┐
│ ▸ Missions ② │ APPROVALS — 2 pending                        [auto-focus newest☐] │
├──────────────┼───────────────────────────────────────────────────────────────────┤
│ ● Needs you  │ ┌ APPROVAL · m_8f3k lab.local:3000 · waiting 00:42 ──────────────┐│
│ ◎ Scope      │ │ nmap -sV --top-ports 1000        ⚠ destructive · single-use    ││
│              │ │ target lab.local:3000 (canonical) · scope entry "localhost" ✓  ││
│              │ │ batch: 1 call                       TTL after allow: 10:00     ││
│              │ │ reason [____________________]    [deny ✗D]   [allow ✓A]        ││
│              │ └────────────────────────────────────────────────────────────────┘│
│              │ ┌ APPROVAL · m_2a91 acme.corp · waiting 05:17 ───────────────────┐│
│              │ │ batch 2 calls: [☑] scope_add 10.50.77.9   [☑] scope_remove old ││
│              │ │ [approve selected] [approve all] [deny]                        ││
│              │ └────────────────────────────────────────────────────────────────┘│
└──────────────┴───────────────────────────────────────────────────────────────────┘
```

- **Regions:** each card = Approval Card expanded; queue ordered oldest-wait;
  batch cards enumerate toolCalls[] with checkboxes; keyboard `j/k` nav, `A/D`
  decide focused card.
- **Live data:** fed by per-running-session SSE subscriptions (console keeps one
  subscription per needs-you session); falls back to `GET /sessions` polling which
  exposes `required_actions`.
- **States:** empty → zen "nothing needs you" + last decision recap line; session
  died while queued → greyed card "session closed — decision void".
- **Components:** Approval Card, Task Rows (queue), Selection Actions (batches).
- **API:** decide = `POST /sessions/{id}/turns` input
  `[{type:"user.tool_approval",threadId,toolCallId,approval:{status,reason}}]`,
  looped per call for batches.

---

### S8 · `/scope` Scope Manager

**Purpose:** edit the authorization allowlist. The highest-stakes settings surface —
mutations themselves require harness approval, and the UI must show why.

```
┌──────────────┬───────────────────────────────────────────────────────────────────┐
│ ◎ Scope      │ SCOPE ALLOWLIST — data/scope.json · updated 12:01   [+ add entry] │
├──────────────┼───────────────────────────────────────────────────────────────────┤
│              │ search [___________]  class filter: [public][private][wildcard]…  │
│              │ ┌ ENTRY                    CLASS    EXPIRES   STATUS      ──────┐ │
│              │ │ localhost                private  —         active       [rm] │ │
│              │ │ 127.0.0.1                private  —         active       [rm] │ │
│              │ │ ::1                      private  —         active       [rm] │ │
│              │ │ 10.50.77.0/24            private  —         active       [rm] │ │
│              │ │ *.trycloudflare.com      public   —         active       [rm] │ │
│              │ │ lab-9f2.daytona.io:22    public   13:42      temp·expiring  [rm] │ │
│              │ └────────────────────────────────────────────────────────────────┘ │
│              │ ① ADD ENTRY                                                        │
│              │ [ ______________________ ] live validation: ✓ parses · ✓ class ok  │
│              │ rejected classes preview: metadata/link-local/reserved ⇒ hard-deny│
└──────────────┴───────────────────────────────────────────────────────────────────┘
```

- **Regions:** rows show canonical stored form (v6 RFC 5952), classification badge,
  expiry countdown for temporary entries (autonomous lab-bootstrap); add-input gives
  keystroke-level validation mirroring guard rules; removal buttons route through
  harness approval (destructive annotation) — button opens mini Approval Card, not
  instant delete.
- **Live data:** fetch-on-mount + refetch on window focus; expiry countdowns tick
  client-side; quarantined-entry warnings surfaced as amber banner if sanitizer
  reports them.
- **States:** loading shimmer rows; empty → "default scope: localhost" explainer;
  validation reject → red inline reason (e.g. "overlaps 10.50.77.0/24");
  approval denied → toast w/ audit link.
- **Components:** Records Table + Filter Table, ScopeEntryRow (custom), Approval Card
  (mutation confirm), Code Block (raw scope.json peek tab).
- **API:** guard MCP `scope_list/scope_add/scope_remove` via connector tools (each
  destructive → approval flow); file path + updated_at displayed from response.

---

### S9 · `/grants` Grants Ledger

**Purpose:** transparency into consent tokens: what was approved, bound to which
target, consumed by what, expired when. Trust through bookkeeping visibility.

```
│ GRANTS — consent tokens                                   [filter: state▾] [⟳]   │
│ ┌──────────┬──────────────────┬─────────────┬───────────┬──────────────────────┐│
│ │ FINGERPR │ BOUND TARGET     │ ACTION      │ STATE     │ LIFECYCLE            ││
│ │ b7d911f6 │ lab.local:3000   │ port sweep  │ ✓CONSUMED │ mint 14:03 → use 14:06││
│ │ 4a90cc21 │ lab.local:3000   │ web probes  │ ⏱MINTED   │ TTL 04:31 ▓▓▓▓░░░░░  ││
│ │ 88d1e0aa │ lab.local:3000   │ exploit chk │ ✗EXPIRED  │ mint 13:58 → ttl end ││
│ │ 11223344 │ 10.50.77.9       │ nmap -sV    │ ✗INVALID  │ wrong-target attempt ││
│ └──────────┴──────────────────┴─────────────┴───────────┴──────────────────────┘│
│ ⓘ grants are auditable consent, not network enforcement — see policy_get risks   │
```

- **Regions:** fingerprint-only display (never raw tokens); TTL meters tick live for
  minted rows; footer honesty note mirrors README known-limits.
- **Live data:** poll guard `audit_read` + grant events @10s; minted-row countdowns
  client-side.
- **States:** empty → "no intrusive approvals yet — passive scans need none";
  source unreachable → red banner "guard down at :9930 — showing cached".
- **Components:** Records Table + GrantChip (custom) + Insight Cards (P2: consume-rate
  chart) + Filter Table.
- **API:** guard MCP `audit_read` (grant entries fingerprinted) + `policy_get` for
  the disclaimer copy.

---

### S10 · `/audit` Audit Explorer

**Purpose:** full append-only log browser across all missions; the forensics root.

```
│ AUDIT LOG — data/audit.jsonl · append-only · N entries     [export jsonl] [⟳]   │
│ filters: actor[agent▾] verdict[any▾] action[____] free[___________]  since[24h▾]│
│ ┌ 14:08:12 agent  scope_check  {"target":"169.254.169.254"}  DENIED  metadata… ▸│
│ ┌ 14:06:55 agent  verify_grant {"token":"b7d9…","target":"lab.local:3000"}     ▸│
│ ┌ 14:03:02 human  intrusive_request {"action":"port sweep","grant":"b7d911f6"} ▸│
│ … virtualized scroll · newest-first · expand row = full args JSON (Code Block)  │
│ ① integrity: file is append-only; console never offers edit/delete affordances  │
```

- **Regions:** virtualized list (logs grow unbounded); expandable rows; filter bar
  composes client-side over fetched tail windows; export streams raw file slice.
- **Live data:** tail-poll `audit_read(limit)` @10s w/ cursor dedupe; "jump to live"
  pill when scrolled back.
- **States:** loading shimmer; empty file → explainer; huge-file notice beyond fetch
  window w/ "load more".
- **Components:** Records Table (virtualized) + Filter Table + Code Block (expanded
  args) + AuditTimeline ordering (custom).
- **API:** guard MCP `audit_read` (newest-first N); no server filter → client-side.

---

### S11 · `/settings/agent` Agent Config

**Purpose:** inspect/edit the Sentinel agent manifest: model binding, approval-required
tools, capabilities, skills attachment.

```
│ AGENT — sentinel                                    [discard] [save (approval)] │
│ ┌ FINE-TUNE CARD STYLE INSPECTOR ────────────────────────────────────────────── │
│ │ name [sentinel]   model [deepseek-v4-flash ▾]   temperature [0.2]            │
│ │ require_approval_for_tools:                                                  │
│ │   [✓] request_intrusive_approval  [✓] scope_add  [✓] scope_remove  [+ tool]  │
│ │ capabilities: sub-agents☑ generative-ui☑ ask-user☑ compaction☑ iter-limit 80 │
│ │ skills: [sentinel-recon ✕] [sentinel-triage ✕] [+ attach skill]              │
│ │ sandbox: enabled☑ file_downloads☑                                            │
│ │ ① manifest diff preview (before → after, Diff Table)                         │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- **Regions:** edits stage locally; save produces a diff preview then routes through
  connector mutation (approval if annotated); ① uses Diff Table red/green lines.
- **Live data:** static fetch; dirty-state guard on route leave.
- **States:** loading inspector skeleton; save-conflict (stale etag) → reload-merge
  prompt; unchanged save disabled.
- **Components:** Fine-tune Card (inspector pattern), Diff Table, Tool Chips
  (tool selector).
- **API:** `GET/PUT /api/v1/agents[/name]` (CRUD per brief).

---

### S12 · `/settings/models` Models & Providers

**Purpose:** browse catalog, manage provider keys, set default model.

```
│ MODELS                                     default: deepseek-v4-flash [set def]  │
│ ┌ MODEL                  PROVIDER   CTX     IN/OUT $/M   KEY      ACTIONS ───── │
│ │ deepseek-v4-flash ●    deepseek   128k   0.04/0.08  ● valid   [test] [use]    │
│ │ claude-sonnet-4-5      anthropic  200k   3/15      ○ missing [add] [use]    │
│ │ gpt-5-mini             openai     400k   0.25/2    ● valid   [test] [use]    │
│ └─────────────────────────────────────────────────────────────────────────────── │
│ ① [test] pings provider with 1-token completion → latency + cost estimate chip  │
```

- **Regions:** key status dots; test action shows latency chip; default selector
  writes harness settings.
- **Live data:** catalog cached 1h; key tests on-demand.
- **States:** catalog fetch fail → cached + stale tag; invalid key → red dot + inline
  remediation link.
- **Components:** Records Table, Insight Cards not needed, Context Cards (cost note).
- **API:** model catalog + settings endpoints (`/models`, `/settings` per brief).

---

### S13 · `/settings/connectors` Connectors

**Purpose:** manage MCP connectors and expose per-tool annotations so operators can
see exactly which tools will trigger pauses.

```
│ CONNECTORS                                                    [+ add connector] │
│ ▾ scope-guard  ● :9930/mcp   bearer ● set          [edit] [remove] [↻ reload]  │
│ │   tools (9):  scope_check ◇read   request_intrusive_approval ⚠destructive     │
│ │               verify_grant ◇mutating-lite  scope_add ⚠  scope_remove ⚠        │
│ │               scope_list ◇  audit_read ◇  policy_get ◇  osv_query/get ◇       │
│ ▸ osv          ● host-side                        [expand]                      │
│ ① destructive count per connector shown as red chip = expected pause points     │
```

- **Regions:** accordion rows; tool grid with annotation badges (◇ readOnlyHint /
  ⚠ destructiveHint) pulled from tools list — this is where operators verify the
  approval contract before trusting a run.
- **Live data:** tools list refetch on expand/reload.
- **States:** connector unhealthy → red dot + last-error tooltip; zero tools → warn.
- **Components:** Records Table (accordion), Tool Chips, Approval Card (remove).
- **API:** connectors CRUD + `tools` listing endpoints.

---

### S14 · `/settings/skills` Skills

**Purpose:** CRUD attached playbooks; view git-backed SKILL.md sources.

```
│ SKILLS                                                            [+ attach]    │
│ ┌ NAME             SOURCE            VERSION   UPDATED    ACTIONS ────────────  │
│ │ sentinel-recon   git · this repo   main@a1b2 2h ago     [view] [detach]       │
│ │ sentinel-triage  git · this repo   main@a1b2 2h ago     [view] [detach]       │
│ └────────────────────────────────────────────────────────────────────────────── │
│ [view] → side drawer: rendered SKILL.md + raw markdown tab (Code Block)         │
```

- **Live data:** fetch-on-mount; version pins refreshed on reload.
- **States:** empty → "agent runs without playbooks" warning; git sync fail → amber.
- **Components:** Records Table + Code Block (drawer, tabs rendered/raw) + Approval
  Card (detach).
- **API:** skills CRUD endpoints.

---

### S15 · `/settings/sandbox` Sandbox

**Purpose:** Daytona provider settings + live posture readout (isolation story at a
glance).

```
│ SANDBOX — execution isolation                                                   │
│ provider [daytona ▾]   api key ● set   idle teardown [10m ▾]   downloads [☑]    │
│ ┌ POSTURE READOUT ──────────────────────────────┐  ┌ ACTIVE ─────────────────┐ │
│ │ secrets in sandbox: never (harness-held)      │ │ vm lab-9f2 ● up 18m     │ │
│ │ egress: git+npm allowlist during bootstrap    │ │ cpu 3% mem 212mb        │ │
│ │ residual risk: TOCTOU rebinding (documented)  │ │ [destroy] (approval)    │ │
│ └───────────────────────────────────────────────┘  └─────────────────────────┘ │
```

- **Live data:** active-VM card from sandbox events/settings poll @30s.
- **States:** provider unreachable → banner; no active VM → idle note.
- **Components:** Context Cards, Fine-tune Card (form region), Approval Card (destroy).
- **API:** sandbox settings endpoints + sandbox lifecycle events.

---

### S16 · ⌘K Command Palette (overlay)

**Purpose:** keyboard-first ops: jump to mission/target/CVE, run actions, quick
scope-add without leaving current screen.

```
        ┌───────────────────────────────────────────────┐
        │ > nmap_                                       │
        ├───────────────────────────────────────────────┤
        │ ▸ go to finding  SEN-7 dir-listing (m_8f3k)   │
        │ ▸ action  add scope entry…           ↵        │
        │ ▸ mission  m_8f3k lab.local:3000 ● running    │
        │ ▸ command  approve next pending       ⌘⇧A     │
        │ ▸ settings  connectors                        │
        └───────────────────────────────────────────────┘
```

- **Behaviors:** fuzzy across missions (id/target/status), findings (id/title),
  routes, actions (`new mission`, `approve next`, `toggle dock mute`);
  quick scope-add prefills S8 add-input; recent missions ranked top.
- **States:** zero results → "no matches — try a CVE id"; action requiring approval
  routes through normal flow (palette never bypasses checkpoints).
- **Components:** Search/command palette primitive verbatim.
- **API:** client-side index over loaded stores; lazy `GET /sessions` if cold.

---

### S17 · ApprovalDock (global overlay)

**Purpose:** mission-agnostic floating stack so a pending approval is actionable from
any screen within one keystroke — the strongest expression of principle #1.

```
                                              ┌ APPROVAL · m_8f3k ──────────────┐
                                              │ nmap -sV lab.local:3000  ⚠      │
                                              │ waiting 00:42                   │
                                              │ [deny ✗D]  [details ↗] [allow ✓A]│
                                              └─────────────────────────────────┘
                                              ● 2 pending — j/k to cycle
```

- **Behaviors:** stacks newest-bottom; collapsed to pill `⛨ 2` when dismissed
  (re-expands on click or `⌘⇧A`); muted per-session; deciding here = same resume
  POST as S7; `details ↗` deep-links to the stream card.
- **States:** hidden entirely when queue empty; stale (owning session gone) → auto-
  dismiss with audit-safe note.
- **Components:** Approval Card compact variant + Selection Actions.
- **API:** identical approval resume contract; presence driven by same SSE/poll
  aggregation as board column ②.

---

## 4 · Approval flow deep-dive

### 4.1 Event origin

Harness emits `tool.approval_required {toolCalls[]}` on the session SSE. The console
instantly: (a) renders inline Approval Card in the owning mission's feed pinned above
composer, (b) flips board card into column ② NEEDS YOU, (c) increments sidebar badge,
(d) pushes onto ApprovalDock, (e) flashes `document.title` "(2) Sentinel" and fires
optional OS notification if opted in at S2.

### 4.2 Card anatomy (full variant)

```
┌ APPROVAL REQUIRED · m_8f3k · waiting 00:42 ──────────────────────────────────┐
│ ⚠ destructive   ◇ single-use grant   ○ reversible: no                        │
│ tool    request_intrusive_approval                                           │
│ cmd     nmap -sV --top-ports 1000 lab.local:3000                             │
│ target  lab.local:3000   (canonical)   class private                         │
│ scope   ✓ matches entry "localhost"                                          │
│ batch   1 of 1 calls   ·   grant TTL if allowed: 10:00                       │
│ deny reason [ optional but recommended______________________ ]               │
│                          [ DENY  ✗ D ]        [ ALLOW  ✓ A ]                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

Design rules:
- Target, canonical form, and matching scope entry are **always** visible — an
  operator approves an authorization fact, not a vibe.
- ALLOW is visually secondary-weight until hovered/focused (prevents Enter-slam);
  DENY never destructive-red-punishing — denial is a normal outcome, tinted neutral.
- Countdown `waiting mm:ss` is informational (turn blocks indefinitely); the *grant*
  carries the real clock after allowance.

### 4.3 Decision interaction

| Input | Behavior |
|---|---|
| Click ALLOW | Optimistic state `allowing…`; POST resume `user.tool_approval {status:"allow"}`; on ack → card morphs to granted state showing GrantChip fingerprint + live TTL meter |
| Click DENY | If reason empty → subtle nudge ("reason improves audit") but still one-click deny; POST `{status:"deny",reason}`; card collapses to denied strip; agent receives denial and adapts |
| `A` / `D` keys | Act on focused card (focus ring mandatory; nothing auto-focuses on load) |
| `Enter` | Never binds to ALLOW globally — only when card focused AND hover-intent seen ≥250ms (accident guard) |
| Esc | Dismiss dock card (not a decision) |

Deny-with-reason text is persisted into the audit trail via the resume arg `reason`.

### 4.4 Timeout / expiry handling

Two clocks, both surfaced:

1. **Decision clock (soft):** turn waits forever; after 5 min idle the card shows
   gentle pulse + "still waiting" so it isn't forgotten. No auto-decision ever —
   auto-allow is forbidden by product principles; auto-deny equally (silent failures
   hide intent).
2. **Grant clock (hard):** after Allow, guard mints token with `expires_at = now+10m`.
   Console shows TTL meter on GrantChip. If agent hasn't consumed by T-60s: amber
   warning chip "grant expiring". On expiry: chip → `EXPIRED`, stream typically shows
   the agent re-requesting → a **new** Approval Card spawns (fresh human decision).
   Dock groups these as "re-request" chained to the original card for context.

Wrong-target consumption does NOT burn the grant (guard semantics) — console reflects
that by keeping TTL running and annotating "invalid attempt recorded".

### 4.5 Multi-call batches

`toolCalls[]` may contain N calls. Rules:

- Card lists every call as a checkbox row (Task Rows) with per-call target + danger
  badge; **all checked by default** to match operator mental model of "the agent asked
  for this plan".
- Buttons become `[approve selected (n/N)]` `[deny batch]`.
- Resume protocol posts **one** `user.tool_approval` per toolCallId (endpoint takes
  single id): console loops sequentially; optimistic UI marks each row as sent;
  partial failure → retry banner naming the failed id, decided rows stay decided.
- Mixed danger batches (e.g., scope_add + benign read) force per-call review: mixed
  batches uncheck-all by default and disable bulk-allow until each row was touched once.

### 4.6 Post-decision surfaces

Every decision writes three echoes: feed strip in stream (`✓ allowed by you · 14:03:02`),
row in mission audit tab (`human-via-agent`), row in `/audit`. Denials additionally
surface in the board card tooltip for the rest of the mission ("1 denied request").

---

## 5 · Live data strategy

### 5.1 Transport matrix

| Surface | Primary | Fallback | Cadence |
|---|---|---|---|
| Board session list | Poll `GET /sessions` (ETag) | — | 5s, backoff→15s on errors |
| Mission stream events | SSE `subscribe-to-running-turn` | `GET /sessions/{id}/events?after=cursor` | push; heartbeat 15s |
| Approvals presence | Same SSE (approval_required/done events) | `required_actions` in polled sessions | push |
| Audit explorer | Tail poll `audit_read(limit)` | — | 10s + manual ⟳ |
| Scope / grants | Fetch-on-mount + window-focus refetch | — | manual + event-driven |
| Sandbox posture | Settings poll | sandbox.created events | 30s |
| Model catalog / connectors | Fetch + 1h cache | — | on-expand |

### 5.2 SSE reconnect & resume

- Client tracks monotonic cursor = last received event seq/id.
- Drop detection: heartbeat missed ×3 (~45s) → state `reconnecting`, amber strip on
  affected surfaces, data dimmed not hidden.
- Reconnect: re-open subscription carrying cursor; server replays gap; on 4xx/expired
  subscription → full backfill via `GET /sessions/{id}/events?after=cursor`, then
  resubscribe. Backfill renders as compact "▲ N events replayed" divider, not spam.
- Page load mid-run: hydrate from `GET /sessions/{id}` + `GET turns` + events replay,
  then subscribe — order guarantees no flicker-of-empty.
- Tab visibility: SSE stays connected; polls pause when hidden, resume + immediate
  refetch on focus.

### 5.3 Optimistic updates

| Action | Optimistic behavior | Rollback |
|---|---|---|
| Approval allow/deny | Card → `sending…` state instantly; board card moves columns | revert card + toast w/ retry on POST error |
| Batch decisions | Per-row `sent` ticks accumulate | only failed row reverts |
| New mission | Row appears in RUNNING w/ `syncing` shimmer | remove + inline error on create fail |
| Scope add/remove request | Row enters `pending approval` state | revert + audit-link toast |
| Sign-off | Stamp renders immediately w/ `persisting…` | watermark returns + error banner |

Rule: optimism only where the operator's intent is unambiguous; anything touching the
guard's authorization state shows its true pending/approved state, never fakes success.

### 5.4 Degradation ladder

harness down → board banner + frozen-but-labeled data; SSE down/harness up → polling
mode chip on stream header; guard (:9930) down → Grants/Scope/Audit banners "cached,
may be stale", approvals unaffected (they're harness-side); model provider down →
visible in stream as failed model.message retries.

---

## 6 · Component inventory

| Beautiful-UI primitive | Console usage | Custom variant needed |
|---|---|---|
| Loading State | board skeletons, replay hydration, test-ping | `PixelLoader` w/ phase label ("replaying 214 events…") |
| Thinking | model trace blocks in stream | add `verdict-tinted` step icons (allow/deny) |
| Streaming Text | model.message rendering | — |
| Approval Card | stream cards, queue, dock | variants: `compact`(dock), `batch`, `question`(response_required) |
| Tool Chips | every tool.call/response | `GrantChip` (fingerprint+TTL meter+state) |
| Task Rows | queue list, batch rows, checklists | — |
| Chat composer | follow-up instructions | — |
| Prompt Bar | new-mission target input, composer upgrades | `@sources` limited to `/artifacts`, `/scope` |
| Recommendation Card | preflight verdicts, remediation nudges | `ScopeVerdictCard` w/ match-entry citation |
| Context Cards | right rail: target/sandbox/grants | `TargetCard` (canonical+class), `SandboxCard` |
| Diff Table | manifest editor, evidence diffs | — |
| Records Table | findings, grants, audit, scope, models, skills, connectors | `VirtualRecordsTable` for audit; `SeverityBadge` cell |
| Filter Table | board columns, table filter bars | `VerdictPill` filter chips |
| Sidebar Nav | app shell | `PendingBadge` count bubble |
| Search/command palette | ⌘K | actions include guarded ones routing thru approval |
| Flowchart | P2 mission plan visualization (phase DAG) | dotted canvas w/ approval gate nodes |
| Insight Cards | P2 grants consume-rate, findings-over-time, spend | paged per mission |
| Code Block | artifacts, args JSON, report JSON, skill source | `EvidenceBlock`: line numbers + diff tab + artifact meta header |
| Selection Actions | findings multi-select, batch approvals | — |

Custom primitives (no beautifului equivalent): `SeverityBadge` (5-ramp), `AuditTimeline`
(verdict-bordered rows, actor badges), `ScopeEntryRow` (canonical form + class +
expiry), `GrantChip`, `TTLmeter`, `HealthStrip` (footer), `ApprovalDock` (layout).

---

## 7 · Visual language

Tokens (mirror `docs/ARCHITECTURE.html` exactly):

| Token | Value | Use |
|---|---|---|
| bg | `#0d1117` | app background |
| panel | `#161b22` | cards, sidebar, tables |
| panel2 | `#1c2330` | insets, code, th backgrounds |
| line | `#30363d` | borders, dividers |
| text | `#e6edf3` | primary |
| dim | `#8b949e` | secondary, metadata |
| accent | `#58a6ff` | interactive, links, focus rings, running |
| green | `#3fb950` | allowed/consumed/verified/sandbox-ok |
| amber | `#d29922` | pending/expiring/warnings |
| red | `#f85149` | denied/destructive/critical/guard-down |
| purple | `#bc8cff` | model/thinking/human-via-agent actor |
| orange* | `#f0883e` | severity HIGH only (*new token, GitHub-dark family) |

Severity ramp: CRITICAL `#f85149` · HIGH `#f0883e` · MEDIUM `#d29922` · LOW `#58a6ff`
· INFO `#8b949e` — dot+label, colorblind-safe via always-present label.

Typography: mono = `"SF Mono", ui-monospace, Menlo, Consolas, monospace` for targets,
commands, ids, timestamps, table cells; sans = `-apple-system, "Segoe UI", Inter` for
prose/report body. Scale: 11px meta / 12px table+UI / 13px body / 15px section / 20px
page title (letter-spacing −0.02em). Uppercase +0.08em tracking for section headers
and table headers only.

Spacing/radius: 4px base grid (paddings 8/12/16/24), radius 8px cards / 10px panels /
999px pills / 4px code. Borders 1px `--line`; elevation avoided except dock (shadow
`0 8px 24px rgba(0,0,0,.5)`) and focused approval card (`0 0 0 1px var(--accent)`).

Motion: 150ms ease-out standard; approval card entrance 200ms slide-up; pending pulse
2s opacity 1→0.6; TTL meters update per-second without animation; NO decorative motion
anywhere — movement signals state change only. Reduced-motion: pulses/strips become
static tints.

Density: tables 32px rows; feed rows auto; max content width 1440px; right rail fixed
320px; sidebar 232px collapsible to 56px icon rail.

Iconography: lucide, 14px, stroke 1.75; semantic anchors — ⛨ shield=grants/approvals,
◎ circle-scope, ☰ list-audit, ⚠ triangle=destructive, ◇ diamond=read-only.

---

## 8 · Build phases

### P0 — MVP "one safe run" (≈8–10 eng-days)

The demo-critical spine: shell (sidebar/topbar/health strip), Board (S1), Mission
Stream (S3) with full SSE + replay + reconnect, Approval Card inline + ApprovalDock
(S17) + board column ②, New Mission modal (S2) with preflight scope check, composer.
Keyboard A/D. Empty/loading/error states for these surfaces only.

### P1 — Operator trust layer (≈8 days)

Findings (S4), Report + sign-off (S5), Mission audit slice (S6), Approval Queue (S7)
w/ batches, Scope Manager (S8) w/ validation + approval-gated mutations, full Audit
Explorer (S10), command palette (S16), deny-reason UX polish, exports.

### P2 — Fleet & depth (≈10–12 days)

Settings suite (S11–S15), Grants Ledger (S9) + Insight Cards (consume rate, spend,
findings-over-time), Flowchart mission-plan view (phase DAG w/ approval-gate nodes),
EvidenceBlock diff viewer, OS notifications, virtualized audit at 100k+ rows, theme
tweaks from operator feedback.

Sequencing rule: no P1 screen ships before the approval loop of P0 is hardened —
everything else exists to serve that moment.

---

## 9 · Open questions

1. **Board aggregation:** does TrueForge offer a cross-session SSE/feed, or must the
   console fan out one subscription per running session plus 5s list polling? (Assumed
   latter; affects P0 effort ±2 days.)
2. **Report sign-off persistence:** is DRAFT→FINAL a harness-side field we should
   write via an endpoint, or console-managed state with an audit annotation? Spec
   assumes console-local + audit note pending answer.
3. **Findings as objects:** are findings queryable via API, or parsed from
   `tool.response`/artifacts client-side? Spec assumes client-parse with a stable
   artifact schema contract.
4. **Console auth:** open-local like the guard's dev mode, or parity with GUARD_TOKEN
   bearer for the console itself? Affects settings-route gating and the auth chip in
   the health strip.
5. **Batch resume granularity:** can `user.tool_approval` address individual calls
   inside one `toolCalls[]` batch independently, or does the harness expect all-or-
   nothing per turn? Spec assumes per-call loop; mixed-danger UX depends on it.
