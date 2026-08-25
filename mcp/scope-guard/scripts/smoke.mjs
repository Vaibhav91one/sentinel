/**
 * Protocol + security smoke tests for the scope-guard MCP server.
 * Asserts expected outcomes; exits non-zero on any failure so CI catches
 * regressions in the policy layer.
 *
 * Usage: node scripts/smoke.mjs   (guard must be running on :9930)
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:9930/mcp";
let id = 0;
let failures = 0;

function check(label, cond, detail) {
  if (cond) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label} -> ${detail}`);
  }
}

async function rpc(method, params) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    const text = await res.text();
    const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
    return JSON.parse(dataLine.slice(5));
  }
  return res.json();
}

async function tool(name, args) {
  const r = await rpc("tools/call", { name, arguments: args });
  if (r.error) return { error: r.error.message ?? "rpc error" };
  return JSON.parse(r.result.content[0].text);
}

const init = await rpc("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0" },
});
check("initialize returns server info", !!init?.result?.serverInfo?.name, JSON.stringify(init));

const t1 = await tool("scope_check", { target: "http://localhost:3000" });
check("loopback default-scoped is allowed", t1.allowed === true && t1.target_class === "loopback", JSON.stringify(t1));

const t2 = await tool("scope_check", { target: "http://169.254.169.254/latest/meta-data/" });
check("cloud metadata literal hard-denied", t2.allowed === false && t2.target_class === "cloud_metadata", JSON.stringify(t2));

const t2b = await tool("scope_check", { target: "http://169.254.10.20" });
check("other link-local addresses hard-denied", t2b.allowed === false && t2b.reason.includes("link-local"), JSON.stringify(t2b));

const t3 = await tool("scope_check", { target: "https://stripe.com" });
check("out-of-scope public host denied", t3.allowed === false && !t3.matched, JSON.stringify(t3));

// Network-dependent cases (real DNS). CI runs with SMOKE_SKIP_NETWORK=1 so a
// resolver outage cannot fail an otherwise-correct policy build.
if (process.env.SMOKE_SKIP_NETWORK === "1") {
  console.log("  skip  network-dependent checks (SMOKE_SKIP_NETWORK=1)");
} else {
const a1 = await tool("scope_add", { entry: "*.nip.io" });
check("wildcard entry accepted", !!a1.allow?.includes("*.nip.io"), JSON.stringify(a1));
const a1b = await tool("scope_check", { target: "http://93.184.216.34.nip.io" });
check("wildcard match allowed (resolvable public)", a1b.allowed === true && a1b.target_class === "public", JSON.stringify(a1b));
const a1c = await tool("scope_check", { target: "http://nip.io" });
check("bare domain not covered by wildcard", a1c.allowed === false, JSON.stringify(a1c));

const a2 = await tool("scope_add", { entry: "169.254.169.254" });
check("metadata allowlist refusal", typeof a2.error === "string" && a2.error.includes("hard-denied"), JSON.stringify(a2));

const a3 = await tool("scope_add", { entry: "169.254.0.0/16" });
check(
  "link-local CIDR refusal",
  typeof a3.error === "string" && a3.error.includes("hard-denied"),
  JSON.stringify(a3),
);

const a4 = await tool("scope_add", { entry: "10.50.77.0/24" });
check("valid CIDR accepted", !!a4.allow?.includes("10.50.77.0/24"), JSON.stringify(a4));
const a4b = await tool("scope_check", { target: "http://10.50.77.9:8080" });
check("in-CIDR target allowed", a4b.allowed === true && a4b.matched === "10.50.77.0/24", JSON.stringify(a4b));
const a4c = await tool("scope_check", { target: "http://10.50.78.9" });
check("off-CIDR target denied", a4c.allowed === false, JSON.stringify(a4c));

const a5 = await tool("scope_add", { entry: "999.10.0.0/40" });
check("invalid CIDR refused", typeof a5.error === "string" && a5.error.includes("not a valid"), JSON.stringify(a5));

// public hostname resolving into loopback space -> rebinding guard
await tool("scope_add", { entry: "localtest.me" });
const a6 = await tool("scope_check", { target: "http://localtest.me:3000" });
check(
  "DNS rebinding guard denies public name resolving to loopback",
  a6.allowed === false && a6.reason.includes("rebinding"),
  JSON.stringify(a6),
);
await tool("scope_remove", { entry: "localtest.me" });
} // end network-dependent block

// Offline: unscoped reserved-range literals are denied without DNS
const t4 = await tool("scope_check", { target: "http://0.0.0.0" });
check("reserved literal (0.0.0.0) denied", t4.allowed === false && t4.target_class === "reserved", JSON.stringify(t4));
const t4b = await tool("scope_check", { target: "http://100.64.99.99" });
check("unscoped reserved literal (CGNAT) denied", t4b.allowed === false && t4b.target_class === "reserved", JSON.stringify(t4b));

// Offline: IPv6 literal entries round-trip ("[::1]" canonicalizes onto default-scoped "::1")
const v1 = await tool("scope_add", { entry: "[::1]" });
check(
  "bracketed IPv6 entry parsed",
  !!v1.allow?.includes("::1") || (typeof v1.error === "string" && v1.error.includes("already scoped")),
  JSON.stringify(v1),
);
const v2 = await tool("scope_add", { entry: "2001:db8::1" });
check("plain IPv6 entry accepted", !!v2.allow?.includes("2001:db8::1"), JSON.stringify(v2));
const v3 = await tool("scope_check", { target: "http://[2001:db8::1]:8080" });
check("IPv6 target matches scoped entry", v3.allowed === true && v3.matched === "2001:db8::1", JSON.stringify(v3));
const v4 = await tool("scope_remove", { entry: "2001:db8::1" });
check("IPv6 entry removable", v4.removed === true, JSON.stringify(v4));

// cleanup
await tool("scope_remove", { entry: "*.nip.io" });
await tool("scope_remove", { entry: "10.50.77.0/24" });

const audit = await tool("audit_read", { limit: 5 });
check("audit log records entries", Array.isArray(audit.entries) && audit.entries.length > 0, JSON.stringify(audit).slice(0, 120));

console.log(failures === 0 ? "\nALL SMOKE CHECKS PASSED" : `\n${failures} SMOKE CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
