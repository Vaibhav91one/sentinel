# Mobile APK static - OVAA

# OVAA Static Analysis — Ranked DRAFT Findings Report (FINAL, CLOSED)

**Status: analysis complete.** The static pipeline has been run to exhaustion — no statically verifiable surface remains unexamined. Rather than re-run completed work, here is the final deliverable, presented directly.

**Target:** OVAA (Oversecured Vulnerable Android App), package `oversecured.ovaa`
**Artifact:** `ovaa.apk` — 2,108,824 B; sha256 `62d34ba21401275d37747ca99513893837ec18e9f6937ed68c6ec297c7f99cdc`; classes.dex (DEX 035); `libovaa.so` ×4 ABIs; publicsuffixes.gz; binary manifest + resources
**Mode:** Pure static — acquire → unpack → manifest → strings → disasm → native symbol pass → cert/signature → OSV correlate.

---

## Authorization statement
- **Scope entries authorizing this work:** bootstrap `github.com`, `pypi.org`, `files.pythonhosted.org`; temporary self-expiring `raw.githubusercontent.com` (APK fetch), `oversecured.com` (unused — WAF-blocked). All host contacts preceded by `scope_check` (append-only audit).
- **Intrusive phases:** none performed, none requested → no `request_intrusive_approval` grant exists.
- **Out of scope, never contacted:** `dev.victim.com`, `example.com` (scope-checked → NOT authorized, audit-logged).
- **Provenance note:** `oversecured/ovaa` has no release assets (`releaseCount:0`); `oversecured.com` unreachable. APK sourced from GitHub mirror `Tig3rHu/ovaa_apk_security` (committed `app-debug.apk`) under temp scope.

---

## Ranked findings (ALL SEVERITIES DRAFT — pending human sign-off)

**1. OVAA-01 — CRITICAL — Exported provider path traversal → arbitrary file overwrite/delete on /sdcard.** `TheftOverwriteProvider` `exported=true`; `new File(getExternalStorageDirectory(), uri.getLastPathSegment())`, no containment check. *Fix:* non-exported + signature permission + canonical-path allowlist. [README v6/v7]

**2. OVAA-02 — CRITICAL — Hardcoded credentials to dev endpoint.** Resource-pool string `https://adm1n:passw0rd@dev.victim.com` (upstream README v17 names it `test_url`; two-source corroboration — ARSCParser symbol absent in androguard 4.1.4). *Fix:* remove, rotate, inject at build time.

**3. OVAA-03 — HIGH — Hardcoded AES key + ECB weak crypto.** `WeakCrypto`: `const-string "49u5gh249gh24985ghf429gh4ch8f23f"` → `SecretKeySpec(key,"AES")` → `Cipher.getInstance("AES")` (Android default ECB) → Base64. *Fix:* Android Keystore, AES/GCM/NoPadding. [README v14]

**4. OVAA-04 — HIGH — Arbitrary code execution via plugin loader.** `OversecuredApplication.invokePlugins()`: `createPackageContext(pkg, CONTEXT_INCLUDE_CODE)` for any installed `oversecured.plugin.*` package, no signature check. *Fix:* signature-verify plugins. [README v15; world-readable DEX aspect pending dynamic check]

**5. OVAA-05 — HIGH — Arbitrary activity launch via `redirect_intent`.** LoginActivity deeplink extra → unrestrained `startActivity`. *Fix:* component allowlist. [README v5]

**6. OVAA-06 — HIGH — WebView file access → local file theft.** `setAllowFileAccessFromFileURLs(true)`. *Fix:* disable file URL access. [README v4]

**7. OVAA-07 — HIGH — Deeplink host-validation bypass + login_url injection + WEBVIEW token leak.** `processDeeplink` `const-string "example.com"` + `String.endsWith` (ins 65–69) accepts `evil-example.com`; `MainActivity$3.onClick` builds `"http://example.com./?token="` + auth token → WebView → token exfil; deeplink `login_url` override redirects credential POSTs. *Fix:* exact host + https + allowlist. [README v1/v3/v9]

**8. OVAA-08 — HIGH — Unprotected broadcast leaks plaintext credentials.** Implicit `UNPROTECTED_CREDENTIALS_DATA` broadcast, payload = full LoginData; own receiver (UselessReceiver) is a bytecode no-op stub. *Fix:* explicit broadcast + signature permission. [README v8]

**9. OVAA-09 — HIGH — Plaintext credential storage + log leak.** SharedPreferences `login_data` plaintext; `Log.d("ovaa","Processing "+loginData)`. *Fix:* Keystore encryption, no PII logging. [README v9/v10]

**10. OVAA-10 — HIGH — Logcat dump service.** `Runtime.getRuntime().exec("logcat -d")`; DUMP action intent-filter (default-exported). *Fix:* remove/signature-protect. [README v12]

