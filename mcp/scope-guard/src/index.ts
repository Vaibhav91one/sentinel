import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { connect as tcpConnect, type Socket } from "node:net";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { Scope, defaultScopeFile, normalizeTargetValue, isLoopbackTarget } from "./scope.js";
import { Audit, defaultAuditFile } from "./audit.js";

const NAME = "sentinel-scope-guard";
const VERSION = "0.2.0";
const PORT = Number(process.env.PORT ?? 9930);

/**
 * When GUARD_TOKEN is set, every /mcp request must present it as a Bearer
 * token. This is what stops anything except the TrueForge harness (which
 * stores the same value in the connector's header-auth config) from minting
 * grants or editing the allowlist. Unset = open, for local dev only.
 */
const GUARD_TOKEN = process.env.GUARD_TOKEN;

/**
 * REQUIRE_GUARD_TOKEN=1 makes the human-approval invariant fail closed:
 * without a verified harness caller (bearer token), request_intrusive_approval
 * refuses to mint grants at all instead of trusting that the harness pause
 * happened. Default is warn-only so local development stays friction-free.
 */
const REQUIRE_GUARD_TOKEN = process.env.REQUIRE_GUARD_TOKEN === "1";

/**
 * When true (REQUIRE_GUARD_TOKEN=1 set but no GUARD_TOKEN configured) the
 * harness-only invariant cannot hold, so EVERY allowlist mutation and grant
 * mint fails closed - not just grants.
 */
function failClosed(): boolean {
  return REQUIRE_GUARD_TOKEN && !GUARD_TOKEN;
}

const FAIL_CLOSED_MSG =
  "fail-closed deployment: REQUIRE_GUARD_TOKEN=1 requires GUARD_TOKEN to be set so only the TrueForge harness connector can mutate policy.";

/**
 * Audit provenance (L1): every entry records how the caller was authenticated.
 * bearer-verified = presented GUARD_TOKEN (the harness connector identity);
 * open-local      = no token configured, caller is any local process.
 * Actor strings remain role labels; `auth` is the verifiable half.
 */
const AUTH_MODE = GUARD_TOKEN ? "bearer-verified" : "open-local";

/**
 * SENTINEL_LAB_MODE=1 lets a single human approval mint a multi-use, longer-TTL
 * grant for LOOPBACK lab targets only, so a subagent can clear a full challenge
 * sweep on one approval instead of pausing per challenge. Off by default =
 * unchanged production posture (single-use, human-gated, 10 min). Every use is
 * still audited via the hash-chained log. Non-loopback targets ignore this flag.
 */
const LAB_MODE = process.env.SENTINEL_LAB_MODE === "1";
const LAB_GRANT_TTL_MS = 60 * 60 * 1000; // 60 min for lab sweeps

const scope = new Scope(defaultScopeFile());
const audit = new Audit(defaultAuditFile());

/** One-time tokens proving a human approved an intrusive action, with 10-minute expiry. */
interface Grant {
  token: string;
  target: string;
  action: string;
  expires_at: number;
  multi_use: boolean; // lab-mode loopback grants survive verification until TTL
}
const grants = new Map<string, Grant>();
const GRANT_TTL_MS = 10 * 60 * 1000;

function mintGrant(target: string, action: string, multiUse = false): string {
  const token = crypto.randomUUID().replace(/-/g, "");
  const ttl = multiUse ? LAB_GRANT_TTL_MS : GRANT_TTL_MS;
  grants.set(token, { token, target, action, expires_at: Date.now() + ttl, multi_use: multiUse });
  return token;
}

