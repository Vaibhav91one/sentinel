All evidence is complete and verified. Here is the final report.

---

# DVWA DOM XSS — Confirm/Deny Assessment (DRAFT)

## Authorization & Scope

- **Scope entry authorizing this work:** `http://localhost:8081` — scope_check returned `allowed`, matching scoped allowlist entry **`localhost`** (audit log: "matches scoped entry \"localhost\"").
- **Intrusive phases human-approved:** YES. `request_intrusive_approval` was invoked for target `localhost:8081` (action: "DVWA DOM XSS confirm/deny at low/medium/high — headless chromium active probing") and was approved through the harness human checkpoint. A **lab-mode multi-use grant** was minted (60 min, loopback target), token `ea75247b…`, subsequently verified via grant_verify (`allowed`).
- All probing was executed inside the sandbox against the in-scope loopback lab target; no out-of-scope hosts were contacted.

## Method

Each security level was tested with a **headless Chromium (CDP, single-session)** browser. The execution marker is a **`document.title` mutation** (`document.title='SENTINEL_XSS_<LEVEL>'`), so a "confirmed" result requires the injected script to actually execute in the DOM (not merely appear as reflected source text). Evidence is the dumped `outerHTML` per level, greppable for the marker. Each MEDIUM/HIGH run was paired with a **negative control** (a `<script>` payload placed in the *query string*, which the server-side filter must reject) to prove the security level was genuinely active and not silently running as LOW.

The sink is identical at every level (`vulnerabilities/xss_d/index.php`):
```
document.write("<option value='" + lang + "'>" + decodeURI(lang) + "</option>");
```
Only the server-side input handling differs (`low.php`/`medium.php`/`high.php`).

## Results

| Level | Server-side filter | Verdict | Technique | Evidence |
|---|---|---|---|---|
| LOW | none | **CONFIRMED** | `<script>` in `default` | title → `SENTINEL_XSS_LOW`, marker ×3 |
| MEDIUM | blocks `<script` (case-insensitive) | **CONFIRMED** | `<img onerror=…>` event handler (no `<script` needed) | title → `SENTINEL_XSS_MEDIUM`, marker ×3 |
| HIGH | whitelist (`English/French/German/Spanish`) else redirect | **CONFIRMED** | `#fragment` bypass — fragment never sent to server, but re-inserted client-side by the vulnerable `document.write` | title → `SENTINEL_XSS_HIGH`, marker ×3 |

**Controls (negative evidence — filter active):**
- MEDIUM control (`<script>` in query, `security=medium`): BLOCKED → title unchanged, `CTRL_M` count **0**.
- HIGH control (`<script>` in query, `security=high`): BLOCKED → title unchanged, `CTRL` count **0**.

## Ranked Findings

**F1 — HIGH: DOM-based XSS (reflected via `document.write`) in `/vulnerabilities/xss_d/` — confirmed at all 3 security levels. Severity: High (client-side arbitrary JS execution).**

A single underlying vulnerability, with escalating defender controls defeated at each tier:

1. **LOW — no filter.** Payload `?default=English<script>document.title='…'</script>` executes directly. Trivially exploitable. (Note: `/` and `=` must remain literal because `decodeURI()` does not decode reserved characters — a fully-URL-encoded payload only *reflects* source without executing.)

2. **MEDIUM — `<script` keyword filter bypassed.** The filter strips/redirects on `<script`, but a non-`<script>` event-handler payload executes: `?default=English></option></select><img src=x onerror=document.title='…'>`. Confirms the filter is trivially defeated by event-handler vectors.

3. **HIGH — whitelist bypassed via URL fragment.** The whitelist only validates `$_GET['default']` (server-side). Because the `#` fragment is never transmitted, `?default=English#<script>…</script>` passes the whitelist (`default=English`) yet the vulnerable client-side code reads `document.location.href` (fragment included) and `document.write` re-inserts the decoded fragment as a live `<script>`. Even the strictest level is exploitable.

**Ranking rationale:** all three are the same DOM-XSS sink; they are ranked by *filter strength defeated* (HIGH > MEDIUM > LOW), while base severity is uniformly High. No level genuinely blocked the vulnerability — only the required bypass technique escalates.

## Conclusion

- LOW: **CONFIRMED** (no filter)
- MEDIUM: **CONFIRMED** (filter present but bypassed)
- HIGH: **CONFIRMED** (whitelist present but bypassed via fragment)

No false positives were reported — each confirmation is backed by a real `document.title` mutation in a live headless-browser session, and each higher level is corroborated by a matching negative control proving the filter was active.

## Evidence Artifacts

```sandbox_artifacts
[Summary JSON](/home/trueforge/artifacts/dvwa_xss_d_summary.json)
[LOW exploit DOM dump](/home/trueforge/artifacts/dvwa_xss_d_low.dom)
[MEDIUM exploit DOM dump](/home/trueforge/artifacts/dvwa_xss_d_medium.dom)
[MEDIUM control DOM dump (blocked)](/home/trueforge/artifacts/dvwa_xss_d_medium_control.dom)
[HIGH exploit DOM dump](/home/trueforge/artifacts/dvwa_xss_d_high.dom)
[HIGH control DOM dump (blocked)](/home/trueforge/artifacts/dvwa_xss_d_high_control.dom)
```