# Contributing to Sentinel

Thanks for looking under the hood. This repo is an Agent Harness Hackathon
submission, but it is built like software meant to outlive the week.

## Setup

```bash
pnpm install && pnpm build
node --env-file=.env scripts/usage.mjs status   # optional, DeepSeek spend guard
pnpm scope-guard &                              # policy MCP server :9930
pnpm harness                                    # TrueForge :8790
```

Copy `.env.example` to `.env` for local keys. Never commit real keys.

## Ground rules

1. **PRs only.** Nothing lands on `master` without review — that trail is part
   of the project's evidence.
2. **Qodo reviews every PR.** Address what it finds before merge or reply and
   explain why a finding does not apply.
3. **Scope changes are security changes.** Anything touching
   `mcp/scope-guard/src/scope.ts` or the grant logic needs tests in the PR and
   a sentence in the description about the threat model.
4. **No secrets, ever.** Keys live in `.env` (gitignored). The demo target's
   "secrets" are fake on purpose; do not replace them with real ones.

## Testing

```bash
node mcp/scope-guard/scripts/smoke.mjs     # 7 protocol checks against a running guard
```

CI runs build + smoke on every push. Keep it green.

## Commit style

Short imperative subject, blank line, body explaining *why* when not obvious.