export function consumeGrant(token: string, target: string): { valid: boolean; reason: string } {
  const g = grants.get(token);
  if (!g) return { valid: false, reason: "unknown grant token" };
  if (Date.now() > g.expires_at) {
    grants.delete(token); // expired tokens are garbage-collected on first touch
    return { valid: false, reason: "grant expired" };
  }
  // A wrong-target attempt does NOT burn the grant: typos by the approved
  // caller should not force a fresh human approval. Only a matching
  // (token, target) pair consumes the single use.
  if (g.target !== target) {
    return { valid: false, reason: `grant was issued for ${g.target}, not ${target} (grant remains active)` };
  }
  // Lab-mode grants are multi-use: they stay valid for their whole TTL so one
  // approval covers a full challenge sweep. Production grants are single-use.
  if (g.multi_use) {
    return { valid: true, reason: `lab-mode grant for "${g.action}" on ${g.target} (multi-use until expiry)` };
  }
  grants.delete(token);
  return { valid: true, reason: `human-approved grant for "${g.action}" on ${g.target}` };
}

function text(result: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

function buildServer(): McpServer {
  const server = new McpServer({ name: NAME, version: VERSION });

  server.registerTool(
    "scope_check",
    {
      title: "Scope check",
      description:
        "MUST be called before any network contact with a target. Returns whether the host is inside the authorized scan scope. Every call is written to an append-only audit log.",
      inputSchema: { target: z.string().describe("Host, URL or IP to check, e.g. http://localhost:3000") },
      annotations: { readOnlyHint: true },
    },
    async ({ target }) => {
      const verdict = await scope.check(target);
      audit.append({
        actor: "agent",
        auth: AUTH_MODE,
        action: "scope_check",
        args: { target },
        verdict: verdict.allowed ? "allowed" : "denied",
        reason: verdict.reason,
      });
      return text(verdict);
    },
  );

  server.registerTool(
    "http_probe",
    {
      title: "Scoped HTTP relay (black-box transport)",
      description:
        "Host-side HTTP transport for BLACK-BOX targets the sandbox cannot reach (restricted egress). "
        + "The request executes on the HOST after mandatory scope validation - every call is scope-checked and audited. "
        + "HTTP/HTTPS GET/POST/HEAD/OPTIONS only; redirects are RETURNED (not followed - re-probe the Location URL so each hop is re-scoped); "
        + "response bodies capped at 32 KB; no raw TCP, no port scanning. For deep exploitation continue inside the sandbox lab.",
      inputSchema: {
        url: z.string().describe("Absolute http(s) URL to probe"),
        method: z.enum(["GET", "POST", "HEAD", "OPTIONS"]).default("GET").optional(),
        headers: z.record(z.string()).optional().describe("Extra request headers"),
        body: z.string().max(16384).optional().describe("Request body (POST only)"),
        timeout_seconds: z.number().int().min(3).max(30).optional().describe("Default 15"),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ url, method, headers, body, timeout_seconds }) => {
      const m = (method ?? "GET").toUpperCase();
      const verdict = await scope.check(url);

      const auditAndReturn = (result: CallToolResult, v: "allowed" | "denied", reason: string) => {
        audit.append({
          actor: "agent",
          auth: AUTH_MODE,
          action: "http_probe",
          args: { url, method: m },
          verdict: v,
          reason,
        });
        return result;
      };

      if (!verdict.allowed) {
        return auditAndReturn(
          text({ probed: false, error: `scope denial: ${verdict.reason}` }),
          "denied",
          verdict.reason,
        );
      }

      // scheme lock
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return auditAndReturn(text({ probed: false, error: "invalid URL" }), "denied", "invalid URL");
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return auditAndReturn(text({ probed: false, error: "only http/https schemes allowed" }), "denied", "scheme");
      }

      const started = Date.now();
      const ctrl = AbortSignal.timeout((timeout_seconds ?? 15) * 1000);
      const doFetch = (): Promise<Response> =>
        fetch(parsed.toString(), {
          method: m,
          headers: { "user-agent": "Sentinel-Relay/0.2", ...(headers ?? {}) },
          body: m === "POST" && body !== undefined ? body : undefined,
          redirect: "manual", // every hop must be re-scoped by the caller
          signal: ctrl,
        });

      return doFetch()
        .then(async (res) => {
          const ab = await res.arrayBuffer();
          const cap = Math.min(ab.byteLength, 32768);
          const preview = Buffer.from(ab.slice(0, cap)).toString("utf8");
          const hdrs = Object.fromEntries([...res.headers.entries()].slice(0, 40));
          const ms = Date.now() - started;
          return auditAndReturn(
            text({
              probed: true,
              status: res.status,
              location: res.headers.get("location") ?? null,
              headers: hdrs,
              body_bytes: ab.byteLength,
              body_preview: preview,
              truncated: ab.byteLength > cap,
              elapsed_ms: ms,
              note: res.status >= 300 && res.status < 400
                ? "redirect returned unfollowed - scope_check the Location target before continuing"
                : undefined,
            }),
            "allowed",
            `HTTP ${res.status} in ${ms}ms`,
          );
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          return auditAndReturn(text({ probed: false, error: `transport failure: ${msg}` }), "denied", msg);
        });
    },
  );

  server.registerTool(
    "tcp_probe",
    {
      title: "Scoped raw TCP relay (non-HTTP transport)",
      description:
        "Host-side raw TCP transport for protocols http_probe can't reach (SMTP, Redis, raw sockets, etc.) - single "
        + "connect, optional write, capped read, then close. Every call is scope-checked and audited exactly like "
        + "http_probe. This is a connect+send+recv PRIMITIVE, not a port scanner - one call touches one host:port. "
        + "Response bytes capped at 32 KB and returned as UTF-8 (best-effort) plus base64 (exact bytes). No raw TCP "
        + "port sweeps - use nmap inside the sandbox for that; this exists for the single-connection black-box case "
        + "http_probe's HTTP-only transport can't cover.",
      inputSchema: {
        host: z.string().describe("Target hostname or IP (no scheme)"),
        port: z.number().int().min(1).max(65535),
        data_base64: z.string().optional().describe("Bytes to write after connecting, base64-encoded"),
        timeout_seconds: z.number().int().min(1).max(20).optional().describe("Default 8"),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ host, port, data_base64, timeout_seconds }) => {
      const target = `${host}:${port}`;
      const verdict = await scope.check(target);

      const auditAndReturn = (result: CallToolResult, v: "allowed" | "denied", reason: string) => {
        audit.append({
          actor: "agent",
          auth: AUTH_MODE,
          action: "tcp_probe",
          args: { host, port, wrote_bytes: data_base64 ? Buffer.from(data_base64, "base64").length : 0 },
          verdict: v,
          reason,
        });
        return result;
      };

      if (!verdict.allowed) {
        return auditAndReturn(
          text({ probed: false, error: `scope denial: ${verdict.reason}` }),
          "denied",
          verdict.reason,
        );
      }

      const timeoutMs = (timeout_seconds ?? 8) * 1000;
      const started = Date.now();

      return new Promise<CallToolResult>((resolve) => {
        const chunks: Buffer[] = [];
        let total = 0;
        const CAP = 32768;
        let settled = false;
        const finish = (ok: boolean, extra: Record<string, unknown> = {}) => {
          if (settled) return;
          settled = true;
          const buf = Buffer.concat(chunks, Math.min(total, CAP));
          const ms = Date.now() - started;
          resolve(
            auditAndReturn(
              text({
                probed: ok,
                bytes_read: total,
                body_preview_utf8: buf.toString("utf8"),
                body_base64: buf.toString("base64"),
                truncated: total > CAP,
                elapsed_ms: ms,
                ...extra,
              }),
              ok ? "allowed" : "denied",
              ok ? `${total} bytes in ${ms}ms` : String(extra.error ?? "connection failed"),
            ),
          );
        };

        const sock = tcpConnect({ host, port, timeout: timeoutMs });
        sock.on("connect", () => {
          if (data_base64) {
            try {
              sock.write(Buffer.from(data_base64, "base64"));
            } catch {
              /* write failure surfaces via 'error' */
            }
          }
        });
        sock.on("data", (chunk: Buffer) => {
          if (total < CAP) chunks.push(chunk);
          total += chunk.length;
          // give the peer a short quiet window after connect to finish a
          // one-shot banner/response, then close - this is a single-probe
          // primitive, not a persistent connection.
          if (total >= CAP) sock.end();
        });
        sock.on("timeout", () => {
          sock.destroy();
          finish(true, { note: "read timeout reached (this is the normal end for a probe with no explicit close)" });
        });
        sock.on("close", () => finish(true));
        sock.on("error", (err) => finish(false, { error: err.message }));
      });
    },
  );

  server.registerTool(
    "scope_add_temporary",
    {
      title: "Add temporary bootstrap scope",
      description:
        "AUTONOMOUS (no human pause): add a SELF-EXPIRING public-host entry for lab/bootstrap plumbing "
        + "(package repos, CDNs, download hosts). Caps: max 5 live entries, TTL <= 60 minutes, public class only. "
        + "Permanent widening still requires the approval-gated scope_add.",
      inputSchema: {
        entry: z.string().describe("Public hostname to authorize temporarily"),
        ttl_minutes: z.number().int().min(1).max(60).optional().describe("Lifetime in minutes (default 30)"),
      },
      annotations: { readOnlyHint: false },
    },
    ({ entry, ttl_minutes }) => {
      const ttl = ttl_minutes ?? 30;
      const error = scope.addTemporary(entry, ttl);
      audit.append({
        actor: "agent",
        auth: AUTH_MODE,
        action: "scope_add_temporary",
        args: { entry, ttl_minutes: ttl },
        verdict: error ? "denied" : "mutated",
        reason: error ?? `temporary entry added (${ttl} min)`,
      });
      return text(error === null ? { added: entry, expires_in_minutes: ttl, temporary: scope.temporaryList() } : { error });
    },
  );

  server.registerTool(
    "scope_add",
    {
      title: "Add scope entry",
      description:
        "Authorize a target by adding it to the allowlist. Accepts hostname[:port], IP, CIDR or *.domain wildcard. Cloud metadata endpoints are refused.",
      inputSchema: { entry: z.string().describe("Scope entry to add") },
      annotations: { destructiveHint: true },
    },
    async ({ entry }) => {
      if (failClosed()) {
        audit.append({ actor: "agent", auth: AUTH_MODE, action: "scope_add", args: { entry }, verdict: "denied", reason: FAIL_CLOSED_MSG });
        return text({ error: FAIL_CLOSED_MSG });
      }
      const error = scope.add(entry);
      audit.append({
        actor: "human-via-agent",
        auth: AUTH_MODE,
        action: "scope_add",
        args: { entry },
        verdict: error ? "denied" : "mutated",
        reason: error ?? `entry added`,
      });
      return text(error === null ? { added: entry, allow: scope.list() } : { error });
    },
  );

  server.registerTool(
    "scope_remove",
    {
      title: "Remove scope entry",
      description: "Remove a target from the allowlist.",
      inputSchema: { entry: z.string().describe("Exact scope entry to remove") },
      annotations: { destructiveHint: true },
    },
    async ({ entry }) => {
      if (failClosed()) {
        audit.append({ actor: "agent", auth: AUTH_MODE, action: "scope_remove", args: { entry }, verdict: "denied", reason: FAIL_CLOSED_MSG });
        return text({ error: FAIL_CLOSED_MSG });
      }
      const removed = scope.remove(entry);
      audit.append({
        actor: "human-via-agent",
        auth: AUTH_MODE,
        action: "scope_remove",
        args: { entry },
        verdict: removed ? "mutated" : "denied",
        reason: removed ? "entry removed" : "entry not found",
      });
      return text({ removed, allow: scope.list() });
    },
  );

  server.registerTool(
    "request_intrusive_approval",
    {
      title: "Request intrusive-scan approval",
      description:
        "Call BEFORE any active/intrusive action against a target (port scans, exploit probes, brute force, fuzzing). "
        + "The harness pauses this call for explicit human Allow/Deny before it executes; on approval the guard verifies the target is in scope and mints a single-use consent token (embed as SENTINEL_GRANT=<token>). "
        + "CONSENT BOOKKEEPING, NOT network enforcement: nothing yet blocks a command that omits the token (roadmap: egress proxy). Grants are scoped to host[:port] only - scheme and path are not part of the binding.",
      inputSchema: {
        target: z.string().describe("The exact target the intrusive action will touch"),
        action: z.string().describe("Short label of the action, e.g. 'nmap full port sweep'"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ target, action }) => {
      const verdict = await scope.check(target);
      if (!verdict.allowed) {
        audit.append({
          actor: "agent",
          auth: AUTH_MODE,
          action: "intrusive_request",
          args: { target, action },
          verdict: "denied",
          reason: `out-of-scope target refused before human review: ${verdict.reason}`,
        });
        return text({ approved: false, grant_token: null, reason: verdict.reason });
      }
      if (REQUIRE_GUARD_TOKEN && !GUARD_TOKEN) {
        audit.append({
          actor: "agent",
          auth: AUTH_MODE,
          action: "intrusive_request",
          args: { target, action },
          verdict: "denied",
          reason: "fail-closed: REQUIRE_GUARD_TOKEN=1 but no GUARD_TOKEN configured - harness-only invariant cannot be verified",
        });
        return text({
          approved: false,
          grant_token: null,
          reason:
            "fail-closed deployment: REQUIRE_GUARD_TOKEN=1 requires a shared bearer token so only the TrueForge harness connector can mint grants. Configure GUARD_TOKEN on the guard and the same value as header auth on the harness connector.",
        });
      }
      const canonicalTarget = normalizeTargetValue(target) ?? target;
      const labGrant = LAB_MODE && isLoopbackTarget(canonicalTarget);
      const token = mintGrant(canonicalTarget, action, labGrant);
      const ttlMin = (labGrant ? LAB_GRANT_TTL_MS : GRANT_TTL_MS) / 60000;
      audit.append({
        actor: "human-via-agent",
        auth: AUTH_MODE,
        action: "intrusive_request",
        // fingerprint only - audit_read must never expose redeemable grant material
        args: { target: canonicalTarget, action, grant: `${token.slice(0, 8)}…`, lab_mode: labGrant },
        verdict: "allowed",
        reason: `human Allow/Deny enforced upstream by the harness checkpoint on this call; in-scope verified, ${labGrant ? `lab-mode multi-use grant minted (${ttlMin} min, loopback target)` : `single-use grant minted (${ttlMin} min)`}${GUARD_TOKEN ? "" : "; WARNING: no GUARD_TOKEN set - boundary open to local callers"}`,
      });
      const result: Record<string, unknown> = {
        approved: true,
        grant_token: token,
        expires_in_minutes: ttlMin,
        note: labGrant
          ? "LAB-MODE multi-use grant (loopback target): reusable for a full challenge sweep until expiry; embed as SENTINEL_GRANT=<token> and confirm each use with verify_grant"
          : "single-use; embed as SENTINEL_GRANT=<token> in the command and confirm with verify_grant (network-layer enforcement is roadmap)",
      };
      if (!GUARD_TOKEN) {
        result.warning =
          "no GUARD_TOKEN configured: any local caller could reach this endpoint. Set GUARD_TOKEN here and header auth on the harness connector for production posture.";
      }
      return text(result);
    },
  );

  server.registerTool(
    "osv_query",
    {
      title: "Query OSV for package vulnerabilities",
      description:
        "Runs host-side (the sandbox has restricted egress). Query OSV.dev for known vulnerabilities affecting a package version.",
      inputSchema: {
        name: z.string().describe("Package name, e.g. express"),
        ecosystem: z.string().describe("OSV ecosystem, e.g. npm, PyPI, Go"),
        version: z.string().optional().describe("Version string when known"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ name, ecosystem, version }) => {
      const body: Record<string, unknown> = { package: { name, ecosystem } };
      if (version) body.version = version;
      try {
        const res = await fetch("https://api.osv.dev/v1/query", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20000),
        });
        const d = await res.json();
        audit.append({
          actor: "agent",
          auth: AUTH_MODE,
          action: "osv_query",
          args: { name, ecosystem, version },
          verdict: "allowed",
          reason: `${(d.vulns ?? []).length} advisories`,
        });
        return text({ count: d.vulns?.length ?? 0, vulns: d.vulns ?? [] });
      } catch (err) {
        return text({ error: `osv query failed: ${(err as Error).message}` });
      }
    },
  );

  server.registerTool(
    "osv_get",
    {
      title: "Fetch one OSV advisory",
      description: "Host-side. Fetch full details (severity, affected ranges, references) for an OSV id such as GHSA-xxxx or CVE-xxxx.",
      inputSchema: { id: z.string().describe("OSV/GHSA/CVE id") },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      try {
        const res = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, {
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) return text({ error: `HTTP ${res.status}`, found: false });
        const d = await res.json();
        return text({
          id: d.id,
          summary: d.summary,
          details: typeof d.details === "string" ? d.details.slice(0, 1500) : d.details,
          severity: d.severity ?? d.database_specific?.severity,
          aliases: d.aliases,
          affected_count: Array.isArray(d.affected) ? d.affected.length : 0,
          references: (d.references ?? []).slice(0, 8),
        });
      } catch (err) {
        return text({ error: `osv fetch failed: ${(err as Error).message}` });
      }
    },
  );

  server.registerTool(
    "verify_grant",
    {
      title: "Verify intrusive-scan grant",
      description:
        "Consumes a single-use grant token for a target. Returns valid:false on reuse, expiry, or target mismatch (host[:port] scope - scheme/path are not part of the binding). "
        + "This is consent bookkeeping; see policy_get for the enforcement roadmap.",
      inputSchema: {
        token: z.string().describe("The SENTINEL_GRANT value returned by request_intrusive_approval"),
        target: z.string().describe("The exact target the grant was issued for"),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ token, target }) => {
      const requested = normalizeTargetValue(target) ?? target;
      const result = consumeGrant(token, requested);
      const g = result.valid ? null : undefined;
      void g;
      audit.append({
        actor: "agent",
        auth: AUTH_MODE,
        action: "grant_verify",
        args: { target: requested, token: `${token.slice(0, 8)}…` },
        verdict: result.valid ? "allowed" : "denied",
        reason: result.reason,
      });
      return text({ ...result, bound_target: requested });
    },
  );

  server.registerTool(
    "scope_list",
    {
      title: "List scope",
      description: "Return the current authorized-target allowlist.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => text({ allow: scope.list(), temporary: scope.temporaryList(), file: scope.file }),
  );

  server.registerTool(
    "audit_read",
    {
      title: "Read audit log",
      description: "Return the last N entries of the append-only scope audit log, newest first.",
      inputSchema: { limit: z.number().int().min(1).max(500).default(25).optional().describe("How many entries (default 25)") },
      annotations: { readOnlyHint: true },
    },
    ({ limit }) => text({ entries: audit.read(limit ?? 25), file: audit.file }),
  );

  server.registerTool(
    "policy_get",
    {
      title: "Get policy",
      description: "Explain the Sentinel authorization policy and report current scope size.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      text({
        rules: [
          "every outbound contact requires a prior allowed scope_check",
          "lab-bootstrap hosts may be added autonomously via scope_add_temporary (public only, max 5, self-expiring <=60min); permanent widening always needs a human",
          "public-scoped hostnames are DNS-resolved at check time; resolution into private/link-local space is denied as a rebinding attempt",
          "residual risk: the target may re-resolve between scope_check and the actual connection - check-time resolution narrows but does not eliminate rebinding; an egress proxy is the complete fix (roadmap)",
          "cloud metadata endpoints (169.254.169.254, metadata.google.internal) are hard-denied, including by DNS resolution",
          "link-local space is hard-denied, including CIDR entries that overlap it",
          "intrusive actions: the TrueForge harness pauses request_intrusive_approval for a human Allow/Deny BEFORE it executes; the minted grant is CONSENT BOOKKEEPING ONLY - it is not yet enforced at the network/command layer (roadmap: egress proxy)",
          "trust boundary: set GUARD_TOKEN here + header auth on the harness connector so ONLY the harness can call this server; REQUIRE_GUARD_TOKEN=1 fails closed ALL policy mutations (add/remove/grants) when that invariant cannot be verified",
          "all decisions land in the append-only audit log (audit_read)",
        ],
        allow_size: scope.list().length,
        scope_file: scope.file,
        audit_file: audit.file,
      }),
  );

  return server;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        resolveBody(chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined);
      } catch (err) {
        rejectBody(err);
      }
    });
    req.on("error", rejectBody);
  });
}

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, name: NAME }));
    return;
  }

  if (req.method === "POST" && (req.url === "/mcp" || req.url?.startsWith("/mcp?"))) {
    if (GUARD_TOKEN) {
      const auth = req.headers.authorization ?? "";
      const expected = `Bearer ${GUARD_TOKEN}`;
      if (auth !== expected) {
        audit.append({
          actor: String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown"),
          auth: AUTH_MODE,
          action: "auth",
          args: { url: req.url },
          verdict: "denied",
          reason: "missing or wrong bearer token on MCP endpoint",
        });
        res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
    }
    let body: unknown;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(400).end("invalid JSON body");
      return;
    }

    // Stateless mode: one transport + one server instance per request.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const mcp = buildServer();
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500).end("internal error");
      console.error(`[scope-guard] request failed:`, err);
    }
    return;
  }

  res.writeHead(405, { "content-type": "application/json" }).end(JSON.stringify({ error: "method not allowed" }));
});

