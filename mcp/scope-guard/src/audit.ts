import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

export interface AuditEntry {
  seq?: number;
  prev?: string;
  hash?: string;
  ts: string;
  actor: string;
  auth?: string;
  action: string;
  args: Record<string, unknown>;
  verdict: "allowed" | "denied" | "mutated";
  reason: string;
}

function readTailHash(file: string): string {
  try {
    const lines = readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try { const h = JSON.parse(lines[i]).hash; if (h) return h; } catch { /* skip malformed */ }
    }
  } catch { /* new file */ }
  return "GENESIS";
}

export class Audit {
  readonly file: string;

  constructor(file: string) {
    this.file = file;
    mkdirSync(dirname(file), { recursive: true });
  }

  append(entry: Omit<AuditEntry, "ts">): void {
    const record: AuditEntry = { seq: this.nextSeq(), ts: new Date().toISOString(), ...entry };
    // tamper-evidence chain: hash = sha256(prev_hash + canonical record)
    const payload = JSON.stringify({ ...record, hash: undefined });
    const prev = readTailHash(this.file);
    record.prev = prev;
    record.hash = createHash("sha256").update(prev + payload).digest("hex");
    appendFileSync(this.file, JSON.stringify(record) + "\n");
  }

  private seqCache: number | null = null;

  private nextSeq(): number {
    if (this.seqCache !== null) return this.seqCache + 1;
    if (!existsSync(this.file)) { this.seqCache = 0; return 0; }
    const lines = readFileSync(this.file, "utf8").trim().split("\n").filter(Boolean);
    let maxSeq = -1;
    for (const l of lines) {
      try { maxSeq = Math.max(maxSeq, (JSON.parse(l).seq ?? -1)); } catch { /* skip */ }
    }
    this.seqCache = maxSeq + 1;
    return this.seqCache;
  }

  read(limit = 50): AuditEntry[] {
    if (!existsSync(this.file)) return [];
    const lines = readFileSync(this.file, "utf8").trim().split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => JSON.parse(l) as AuditEntry)
      .reverse();
  }
}

export const defaultAuditFile = (): string => process.env.AUDIT_FILE ?? resolve(process.cwd(), "data/audit.jsonl");