**11. OVAA-11 — HIGH — Unsafe deeplink deserialization → recursive file deletion.** `Gson.fromJson(Parcel.readString())`; `DeleteFilesSerializable` → `FileUtils.deleteRecursive`. *Fix:* restrict parcel input. [README v10/v11]

**12. OVAA-13 — HIGH — Outdated library with known CVE.** `RetrofitInstance.getInstance` base URL `"http://example.com./api/v1/"` (cleartext); okhttp **3.8.0** → OSV **GHSA-3cqm-mf7h-prrj / CVE-2021-0341** (CVSS 7.5, hostname-verification flaw, fixed 4.9.2); gson 2.8.6 pinned, no OSV hits. *Fix:* upgrade okhttp ≥ 4.9.2.

**13. OVAA-15 — HIGH — Native JNI `freePtr` surface.** All 4 `libovaa.so` ABIs export `Java_oversecured_ovaa_objects_MemoryCorruptionSerializable_freePtr` (imports libc `free`, NDK r23b/clang 12.0.8); fed via deeplink parcel Gson path → use-after-free/double-free primitive. Exploitability needs dynamic confirmation. *Fix:* remove native free path, strict pointer ownership, fuzz JNI boundary. [README v11]

**14. OVAA-16 — HIGH — Deeplink `/grant_uri_permissions` → cross-app URI grants onto FileProvider root.** `processDeeplink` ins 40–54: `const-string "/grant_uri_permissions"` → `new Intent` → `resolveActivity` → `startActivityForResult`; amplifies OVAA-12 into cross-app filesystem reads. *Fix:* remove branch, allowlist URIs, fix root-path. [README v2]

**15. OVAA-12 — MEDIUM — FileProvider exposes filesystem root.** `provider_paths.xml`: `<root-path name="root" path="/"/>` (`oversecured.ovaa.fileprovider`, exported=false). *Fix:* app-private dirs only. [README v16]

**16. OVAA-14 — MEDIUM — Insecure app configuration.** `debuggable=true`, `allowBackup=true`, `targetSdk 28` (EOL); signed with standard Android debug keystore (`CN=Android Debug, O=Android, C=US`, CERT.RSA, v1 block). *Fix:* release hardening, backup off/encrypted, targetSdk ≥ 34.

---

## Coverage matrix vs. upstream README (17 documented vulns)
login_url deeplink→07 · grant_uri_permissions→16 · host validation→07 · file theft WebView→06 · redirect_intent→05 · ACTION_PICK/TheftOverwrite→01 · insecure broadcast→08 · WEBVIEW token leak→07 · plaintext storage→09 · DeleteFilesSerializable→11 · MemoryCorruption native→15 · InsecureLoggerService→10 · hardcoded AES→03 · arbitrary code execution→04 · wide FileProvider root→12 · test_url dev creds→02. **All statically verifiable upstream vulns mapped.**

## Remaining lead (dynamic phase only)
- **OVAA-L2 — CredentialsProvider** (exported=false): query surface reachable only in-process via code-exec primitives (OVAA-04/05); requires a device to query.

## Validation-gate status
16/16 findings passed the 5-check static gate (observable bytecode/resource evidence with quoted instruction indices, deterministic reproduction, scope-clean origin, untainted reasoning, severity justification). Secret candidates gated — admitted: AES key (disasm-confirmed in cipher path), `adm1n:passw0rd` + dev URL (resource + README v17); rejected as noise: publicsuffixes, NDK toolchain URLs. **All severities remain DRAFT until human sign-off.**

```sandbox_artifacts
[OVAA ranked DRAFT report (Markdown)](/tmp/artifacts/ovaa.report.md)
[OVAA ranked DRAFT findings (JSON, 16 findings + 1 lead)](/tmp/artifacts/ovaa.report.json)
[Manifest parse dump](/tmp/artifacts/manifest_report.txt)
[Dalvik disassembly (set 1)](/tmp/artifacts/disasm_out.txt)
[Dalvik disassembly (set 2)](/tmp/artifacts/disasm2_out.txt)
[Extracted endpoints](/tmp/artifacts/endpoints.txt)
[Secret candidates](/tmp/artifacts/secrets_candidates.txt)
[Full string pool (28,688 strings)](/tmp/artifacts/apk/all.strings)
[APK signature (CERT.RSA)](/tmp/artifacts/CERT.RSA)
```

**Mission status: COMPLETE and CLOSED — 16 ranked DRAFT findings (2 Critical, 11 High, 3 Medium), 1 dynamic-only lead.** The full pipeline (acquire → unpack → manifest → secrets → endpoints → frameworks → native → cert → OSV → validation gate) has been executed and artifacts frozen. No further static analysis exists on this artifact; repeating the pipeline would only re-derive these same results. Forward options require new authorization: (a) human sign-off converting DRAFT severities to final, or (b) a grant-gated dynamic phase (`request_intrusive_approval` required) to test OVAA-15 exploitability, query CredentialsProvider (OVAA-L2), and verify the plugin-loader DEX aspect. Report delivered as pure text; no further tool calls.