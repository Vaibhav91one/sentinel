---
name: sentinel-mobile
description: Mobile APK static-analysis path for the Sentinel agent. Use when given an Android APK - static triage without a device: manifest analysis, hardcoded secret hunting, endpoint extraction, and dependency fingerprinting.
---

# Sentinel mobile APK static playbook

No device, no emulator: pure static triage inside the sandbox. Pipeline:
ACQUIRE → UNPACK → MANIFEST → SECRETS → ENDPOINTS → CORRELATE.

## Phase 1 — acquire (grant-gated if operator-supplied URL; github releases
are in-scope)

```bash
curl -sSL <apk-url> -o /tmp/artifacts/app.apk   # APK = zip container
mkdir -p /tmp/artifacts/apk && cd /tmp/artifacts/apk
unzip -q -o ../app.apk
```

## Phase 2 — structure

```bash
ls -la; ls -la lib/ assets/ res/raw 2>/dev/null
file classes*.dex
```

Note native libs (`lib/*/lib*.so`) — architecture + unusual libs are findings.

## Phase 3 — secrets & endpoints (strings-level, no jadx required)

```bash
for f in res/values/strings.xml assets/* classes*.dex; do
  [ -f "$f" ] && strings -n 8 "$f" >> /tmp/artifacts/apk/all.strings
done
grep -aiE 'https?://[a-z0-9./_-]+' /tmp/artifacts/apk/all.strings \
  | sort -u | tee /tmp/artifacts/apk/endpoints.txt
grep -aiE 'api[_-]?key|secret|token|password|BEGIN (RSA|EC)? ?PRIVATE' \
  /tmp/artifacts/apk/all.strings | sort -u | head -50 \
  | tee /tmp/artifacts/apk/secrets_candidates.txt
```

- Endpoints discovered become POTENTIAL live targets: scope-check each host via
  `scope_check` before any contact; unscoped hosts go to the report as
  "endpoints requiring authorization", never contacted directly.
- Secret candidates: verify by context (surrounding strings), dedupe, mark
  `verified:false` unless confirmed against a live endpoint the operator scoped.

## Phase 4 — manifest & binary quick checks (best-effort)

- `AndroidManifest.xml` is binary XML: extract readable strings for
  `android.permission.` list and exported activity/service names via strings.
- `classes*.dex`: `strings` reveals framework fingerprints (okhttp,
  flutter -> libflutter.so, react-native -> index.android.bundle).
- If `jadx`/`apkleaks` are installable (pip/npm), prefer them; otherwise state
  the limitation — string-level results are still valid findings with
  evidence refs.

## Report contract

Same ranked DRAFT format as sentinel-triage, with mobile-specific classes:
hardcoded credentials, embedded API endpoints, weak crypto references,
exported components (from permission strings), framework EOL notes.
Every finding: evidence_ref into apk/ artifacts + `because` sentence per
sentinel-validation gates.