httpServer.listen(PORT, "127.0.0.1", () => {
  console.log(`[${NAME}] listening on http://127.0.0.1:${PORT}/mcp`);
  console.log(`[${NAME}] scope file: ${scope.file} (${scope.list().length} entries)`);
  console.log(`[${NAME}] audit file: ${audit.file}`);
  if (!GUARD_TOKEN) {
    console.warn(`[${NAME}] WARNING: GUARD_TOKEN not set - any local process can call this server. Set it (and header auth on the TrueForge connector) for anything beyond local dev.`);
  }
});

/**
 * EGRESS PROXY (opt-in, EGRESS_PROXY_PORT unset = off, no behavior change to
 * existing deployments). This is the roadmap item referenced throughout this
 * codebase's comments and SECURITY.md R3/R7: grants and scope_check are
 * currently ADVISORY - a tool call that skips them isn't network-blocked, and
 * scope is validated at scope_check TIME, not at the moment a connection
 * actually opens (a rebinding window).
 *
 * When wired as the sandbox's HTTP_PROXY/HTTPS_PROXY (integration step, not
 * done by this file alone - see docs), every outbound connection is forced
 * through here, where scope.check() runs FRESH at the actual moment of
 * connecting (the check and the connect are the same atomic operation - no
 * TOCTOU window, closing R7 for any traffic that goes through it), and an
 * X-Sentinel-Grant header, if present, is validated+consumed against the same
 * grant store verify_grant uses (closing R3: a presented grant is now
 * cryptographically checked at the network layer, not just advisory).
 *
 * Traffic WITHOUT a grant header still passes on scope alone (unchanged
 * baseline for passive recon) - this proxy does not yet know which
 * connections are "the approved intrusive one" vs. passive traffic; making
 * grant presentation MANDATORY for intrusive-shaped traffic is a doctrine/
 * skills change (always attach the header for active-phase commands), not
 * something inferable from a bare host:port.
 */
