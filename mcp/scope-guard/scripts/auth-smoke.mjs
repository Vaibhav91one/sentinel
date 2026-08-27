/**
 * Integration tests for the guard's bearer-token trust boundary.
 * Spawns three isolated guard instances and asserts:
 *   A) GUARD_TOKEN set: missing/wrong token -> 401; correct token -> tools work
 *   B) GUARD_TOKEN + REQUIRE_GUARD_TOKEN=1: intrusive grants fail closed
 *   C) no token (default dev mode): intrusive grant mints with warning
 *
 * Usage: node scripts/auth-smoke.mjs
 */
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = resolve(ROOT, "mcp/scope-guard/dist/index.js");
let failures = 0;

function check(label, cond, detail) {
  if (cond) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label} -> ${detail}`);
  }
}

function start(port, env = {}) {
  const child = spawn("node", [SCRIPT], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), ...env },
    stdio: "ignore",
  });
  return child;
}

async function waitHealth(port) {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function rpc(port, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch { /* non-JSON (e.g. empty 401 body variants) */ }
  return { status: res.status, json };
}

async function callTool(port, name, args, headers = {}) {
  id += 1;
  const { status, json } = await rpc(
    port,
    { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } },
    headers,
  );
  if (!json?.result) return { status, error: json?.error ?? "no result" };
  return { status, ...JSON.parse(json.result.content[0].text) };
}

let id = 0;
const procs = [];

try {
  // Instance A: bearer required for access
  const A = 9931;
  procs.push(start(A, { GUARD_TOKEN: "sekrit-123" }));
  check("A boots", await waitHealth(A), `port ${A} never became healthy`);

  let r = await rpc(A, { jsonrpc: "2.0", id: ++id, method: "tools/list" });
  check("missing token rejected (401)", r.status === 401, `status ${r.status}`);

  r = await rpc(A, { jsonrpc: "2.0", id: ++id, method: "tools/list" }, { authorization: "Bearer wrong" });
  check("wrong token rejected (401)", r.status === 401, `status ${r.status}`);

  r = await rpc(A, { jsonrpc: "2.0", id: ++id, method: "tools/list" }, { authorization: "Bearer sekrit-123" });
  check("correct token accepted", r.status === 200 && Array.isArray(r.json?.result?.tools), `status ${r.status}`);

  // Instance B: REQUIRE_GUARD_TOKEN=1 with NO token configured -> fail closed
  const B = 9932;
  procs.push(start(B, { REQUIRE_GUARD_TOKEN: "1" }));
  check("B boots", await waitHealth(B), `port ${B} never became healthy`);
  const bGrant = await callTool(
    B,
    "request_intrusive_approval",
    { target: "http://localhost:3000", action: "test sweep" },
  );
  check("REQUIRE_GUARD_TOKEN=1 fails closed without configured token", bGrant.approved === false && /fail-closed/i.test(bGrant.reason ?? ""), JSON.stringify(bGrant).slice(0, 200));
  const bAdd = await callTool(B, "scope_add", { entry: "10.99.99.99" });
  check("fail-closed blocks scope_add too", typeof bAdd.error === "string" && bAdd.error.includes("fail-closed"), JSON.stringify(bAdd));
  const bRm = await callTool(B, "scope_remove", { entry: "localhost" });
  check("fail-closed blocks scope_remove too", typeof bRm.error === "string" && bRm.error.includes("fail-closed"), JSON.stringify(bRm));

  // Instance C: dev mode mints but warns
  const C = 9933;
  procs.push(start(C));
  check("C boots", await waitHealth(C), `port ${C} never became healthy`);
  const cGrant = await callTool(C, "request_intrusive_approval", { target: "http://localhost:3000", action: "test sweep" });
  check("dev-mode grant mints", cGrant.approved === true && typeof cGrant.grant_token === "string", JSON.stringify(cGrant).slice(0, 160));
  check("dev-mode grant carries boundary warning", typeof cGrant.warning === "string" && cGrant.warning.includes("GUARD_TOKEN"), JSON.stringify(cGrant.warning));

  // Canonical target bookkeeping: minted for trailing-slash URL verifies bare
  const cCanon = await callTool(C, "request_intrusive_approval", { target: "http://localhost:3000/", action: "canonical test" });
  const vCanon = await callTool(C, "verify_grant", { token: cCanon.grant_token, target: "http://localhost:3000" });
  check("grant targets canonicalized (slash variants interoperate)", vCanon.valid === true, JSON.stringify(vCanon));

  // Single-use consumption with non-destructive wrong-target handling
  const vWrong = await callTool(C, "verify_grant", { token: cGrant.grant_token, target: "http://other-target:1" });
  check("wrong-target verify rejected", vWrong.valid === false && vWrong.reason.includes("remains active"), JSON.stringify(vWrong));
  const v1 = await callTool(C, "verify_grant", { token: cGrant.grant_token, target: "http://localhost:3000" });
  check("grant still valid after wrong-target attempt", v1.valid === true, JSON.stringify(v1));
  const v2 = await callTool(C, "verify_grant", { token: cGrant.grant_token, target: "http://localhost:3000" });
  check("grant is single-use (reuse rejected)", v2.valid === false, JSON.stringify(v2));
  const v3 = await callTool(C, "verify_grant", { token: cGrant.grant_token, target: "http://localhost:3000" });
  check("spent grant rejected even for new target", v3.valid === false, JSON.stringify(v3));

  // Instance D: SENTINEL_LAB_MODE=1 -> loopback grants become multi-use; others unchanged
  const D = 9934;
  procs.push(start(D, { SENTINEL_LAB_MODE: "1" }));
  check("D boots", await waitHealth(D), `port ${D} never became healthy`);

  // loopback target: multi-use grant, 60-min TTL, reusable across a sweep
  const dLab = await callTool(D, "request_intrusive_approval", { target: "http://localhost:3000", action: "full challenge sweep" });
  check("lab-mode loopback grant mints", dLab.approved === true && typeof dLab.grant_token === "string", JSON.stringify(dLab).slice(0, 160));
  check("lab-mode grant advertises multi-use + 60min", dLab.expires_in_minutes === 60 && /LAB-MODE/.test(dLab.note ?? ""), JSON.stringify(dLab).slice(0, 200));
  const dv1 = await callTool(D, "verify_grant", { token: dLab.grant_token, target: "http://localhost:3000" });
  check("lab-mode grant valid on first use", dv1.valid === true, JSON.stringify(dv1));
  const dv2 = await callTool(D, "verify_grant", { token: dLab.grant_token, target: "http://localhost:3000" });
  check("lab-mode grant STILL valid on reuse (multi-use)", dv2.valid === true && /multi-use/.test(dv2.reason ?? ""), JSON.stringify(dv2));

  // non-loopback target under lab-mode: flag ignored, stays single-use
  await callTool(D, "scope_add", { entry: "10.0.0.5" });
  const dPriv = await callTool(D, "request_intrusive_approval", { target: "http://10.0.0.5:8080", action: "private sweep" });
  check("lab-mode non-loopback grant mints single-use (30/10min)", dPriv.approved === true && dPriv.expires_in_minutes === 10, JSON.stringify(dPriv).slice(0, 200));
  const dp1 = await callTool(D, "verify_grant", { token: dPriv.grant_token, target: "http://10.0.0.5:8080" });
  check("non-loopback grant valid once", dp1.valid === true, JSON.stringify(dp1));
  const dp2 = await callTool(D, "verify_grant", { token: dPriv.grant_token, target: "http://10.0.0.5:8080" });
  check("non-loopback grant single-use under lab-mode (reuse rejected)", dp2.valid === false, JSON.stringify(dp2));
} finally {
  for (const p of procs) p.kill();
}

console.log(failures === 0 ? "\nALL AUTH CHECKS PASSED" : `\n${failures} AUTH CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
