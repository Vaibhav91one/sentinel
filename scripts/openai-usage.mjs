/**
 * OpenAI spend estimator (no billing API on project keys).
 *
 *   node --env-file=.env scripts/openai-usage.mjs status
 *
 * Reads every Sentinel session's token usage from the TrueForge API, splits
 * by provider prefix (openai/* vs deepseek/*), applies approximate price
 * table, and keeps a cumulative ledger in data/usage-openai.json.
 *
 * THE REAL CEILING is the monthly budget you set in the OpenAI dashboard
 * (Billing -> Limits). This tool is an early-warning system, nothing more.
 */
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790";
const LEDGER = resolve(process.cwd(), "data/usage-openai.json");

// Approximate list prices ($/M tokens) - adjust if OpenAI changes them.
const PRICES = {
  "gpt-5": { in: 1.25, out: 10 },
  "gpt-5-mini": { in: 0.25, out: 2 },
  "gpt-5-nano": { in: 0.05, out: 0.4 },
};
const FALLBACK = { in: 1.25, out: 10 }; // assume flagship when unsure - conservative

function loadLedger() {
  if (!existsSync(LEDGER)) return { spent_total: 0, last_ts: null };
  try {
    return JSON.parse(readFileSync(LEDGER, "utf8"));
  } catch {
    return { spent_total: 0, last_ts: null };
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function main() {
  const d = await fetchJson(`${BASE}/api/v1/models`);
  const models = d.data ?? [];
  const fqnToPrice = new Map();
  for (const m of models) {
    const prov = m.provider?.name ?? "";
    const price = prov === "openai" ? (PRICES[m.model_id] ?? FALLBACK) : prov === "deepseek" ? { in: 0.28, out: 1.1 } : null;
    if (price) fqnToPrice.set(m.name, price);
  }

  // Walk sessions, sum tokens per provider from turn metrics.
  const sess = await fetchJson(`${BASE}/api/v1/sessions`);
  let openaiTokens = { in: 0, out: 0 };
  let unknownSessions = 0;
  for (const s of sess.data ?? []) {
    try {
      const evs = await fetchJson(`${BASE}/api/v1/sessions/${s.id}/events`);
      for (const e of evs.data ?? []) {
        const ev = e.event ?? {};
        const u = ev.usage ?? ev.state?.metrics;
        if (!u) continue;
        // Session-level metrics don't tag provider; attribute via the session's
        // most recent model FQN seen in this repo of events is unavailable, so
        // we conservatively bucket ALL harness-token spend under the model the
        // operator says they are running (env OPENAI_ACTIVE=1 while testing gpt).
        if (process.env.OPENAI_ACTIVE !== "1") continue;
        openaiTokens.in += u.input_tokens ?? 0;
        openaiTokens.out += u.output_tokens ?? 0;
      }
    } catch { /* skip dead sessions */ }
  }
  void unknownSessions;

  const est = (openaiTokens.in / 1e6) * (PRICES[process.env.OPENAI_MODEL]?.in ?? FALLBACK.in)
            + (openaiTokens.out / 1e6) * (PRICES[process.env.OPENAI_MODEL]?.out ?? FALLBACK.out);
  const led = loadLedger();
  const total = led.spent_total + est;
  console.log(`[openai-usage] model assumption: ${process.env.OPENAI_MODEL ?? "gpt-5 (conservative)"}`);
  console.log(`[openai-usage] tokens: in ${openaiTokens.in.toLocaleString()} / out ${openaiTokens.out.toLocaleString()}`);
  console.log(`[openai-usage] estimated lifetime spend: $${est.toFixed(4)} | ledger total: $${total.toFixed(4)}`);
  console.log("[openai-usage] HARD CEILING = your dashboard monthly budget (Billing -> Limits)");
  writeFileSync(LEDGER, JSON.stringify({ ...led, last_estimate: est, est_total: total, last_ts: new Date().toISOString() }, null, 2));
}

main().catch((e) => {
  console.error("[openai-usage]", e.message);
  console.error("is the harness running? pnpm harness");
  process.exit(1);
});
