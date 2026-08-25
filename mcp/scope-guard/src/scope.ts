import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import dns from "node:dns/promises";

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
  | "reserved"
  | "public"
  | "unresolvable_input";

export interface ScopeState {
  allow: string[];
  updated_at: string;
}

const DEFAULT_ALLOW = ["localhost", "127.0.0.1", "::1"];

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
    const cls = classify(normalized);
    if (cls === "cloud_metadata") {
      return `refused: cloud metadata endpoints are hard-denied and cannot be allow-listed`;
    }
    if (cls === "link_local") {
      return `refused: link-local space (169.254.0.0/16, fe80::/10) is hard-denied and cannot be allow-listed`;
    }
    if (cls === "reserved") {
      return `refused: reserved/non-routable ranges are hard-denied and cannot be allow-listed`;
    }
    // A CIDR that overlaps link-local or metadata space would silently
    // authorize those addresses through a seemingly innocuous range.
    if (entryHostIncludesSlash(normalized)) {
      for (const banned of [
        "169.254.0.0/16", // link-local / cloud metadata
        "0.0.0.0/8", // this-network
        "100.64.0.0/10", // CGNAT
        "198.18.0.0/15", // benchmarking
        "224.0.0.0/4", // multicast
        "240.0.0.0/4", // reserved
      ]) {
        if (cidrOverlaps(normalized, banned)) {
          return `refused: CIDR ${normalized} overlaps hard-denied ${banned}`;
        }
      }
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

  /**
   * Async because public hostnames are DNS-resolved at check time: an
   * allow-listed name that resolves into private/link-local space is treated
   * as a DNS-rebinding attempt and denied. IP-literal targets, CIDR entries
   * and unresolvable names skip resolution (fail-closed on the last case).
   */
  async check(
    target: string,
  ): Promise<{ allowed: boolean; reason: string; target_class: TargetClass; matched?: string }> {
    const normalized = normalizeTarget(target);
    if (normalized === null) {
      return { allowed: false, reason: `unparseable target "${target}"`, target_class: "unresolvable_input" };
    }
    const cls = classify(normalized.value);
    if (cls === "cloud_metadata") {
      return { allowed: false, reason: "HARD DENY: cloud metadata endpoint", target_class: cls };
    }
    if (cls === "link_local") {
      return { allowed: false, reason: "HARD DENY: link-local address", target_class: cls };
    }
    if (cls === "reserved") {
      return { allowed: false, reason: "HARD DENY: reserved/non-routable address", target_class: cls };
    }

    let matched: string | undefined;
    for (const entry of this.state.allow) {
      if (matches(entry, normalized)) {
        matched = entry;
        break;
      }
    }
    if (!matched) {
      return {
        allowed: false,
        reason: `no scope entry matches "${normalized.display}" — add it via scope_add or pick an in-scope target`,
        target_class: cls,
      };
    }

    const host = splitHostPort(normalized.value).host;
    const entryHost = splitHostPort(matched).host;
    const needsResolution = !isIP(host) && !entryHost.includes("/");
    if (!needsResolution) {
      return { allowed: true, reason: `matches scoped entry "${matched}"`, target_class: cls, matched };
    }

    let addresses: string[];
    try {
      addresses = (await dns.lookup(host, { all: true })).map((a) => a.address);
    } catch {
      return {
        allowed: false,
        reason: `fail-closed: scoped hostname "${host}" did not resolve`,
        target_class: "unresolvable_input",
        matched,
      };
    }

    const resolvedClasses = new Set(addresses.map((a) => classify(a)));
    if (resolvedClasses.has("cloud_metadata")) {
      return {
        allowed: false,
        reason: `DNS rebinding guard: "${host}" resolves to a cloud metadata address (${addresses.join(", ")})`,
        target_class: "cloud_metadata",
        matched,
      };
    }
    if (
      resolvedClasses.has("link_local") ||
      resolvedClasses.has("reserved")
    ) {
      return {
        allowed: false,
        reason: `DNS rebinding guard: "${host}" resolves to link-local/reserved space (${addresses.join(", ")})`,
        target_class: "link_local",
        matched,
      };
    }
    // Public-scoped names must not silently become internal targets...
    if (cls === "public" && (resolvedClasses.has("private") || resolvedClasses.has("loopback"))) {
      return {
        allowed: false,
        reason: `DNS rebinding guard: public-scoped "${host}" resolves to private address (${addresses.join(", ")}) — scope the IP/CIDR explicitly instead`,
        target_class: "private",
        matched,
      };
    }
    // ...and internally-scoped names must not silently become public ones.
    if (
      (cls === "private" || cls === "loopback") &&
      resolvedClasses.has("public")
    ) {
      return {
        allowed: false,
        reason: `class mismatch guard: "${cls}"-scoped "${host}" resolves to public address (${addresses.join(", ")})`,
        target_class: "public",
        matched,
      };
    }
    return { allowed: true, reason: `matches scoped entry "${matched}"`, target_class: cls, matched };
  }
}

