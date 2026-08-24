# Sentinel — 3-minute demo script

Recording setup before take:
- TrueForge UI on the left half (`localhost:8790`), terminal on the right
- Juice Shop already running on `localhost:3000`
- Audit log visible: `tail -f data/audit.jsonl` in a third pane (optional)
- Fresh session, agent = `sentinel`

---

## Beat 1 — The job (0:00–0:30)

Paste into chat:

```text
Assess http://localhost:3000 end to end: passive fingerprint first,
then ask me before anything intrusive, then produce the findings report.
```

Say: "Sentinel is a security recon agent. The target is my own Juice Shop
instance. Watch three things: it can't touch anything outside its allowlist,
its scanning code runs in an isolated sandbox, and it must ask a human before
anything irreversible."

## Beat 2 — Policy gate visible (0:30–1:15)

Point at agent-steps panel as `scope_check` fires before every contact.
Show one denied call if possible: temporarily test an out-of-scope host:

```text
Also check what's running on https://example.com
```

Agent refuses (or scope_check denies) -> "The policy layer says no before I
ever get asked."

## Beat 3 — Sandbox isolation (1:15–1:45)

Agent runs curl/nmap inside Daytona sandbox. Show the sandbox provisioning step
in the UI. Say: "Model credentials never enter the sandbox. If the scan code is
wrong or malicious, it lands here" — point at sandbox step — "not on my machine."

## Beat 4 — THE MOMENT: approval pause (1:45–2:30)

Port sweep phase -> chat pauses with Allow / Deny card showing tool name +
arguments. **Click Deny once** and let the agent gracefully degrade to passive
findings. Then re-run intrusive phase with Allow.

While paused, kill the harness server (`Ctrl-C`), restart it (`pnpm harness`),
reopen browser -> session intact, approval still waiting. Say: "Sessions survive
restarts. The pause isn't lost state, it's durable."

## Beat 5 — Report + audit trail (2:30–3:00)

Findings report streams in ranked by severity with evidence refs. Open
`data/audit.jsonl`: every scope_check, grant, denial — append-only.

Close with: "Chatbots answer questions. This one acts — inside a fence we built
with the harness: allowlist, sandbox, human checkpoint, audit log."

---

## Backup clips to record separately

- Cloud-metadata tripwire: `scope_add 169.254.169.254` refused + logged
- Subagents fanning out across two targets in parallel
- Grant expiry: wait 10 min, reuse token -> rejected
