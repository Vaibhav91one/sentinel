const BASE = process.env.BASE ?? "http://127.0.0.1:9930/mcp";
let id = 0;

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
  if (r.error) return { error: r.error };
  return JSON.parse(r.result.content[0].text);
}

const init = await rpc("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0" },
});
console.log("init ->", init.result.serverInfo);

console.log("\n[1] in-scope target:");
console.log(JSON.stringify(await tool("scope_check", { target: "http://localhost:3000" })));

console.log("\n[2] cloud metadata (must hard-deny):");
console.log(JSON.stringify(await tool("scope_check", { target: "http://169.254.169.254/latest/meta-data/" })));

console.log("\n[3] out-of-scope public host:");
console.log(JSON.stringify(await tool("scope_check", { target: "https://stripe.com" })));

console.log("\n[4] scope_add wildcard:");
console.log(JSON.stringify(await tool("scope_add", { entry: "*.evil.example" })));

console.log("\n[5] metadata allowlist refusal (must refuse):");
console.log(JSON.stringify(await tool("scope_add", { entry: "169.254.169.254" })));

console.log("\n[6] audit_read:");
const audit = await tool("audit_read", { limit: 6 });
for (const e of audit.entries) console.log(`  ${e.ts} ${e.action.padEnd(12)} ${e.verdict.padEnd(8)} ${e.reason}`);

console.log("\n[7] cleanup remove wildcard:");
console.log(JSON.stringify(await tool("scope_remove", { entry: "*.evil.example" })));