function normalizeEntry(entry: string): string | null {
  const s = entry.trim();
  if (s.length === 0 || s.length > 253) return null;
  if (/^\*\.[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)) return s.toLowerCase(); // wildcard domain
  const cidr = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(s);
  if (cidr) {
    const octets = cidr.slice(1, 5).map(Number);
    const bits = Number(cidr[5]);
    if (octets.every((o) => o <= 255) && bits <= 32) return s; // strict IPv4 CIDR
    return null;
  }
  // IPv6 literal, optionally bracketed and with a port: "::1", "[::1]", "[::1]:8080"
  // Stored bare (no brackets, no port) so list/match comparisons stay simple;
  // a port on an unbracketed v6 literal is ambiguous and therefore rejected.
  if (/^\[[0-9a-f:]+\](?::\d{1,5})?$/i.test(s)) {
    return canonicalV6(s.slice(1, s.indexOf("]")).toLowerCase());
  }
  if (/^::ffff:\d{1,3}(\.\d{1,3}){3}$/i.test(s)) return s.toLowerCase(); // mapped-v6 dotted
  if (/^[0-9a-f:]+$/i.test(s) && (s.match(/:/g)?.length ?? 0) >= 2) {
    return canonicalV6(s.toLowerCase());
  }
  if (/^[\w.-]+:\d{1,5}$/i.test(s)) return s.toLowerCase(); // host:port
  if (/^[\w.-]+$/i.test(s)) return s.toLowerCase(); // host
  return null;
}

function isIP(host: string): boolean {
  return isIPv4(host) || host.includes(":");
}

function entryHostIncludesSlash(entry: string): boolean {
  return entry.includes("/");
}

/** True when two IPv4 CIDRs share at least one address. */
function cidrOverlaps(a: string, b: string): boolean {
  const toInt = (s: string): number => s.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
  const [aBase, aBits] = a.split("/");
  const [bBase, bBits] = b.split("/");
  const mask = (bits: number): number => (bits === 0 ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0);
  const aI = toInt(aBase), bI = toInt(bBase);
  const m = Number(aBits) <= Number(bBits) ? mask(Number(aBits)) : mask(Number(bBits));
  return (aI & m) === (bI & m);
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
/** Decode an IPv4-mapped IPv6 literal (dotted or hex tail) to plain IPv4, else null. */
function unwrapMappedV6(host: string): string | null {
  const m = /^::ffff:(.+)$/i.exec(host);
  if (!m) return null;
  const tail = m[1];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(tail)) return tail;
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(tail);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

/** Parse an IPv6 literal (no brackets/port/zone) into its 8 hextet groups, else null. */
export function parseIPv6(s: string): number[] | null {
  if (!s.includes(":") || !/^[0-9a-f:.]+$/i.test(s)) return null;
  const doubleColons = s.match(/::/g)?.length ?? 0;
  if (doubleColons > 1) return null;
  // Embedded dotted-quad tails are rejected here; mapped-v6 is unwrapped earlier.
  if (/\.|$/.test("") ) { /* noop to keep structure clear */ }
  const parts = s.split(":");
  if (parts.some((p) => p.includes("."))) return null;
  let head: string[] = parts;
  let tail: string[] = [];
  if (doubleColons === 1) {
    const idx = s.indexOf("::");
    const headStr = s.slice(0, idx);
    const tailStr = s.slice(idx + 2);
    head = headStr === "" ? [] : headStr.split(":");
    tail = tailStr === "" ? [] : tailStr.split(":");
    if (head.some((p) => p === "") || tail.some((p) => p === "")) return null;
  }
  if (head.length + tail.length > 8) return null;
  const missing = 8 - (head.length + tail.length);
  if (!s.includes("::") && missing !== 0) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail].map((g) => parseInt(g || "0", 16));
  return groups.some((g) => Number.isNaN(g)) ? null : groups;
}

