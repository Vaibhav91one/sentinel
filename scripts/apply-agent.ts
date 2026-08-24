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
    const errObj = err as { status?: number; statusCode?: number; message?: string };
    const status = errObj.status ?? errObj.statusCode;
    if (status === 409 || /already exists/i.test(errObj.message ?? "")) {
      const { data: list } = await client.agents.list();
      const existing = (list as unknown as { name: string; id: string }[]).find((a) => a.name === spec.name);
      if (!existing) {
        console.error(`name taken but agent not found in list - update via UI.`);
        process.exit(2);
      }
      await client.agents.update(existing.id, { manifest: spec.manifest });
      console.log(`agent "${spec.name}" updated (id=${existing.id})`);
      return;
    }
    throw err;
  }
}

main().catch((err) => {
  console.error("failed:", err instanceof Error ? err.message : err);
  console.error("is the harness running?  pnpm harness");
  process.exit(1);
});
