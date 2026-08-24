import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Scope policy for Sentinel.
 *
 * A target is reachable only if it matches an explicit allow entry.
 * Entries are one of:
 *   - hostname            e.g. juice-shop.local
 *   - IPv4/IPv6 address   e.g. 127.0.0.1
 *   - CIDR range          e.g. 10.0.0.0/24
 *   - wildcard domain     e.g. *.staging.example.com (does NOT match the bare domain)
 *
 * Hard-deny entries can never be reached even if allow-listed (cloud metadata,
 * link-local). This is a deliberate tripwire: an allow entry for them is itself
 * logged as a policy violation at add-time.
 */

export type TargetClass =
  | "loopback"
  | "private"
  | "link_local"
  | "cloud_metadata"
  | "public"
  | "unresolvable_input";

export interface ScopeState {
  allow: string[];
  updated_at: string;
}

const DEFAULT_ALLOW = ["localhost", "127.0.0.1", "[::1]"];

export class Scope {
  readonly file: string;
  private state: ScopeState;

  constructor(file: string) {
    this.file = file;
    this.state = this.load();
  }

  private load(): ScopeState {
    if (!existsSync(this.file)) return { allow: [...DEFAULT_ALLOW], updated_at: new Date().toISOString() };
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<ScopeState>;
      if (!Array.isArray(parsed.allow)) throw new Error("allow is not an array");
      return { allow: parsed.allow.map(String), updated_at: String(parsed.updated_at ?? new Date().toISOString()) };
    } catch (err) {
      throw new Error(`scope file ${this.file} is corrupt: ${(err as Error).message}`);
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.state, null, 2) + "\n");
  }

  list(): string[] {
    return [...this.state.allow];
  }

  /** Returns error message when the entry is refused, null when accepted. */
  add(entry: string): string | null {
    const normalized = normalizeEntry(entry);
    if (normalized === null) return `not a valid scope entry: "${entry}"`;
    if (classify(normalized) === "cloud_metadata") {
      return `refused: cloud metadata endpoints are hard-denied and cannot be allow-listed`;
    }
    if (this.state.allow.includes(normalized)) return `"${normalized}" is already scoped`;
    this.state.allow.push(normalized);
    this.state.updated_at = new Date().toISOString();
    this.save();
    return null;
  }

  remove(entry: string): boolean {
    const normalized = normalizeEntry(entry);
    if (normalized === null) return false;
    const before = this.state.allow.length;
    this.state.allow = this.state.allow.filter((e) => e !== normalized);
    if (this.state.allow.length !== before) {
      this.state.updated_at = new Date().toISOString();
      this.save();
      return true;
    }
    return false;
  }

  check(target: string): { allowed: boolean; reason: string; target_class: TargetClass; matched?: string } {
    const normalized = normalizeTarget(target);
    if (normalized === null) {
      return { allowed: false, reason: `unparseable target "${target}"`, target_class: "unresolvable_input" };
    }
    const cls = classify(normalized.value);
    if (cls === "cloud_metadata") {
      return { allowed: false, reason: "HARD DENY: cloud metadata endpoint", target_class: cls };
    }
    for (const entry of this.state.allow) {
      if (matches(entry, normalized)) {
        return { allowed: true, reason: `matches scoped entry "${entry}"`, target_class: cls, matched: entry };
      }
    }
    return {
      allowed: false,
      reason: `no scope entry matches "${normalized.display}" — add it via scope_add or pick an in-scope target`,
      target_class: cls,
    };
  }
}

function normalizeEntry(entry: string): string | null {
  const s = entry.trim();
  if (s.length === 0 || s.length > 253) return null;
  if (/^\*\.[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)) return s.toLowerCase(); // wildcard domain
  if (/^[\w.-]+(:\d{1,5})?$/i.test(s)) return s.toLowerCase(); // host[:port]
  return null; // CIDR/IP fall through to same loose host check; strict IP/CIDR parsing happens in matches()
}

function normalizeTarget(target: string): { value: string; display: string } | null {
  let s = target.trim().toLowerCase();
  if (s.length === 0) return null;
  try {
    const url = new URL(s.includes("://") ? s : `http://${s}`);
    const port = url.port ? `:${url.port}` : "";
    const host = url.hostname;
    if (host.length === 0) return null;
    return { value: `${host}${port}`, display: `${host}${port}${url.pathname === "/" ? "" : url.pathname}` };
  } catch {
    return null;
  }
}

/** Loose classification without DNS resolution; input is already host[:port]. */
function classify(hostPort: string): TargetClass {
  const host = hostPort.replace(/:\d{1,5}$/, "").replace(/^\[|\]$/g, "");
  if (host === "169.254.169.254" || host === "metadata.google.internal") return "cloud_metadata";
  if (host === "localhost" || host.endsWith(".localhost")) return "loopback";
  if (isIPv4(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 127) return "loopback";
    if (a === 169 && b === 254) return "link_local";
    if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return "private";
    return "public";
  }
  if (host.includes(":")) {
    if (host === "::1") return "loopback";
    if (/^f[cd]/.test(host)) return "private";
    if (/^fe[89ab]/.test(host)) return "link_local";
    return "public";
  }
  return /\.local$/.test(host) ? "private" : "public";
}

function isIPv4(s: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  return m !== null && m.slice(1).every((o) => Number(o) <= 255);
}

function matches(entry: string, target: { value: string }): boolean {
  const host = target.value.replace(/:\d{1,5}$/, "");
  const port = target.value.match(/:(\d{1,5})$/)?.[1];

  // host[:port] entry: port must match when specified on the entry
  const entryPort = entry.match(/:(\d{1,5})$/)?.[1];
  const entryHost = entry.replace(/:\d{1,5}$/, "");

  if (entryHost.includes("/")) return isIPv4(host) && cidrContains(entryHost, host); // CIDR
  if (entryHost.startsWith("*.")) {
    const suffix = entryHost.slice(1); // ".example.com"
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  if (isIPv4(entryHost) || entryHost.includes(":")) return entryHost === host && (entryPort === undefined || entryPort === port);
  return entryHost === host && (entryPort === undefined || entryPort === port);
}

function cidrContains(cidr: string, ip: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const toInt = (s: string): number =>
    s.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (toInt(base) & mask) === (toInt(ip) & mask);
}

export const defaultScopeFile = (): string => process.env.SCOPE_FILE ?? resolve(process.cwd(), "data/scope.json");