/** Canonical lowercase form of an IPv6 literal ("0:0:..:1" -> "::1"), or the input unchanged. */
export function canonicalV6(host: string): string {
  const g = parseIPv6(host);
  if (!g) return host;
  // RFC 5952-style: first longest zero run becomes "::"
  let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (g[i] === 0) { if (curStart === -1) curStart = i; curLen++; if (curLen > bestLen) { bestStart = curStart; bestLen = curLen; } }
    else curStart = -1, curLen = 0;
  }
  if (bestLen < 2) return g.map((n) => n.toString(16)).join(":");
  const head = g.slice(0, bestStart).map((n) => n.toString(16)).join(":");
  const tail = g.slice(bestStart + bestLen).map((n) => n.toString(16)).join(":");
  return `${head}::${tail}`;
}

function classify(hostPort: string): TargetClass {
  let host = splitHostPort(hostPort).host;
  // IPv4-mapped IPv6 ("::ffff:169.254.169.254", "::ffff:a9fe:a9fe") must be
  // judged by its embedded IPv4 address, otherwise it sails past every v4
  // tripwire as "public". Hex tails we cannot decode are treated as reserved.
  const mappedTail = /^::ffff:/i.test(host) ? unwrapMappedV6(host) : null;
  if (/^::ffff:/i.test(host)) {
    if (mappedTail === null) return "reserved";
    host = mappedTail;
  }
  if (host === "169.254.169.254" || host === "metadata.google.internal") return "cloud_metadata";
  if (host === "localhost" || host.endsWith(".localhost")) return "loopback";
  if (isIPv4(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 127) return "loopback";
    if (a === 169 && b === 254) return "link_local";
    if (a === 0 || a >= 224) return "reserved"; // this-network, multicast, reserved
    if (a === 100 && b >= 64 && b <= 127) return "reserved"; // CGNAT 100.64.0.0/10
    if (a === 198 && (b === 18 || b === 19)) return "reserved"; // benchmarking 198.18.0.0/15
    if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return "private";
    return "public";
  }
  if (host.includes(":")) {
    const g = parseIPv6(host);
    if (!g) return "reserved"; // colon-string we cannot parse: fail closed
    if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0 && g[6] === 0 && g[7] === 1)
      return "loopback";
    if ((g[0] & 0xffc0) === 0xfe80) return "link_local"; // fe80::/10
    if ((g[0] & 0xfe00) === 0xfc00) return "private"; // fc00::/7 ULA
    if (g[0] >= 0xff00) return "reserved"; // multicast ff00::/8 and beyond
    if (g[0] === 0x2001 && g[1] === 0x0db8) return "reserved"; // documentation
    return "public";
  }
  return /\.local$/.test(host) ? "private" : "public";
}

/**
 * Split host[:port] without mangling IPv6 literals ("::1" is a host, not
 * "host : port"). Bracketed forms "[::1]" / "[::1]:8080" are unwrapped.
 */
export function splitHostPort(s: string): { host: string; port?: string } {
  const x = s.trim();
  if (x.startsWith("[")) {
    const close = x.indexOf("]");
    if (close !== -1) {
      const host = x.slice(1, close);
      const port = x.slice(close + 1).match(/^:(\d{1,5})$/)?.[1];
      return { host, port };
    }
  }
  if (/^[0-9a-f:]+$/i.test(x) && (x.match(/:/g)?.length ?? 0) >= 2) return { host: canonicalV6(x.toLowerCase()) }; // bare IPv6
  const m = /^([\w.-]+):(\d{1,5})$/.exec(x);
  if (m) return { host: m[1].toLowerCase(), port: m[2] };
  return { host: x.toLowerCase() };
}

function isIPv4(s: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  return m !== null && m.slice(1).every((o) => Number(o) <= 255);
}


function matches(entry: string, target: { value: string }): boolean {
  // v6 targets come through URL.hostname bracketed ("[::1]:80"); entries are stored bare.
  const { host, port } = splitHostPort(target.value);
  const { host: entryHost, port: entryPort } = splitHostPort(entry);

  if (entryHost.includes("/")) return isIPv4(host) && cidrContains(entryHost, host); // CIDR
  if (entryHost.startsWith("*.")) {
    const suffix = entryHost.slice(1); // ".example.com"
    return host.endsWith(suffix) && host.length > suffix.length;
  }
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
