import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface AuditEntry {
  ts: string;
  actor: string;
  action: string;
  args: Record<string, unknown>;
  verdict: "allowed" | "denied" | "mutated";
  reason: string;
}

export class Audit {
  readonly file: string;

  constructor(file: string) {
    this.file = file;
    mkdirSync(dirname(file), { recursive: true });
  }

  append(entry: Omit<AuditEntry, "ts">): void {
    const record: AuditEntry = { ts: new Date().toISOString(), ...entry };
    appendFileSync(this.file, JSON.stringify(record) + "\n");
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
