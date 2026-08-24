# Sentinel setup guide

One-time setup, in order. Everything happens on your machine.

## 0. Prerequisites

- Node.js ≥ 22.14 (`node --version`)
- pnpm (`npm i -g pnpm`)
- A free [Daytona](https://www.daytona.io) account → create an API key with
  permissions: *write snapshots*, *delete snapshots*, *write sandboxes*
- A model provider key OR a local Ollama (see step 2)

## 1. Install and start the pieces

```bash
pnpm install
pnpm build
pnpm scope-guard &     # authorization MCP server  -> http://127.0.0.1:9930/mcp
pnpm harness           # TrueForge                  -> http://localhost:8790
```

> Note for contributors on fresh clones in August 2026: `@truefoundry/trueforge`
> 0.1.4 pins `@aws-sdk/client-s3@^3.1117.0` which npm could not resolve at the
> time; this repo carries a pnpm override to `3.1116.0`. Remove the override
> once upstream resolves.

Verify the guard:

```bash
curl -s http://127.0.0.1:9930/healthz
node mcp/scope-guard/scripts/smoke.mjs   # runs 7 protocol checks
```

## 2. Connect a model (TrueForge UI → Settings → Models)

**Cloud provider** — pick it from the catalog, paste the API key, done.

**Local Ollama** — Settings → Models → *custom* provider:
- Name: `ollama-local`
- Base URL: `http://localhost:11434/v1`  (OpenAI-compatible endpoint)
- API key: any non-empty string (Ollama ignores it)
- Models: add each tag you pulled, e.g. `qwen3:8b`

Recommended local model for agent tool-use: `ollama pull qwen3:8b`
(fits 16 GB machines). Coder-only models tend to fumble multi-step tool loops.

## 3. Register scope-guard as a connector

Settings → Connectors → **Add MCP Server**:

- Name: `scope-guard`
- URL: `http://127.0.0.1:9930/mcp`
- Auth: none

Click through — tools list should show the six guard tools.

## 4. Sandbox provider

Settings → Sandbox providers → Daytona preset → paste API key → Save.

## 5. Skills

Skills are git-backed and imported from a repository. After pushing this repo to
GitHub (public — required by the hackathon anyway):

Settings → Skills → **Import from GitHub** →

- `<your-org>/sentinel`, path `skills/recon`
- `<your-org>/sentinel`, path `skills/triage`

## 6. Save the Sentinel agent

Either recreate via UI (chat → compose → Save Agent):

- Model: your pick from step 2
- Connectors: enable `scope-guard`, preload ON
- Skills: enable both sentinel skills
- Sandbox: ON
- Capabilities: all ON (sub-agents matter — one per target)
- Instructions: paste from `agent/sentinel.agent.json` `.manifest.instructions`

Or apply the manifest exactly via the SDK:

```bash
npx tsx scripts/apply-agent.ts
```

(sets `TRUEFORGE_BASE_URL` + edits the model name in
`agent/sentinel.agent.json` first)

## 7. Demo target

```bash
./target/run-juice-shop.sh    # OWASP Juice Shop -> http://localhost:3000
```

localhost is already in the default scope.

## 8. First run

In the chat with the Sentinel agent:

```text
Assess http://localhost:3000 end to end: passive fingerprint first,
then ask me before anything intrusive, then produce the findings report.
```

Expected beats: scope_check calls → passive curl in sandbox →
approval card for the port sweep → grant token in commands → OSV lookups →
`artifacts/localhost.report.md`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Connector tools list empty | guard not running or URL missing `/mcp` |
| Skills tab empty | skills must be pushed to GitHub and imported |
| Sandbox never provisions | Daytona key missing scopes (write/delete snapshots) |
| Local model loops on tool calls | switch model; qwen2.5-coder is weak at agentic loops |
