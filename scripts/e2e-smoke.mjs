import { TrueForge } from "@truefoundry/trueforge-sdk";

const client = new TrueForge({ baseUrl: process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790" });

const { data: session } = await client.sessions.create({ agent: { name: process.argv[2] ?? "sentinel" } });
console.log("session:", session.id);

const stream = await client.sessions.createTurnStream(session.id, {
  input: [{ type: "user.message", content:
    "Use policy_get and scope_list, then tell me in two sentences whether http://localhost:3000 may be scanned and by what authority." }],
});

let saw = new Set();
for await (const { data: event } of stream.withMetadata()) {
  saw.add(event.type);
  if (event.type === "tool.call") console.log("  tool:", event.name ?? event.tool_name ?? "(?)");
  if (event.type === "turn.done") {
    console.log("\n--- final ---");
    for (const part of event.message?.content ?? []) if (part.text) console.log(part.text);
  }
}
console.log("[event types seen]", [...saw].join(", "));
