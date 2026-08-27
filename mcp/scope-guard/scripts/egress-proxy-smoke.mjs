/**
 * Integration tests for the opt-in egress proxy (EGRESS_PROXY_PORT): the
 * connect-time scope re-check (closes R7 - DNS rebinding TOCTOU) and network-
 * layer grant enforcement (closes R3 - grants become checked, not advisory).
 *
 * Self-contained: spins up its own loopback HTTP target, no external fixture.
 *
 * Usage: node scripts/egress-proxy-smoke.mjs
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = resolve(ROOT, "mcp/scope-guard/dist/index.js");
const GUARD_PORT = 9935;
const PROXY_PORT = 9945;
let failures = 0;

function check(label, cond, detail) {
  if (cond) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label} -> ${detail}`);
  }
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

async function guardRpc(method, params) {
  const res = await fetch(`http://127.0.0.1:${GUARD_PORT}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.result?.content?.[0]?.text) return JSON.parse(json.result.content[0].text);
  return json;
}
const tool = (name, args) => guardRpc("tools/call", { name, arguments: args });

/** Proxied plain-HTTP GET via the egress proxy (absolute-form request-target). */
function proxiedGet(targetUrl, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: PROXY_PORT, path: targetUrl, method: "GET", headers },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const procs = [];
let echoServer;

try {
  // self-contained in-scope target: a tiny local HTTP server, no external dep
  echoServer = createServer((_, res) => res.writeHead(200).end("ok"));
  const echoPort = await new Promise((res) => echoServer.listen(0, "127.0.0.1", () => res(echoServer.address().port)));
  const echoTarget = `127.0.0.1:${echoPort}`;

  const child = spawn("node", [SCRIPT], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(GUARD_PORT), EGRESS_PROXY_PORT: String(PROXY_PORT) },
    stdio: "ignore",
  });
  procs.push(child);
  check("guard+proxy boots", await waitHealth(GUARD_PORT), "never became healthy");
  await new Promise((r) => setTimeout(r, 300)); // let the proxy listener bind

  // in-scope, no grant -> passes (baseline unchanged when no grant presented)
  const s1 = await proxiedGet(`http://${echoTarget}/`);
  check("in-scope HTTP forward with no grant passes", s1 === 200, `status ${s1}`);

  // out-of-scope -> denied AT THE PROXY, at connect time (this is the R7 fix:
  // the check and the connect are the same atomic operation)
  const s2 = await proxiedGet("http://stripe.com/");
  check("out-of-scope HTTP forward denied at connect time", s2 === 403, `status ${s2}`);

  // grant enforcement (R3): mint a real grant, present it, confirm it's
  // network-checked - an invalid token is rejected even though scope alone
  // would allow the same target
  await tool("scope_add", { entry: echoTarget });
  const grant = await tool("request_intrusive_approval", { target: `http://${echoTarget}`, action: "egress-proxy smoke" });
  check("grant minted for proxy test", grant.approved === true && typeof grant.grant_token === "string", JSON.stringify(grant).slice(0, 150));

  const s3 = await proxiedGet(`http://${echoTarget}/`, { "x-sentinel-grant": grant.grant_token });
  check("valid grant header passes and is consumed", s3 === 200, `status ${s3}`);

  const s4 = await proxiedGet(`http://${echoTarget}/`, { "x-sentinel-grant": grant.grant_token });
  check("re-presenting the SAME (now consumed) grant is denied", s4 === 403, `status ${s4}`);

  const s5 = await proxiedGet(`http://${echoTarget}/`, { "x-sentinel-grant": "totally-fake-token" });
  check("an invalid grant token is denied even on an in-scope target", s5 === 403, `status ${s5}`);
} finally {
  for (const p of procs) p.kill();
  if (echoServer) echoServer.close();
}

console.log(failures === 0 ? "\nALL EGRESS-PROXY CHECKS PASSED" : `\n${failures} EGRESS-PROXY CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
