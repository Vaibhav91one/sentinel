/**
 * DeepSeek spend guard.
 *
 *   node scripts/usage.mjs                 -> show balance + delta since last checkpoint
 *   node scripts/usage.mjs check <min>     -> exit 1 if balance < min dollars
 *
 * Balance comes from the DeepSeek API (ground truth). Deltas are stored in
 * data/usage.json so each run reports what it actually cost.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const KEY = process.env.DEEPSEEK_API_KEY;
const LEDGER = process.env.USAGE_LEDGER ?? resolve(process.cwd(), "data/usage.json");

if (!KEY) {
  console.error("DEEPSEEK_API_KEY not set. Put it in .env and run with: node --env-file=.env scripts/usage.mjs");
  process.exit(1);
}

export async function balance() {
  const res = await fetch("https://api.deepseek.com/user/balance", {
    headers: { Authorization: `Bearer ${KEY}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`balance check failed: HTTP ${res.status}`);
  const d = await res.json();
  return Number(d.balance_infos[0].total_balance);
}

function readLedger() {
  if (!existsSync(LEDGER)) return { last_balance: null, last_ts: null, spent_total: 0 };
  try {
    return JSON.parse(readFileSync(LEDGER, "utf8"));
  } catch {
    return { last_balance: null, last_ts: null, spent_total: 0 };
  }
}

function writeLedger(s) {
  mkdirSync(dirname(LEDGER), { recursive: true });
  writeFileSync(LEDGER, JSON.stringify(s, null, 2) + "\n");
}

/** Record a checkpoint; prints the cost of whatever ran since the previous one. */
export async function checkpoint(label = "checkpoint") {
  const now = await balance();
  const prev = readLedger();
  const delta = prev.last_balance === null ? 0 : Math.max(0, prev.last_balance - now);
  const spent = Number((prev.spent_total + delta).toFixed(4));
  writeLedger({ last_balance: now, last_ts: new Date().toISOString(), spent_total: spent });
  console.log(`[usage] ${label}: balance $${now.toFixed(2)} | this step $${delta.toFixed(4)} | total tracked $${spent.toFixed(4)}`);
  return now;
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "check") {
    const min = Number(arg ?? 0.5);
    const b = await balance();
    if (b < min) {
      console.error(`[usage] ABORT: balance $${b.toFixed(2)} < floor $${min.toFixed(2)}`);
      process.exit(1);
    }
    console.log(`[usage] ok: balance $${b.toFixed(2)} >= floor $${min.toFixed(2)}`);
    return;
  }
  await checkpoint(cmd === undefined ? "status" : cmd);
}

// Only run CLI when invoked directly (not when imported by full-assess).
const isMain = process.argv[1]?.replace(/\.mjs$/, "")?.endsWith("usage");
if (isMain) main().catch((e) => { console.error("[usage]", e.message); process.exit(1); });
