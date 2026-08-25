/**
 * Drives a full Sentinel assessment against the local demo target,
 * auto-approving (or auto-denying) intrusive-action checkpoints.
 *
 * Usage: node scripts/full-assess.mjs [--deny]
 */
import { TrueForge } from "@truefoundry/trueforge-sdk";
import { balance, checkpoint } from "./usage.mjs";

const SPEND_FLOOR = Number(process.env.SPEND_FLOOR ?? 1.0); // user cap: stop when $4 spent (balance < $1)

const AUTO = process.argv.includes("--deny") ? "deny" : "allow";
const TARGET = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const client = new TrueForge({ baseUrl: process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790" });

// Pre-flight spend check (skippable for offline dev with --no-spend-check)
if (!process.argv.includes("--no-spend-check")) {
  const b = await balance();
  if (b < SPEND_FLOOR) {
    console.error(`[drive] ABORT: DeepSeek balance $${b.toFixed(2)} < floor $${SPEND_FLOOR.toFixed(2)}. Top up or set SPEND_FLOOR.`);
    process.exit(1);
  }
  console.log(`[drive] spend check ok: $${b.toFixed(2)} available`);
}

const { data: session } = await client.sessions.create({ agent: { name: "sentinel" } });
console.log(`[drive] session ${session.id} (auto=${AUTO})`);

const pending = [];
const pendingResp = [];

async function runTurn(input) {
  const stream = await client.sessions.createTurnStream(session.id, { input });
  for await (const { data: event } of stream.withMetadata()) {
    switch (event.type) {
      case "tool.call":
        console.log(`  [tool] ${event.name ?? event.tool_name ?? "?"}`, JSON.stringify(event.arguments ?? {}).slice(0, 120));
        break;
      case "tool.response_required": {
        const calls = event.toolCalls ?? event.tool_calls ?? [];
        console.log(`  [question] agent asks user (${calls.length})`);
        for (const c of calls) {
          const cid = c.id ?? c.toolCallId ?? c.tool_call_id;
          if (cid && !pendingResp.includes(cid)) pendingResp.push(cid);
        }
        break;
      }
      case "tool.approval_required": {
        const calls = event.toolCalls ?? event.tool_calls ?? [];
        console.log(`  [approval] PAUSED - ${calls.length} call(s) need human`);
        for (const c of calls) {
          const cid = c.id ?? c.toolCallId ?? c.tool_call_id;
          if (cid && !pending.includes(cid)) pending.push(cid);
        }
        break;
      }
      case "model.message":
        break; // final text printed after turn.done
      case "turn.done": {
        const msg = event.message ?? event.modelMessage ?? {};
        let text = typeof msg.content === "string" ? msg.content : "";
        if (!text && Array.isArray(msg.content)) {
          text = msg.content.map((c) => (typeof c === "string" ? c : c.text ?? c.content)).filter(Boolean).join("\n");
        }
        if (text.trim()) {
          console.log("--- final ---\n" + text);
        } else {
          // content shape varies across versions; fetch the newest model.message from the events API
          try {
            const res = await fetch(`${process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790"}/api/v1/sessions/${session.id}/events`);
            const d = await res.json();
            const evs = d.data ?? [];
            const last = evs.find((e) => e.event?.type === "model.message");
            const c = last?.event?.content;
            const t2 = typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => (typeof x === "string" ? x : x.text)).filter(Boolean).join("\n") : "";
            if (t2.trim()) console.log("--- final ---\n" + t2);
          } catch { /* best effort */ }
        }
        break;
      }
      default:
        if (String(event.type).includes("sandbox")) console.log(`  [sandbox] ${event.type}`);
    }
  }
}

const PROMPT = process.env.ASSESS_PROMPT ??
  `Assess the demo target end to end using the sentinel-recon skill's Phase 0 in-sandbox lab: clone the repo inside the sandbox, start the vulnerable app on localhost:3000 there, then scope_check it, passive fingerprint, request approval for an active port sweep + web probes. Then correlate CVEs with the osv tools and produce the findings report.`;

await runTurn([{ type: "user.message", content: PROMPT }]);

// Alternate until both queues drain: harness may surface questions and
// approvals interleaved across resumes.
let guard = 0;
while ((pending.length > 0 || pendingResp.length > 0) && guard++ < 40) {
  if (pendingResp.length > 0) {
    const id = pendingResp.shift();
    console.log(`  [drive] answering question ${id}`);
    await runTurn([{
      type: "user.tool_response",
      threadId: "main",
      toolCallId: id,
      content: "Proceed autonomously. Make reasonable security-assessment choices and continue to the next phase without asking again unless blocked.",
    }]);
  } else if (pending.length > 0) {
    const batch = pending.splice(0).map((cid) => ({
      type: "user.tool_approval",
      threadId: "main",
      toolCallId: cid,
      approval: AUTO === "allow" ? { status: "allow" } : { status: "deny", reason: "demo deny pass" },
    }));
    console.log(`  [drive] resuming ${batch.length} approval(s) -> ${AUTO}`);
    await runTurn(batch);
  }
}
console.log("[drive] complete");
await checkpoint("run total");

// OpenAI estimator reminder when the agent is running on an OpenAI model
if (process.env.OPENAI_ACTIVE === "1") {
  try {
    await import("./openai-usage.mjs");
  } catch { /* non-fatal */ }
}
