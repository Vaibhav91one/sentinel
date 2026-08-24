import { readFileSync } from "node:fs";

async function main(): Promise<void> {
  const file = new URL("../agent/sentinel.agent.json", import.meta.url);
  const spec = JSON.parse(readFileSync(file, "utf8")) as {
    name: string;
    manifest: { model: { name: string }; instructions: string };
  };

  if (spec.manifest.model.name.includes("REPLACE_ME")) {
    console.error(
      "Edit agent/sentinel.agent.json first: set manifest.model.name to a model you configured (e.g. ollama-local/qwen3:8b).",
    );
    process.exit(1);
  }

  const { TrueForge } = await import("@truefoundry/trueforge-sdk");
  const client = new TrueForge({
    baseUrl: process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790",
  });

  try {
    const { data } = await client.agents.create({ name: spec.name, manifest: spec.manifest });
    console.log(`agent "${spec.name}" created (id=${data.id})`);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 409) {
      console.error(`agent name "${spec.name}" already taken - update it in the UI or delete it first.`);
      process.exit(2);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error("failed:", err instanceof Error ? err.message : err);
  console.error("is the harness running?  pnpm harness");
  process.exit(1);
});