const EGRESS_PROXY_PORT = process.env.EGRESS_PROXY_PORT ? Number(process.env.EGRESS_PROXY_PORT) : undefined;

if (EGRESS_PROXY_PORT) {
  const proxyAudit = (target: string, v: "allowed" | "denied", reason: string) =>
    audit.append({ actor: "egress-proxy", auth: AUTH_MODE, action: "egress_connect", args: { target }, verdict: v, reason });

  /** Fresh scope + (if presented) grant check, run at the moment of connecting. */
  const authorizeConnect = async (
    target: string,
    grantToken: string | undefined,
  ): Promise<{ ok: boolean; reason: string }> => {
    const verdict = await scope.check(target);
    if (!verdict.allowed) {
      proxyAudit(target, "denied", `scope: ${verdict.reason}`);
      return { ok: false, reason: `scope denial: ${verdict.reason}` };
    }
    if (grantToken) {
      const g = consumeGrant(grantToken, normalizeTargetValue(target) ?? target);
      if (!g.valid) {
        proxyAudit(target, "denied", `grant: ${g.reason}`);
        return { ok: false, reason: `grant denial: ${g.reason}` };
      }
    }
    proxyAudit(target, "allowed", grantToken ? "scope + grant verified at connect time" : "scope verified at connect time (no grant presented)");
    return { ok: true, reason: "ok" };
  };

  const proxyServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    // Plain HTTP proxying (absolute-form request-target, RFC 7230 §5.3.2).
    // HTTPS goes through CONNECT tunneling below, not this path.
    req.on("error", () => {}); // client aborts mid-request must not crash the process
    res.on("error", () => {});
    void (async () => {
      let target: URL;
      try {
        target = new URL(req.url ?? "");
      } catch {
        res.writeHead(400).end("bad request: expected absolute-form proxy request");
        return;
      }
      const grantToken = req.headers["x-sentinel-grant"] as string | undefined;
      const auth = await authorizeConnect(target.host, grantToken);
      if (!auth.ok) {
        res.writeHead(403, { "content-type": "text/plain" }).end(auth.reason);
        return;
      }
      const upstream = httpRequest(
        target,
        { method: req.method, headers: { ...req.headers, host: target.host } },
        (upRes) => {
          res.writeHead(upRes.statusCode ?? 502, upRes.headers);
          upRes.pipe(res);
        },
      );
      upstream.on("error", (err) => {
        if (!res.headersSent) res.writeHead(502).end(`upstream error: ${err.message}`);
      });
      req.pipe(upstream);
    })();
  });

  proxyServer.on("connect", (req: IncomingMessage, clientSocket: Socket, head: Buffer) => {
    // A raw net.Socket crashes the whole process on an unhandled 'error'
    // event unless a listener is attached SYNCHRONOUSLY, before any await -
    // a client aborting mid-scope-check (or after a deny) otherwise takes
    // down the guard. Attach this first, unconditionally.
    let remote: Socket | undefined;
    clientSocket.on("error", () => remote?.destroy());

    void (async () => {
      const target = req.url ?? ""; // CONNECT target-form is exactly "host:port"
      const grantToken = req.headers["x-sentinel-grant"] as string | undefined;
      const auth = await authorizeConnect(target, grantToken);
      if (!auth.ok) {
        if (!clientSocket.destroyed) clientSocket.end(`HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\n${auth.reason}`);
        return;
      }
      const [host, portStr] = target.split(":");
      const port = Number(portStr) || 443;
      remote = tcpConnect(port, host, () => {
        if (clientSocket.destroyed) { remote?.destroy(); return; }
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) remote!.write(head);
        remote!.pipe(clientSocket);
        clientSocket.pipe(remote!);
      });
      remote.on("error", (err) => {
        if (!clientSocket.destroyed) clientSocket.end(`HTTP/1.1 502 Bad Gateway\r\n\r\n${err.message}`);
      });
    })();
  });

  proxyServer.listen(EGRESS_PROXY_PORT, "127.0.0.1", () => {
    console.log(`[${NAME}] egress proxy listening on http://127.0.0.1:${EGRESS_PROXY_PORT} (opt-in enforcement layer)`);
  });
}
