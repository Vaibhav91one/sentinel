import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { Scope, defaultScopeFile } from "./scope.js";
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

const scope = new Scope(defaultScopeFile());
const audit = new Audit(defaultAuditFile());

/** One-time tokens proving a human approved an intrusive action, with 10-minute expiry. */
interface Grant {
  token: string;
  target: string;
  action: string;
  expires_at: number;
}
const grants = new Map<string, Grant>();
const GRANT_TTL_MS = 10 * 60 * 1000;

function mintGrant(target: string, action: string): string {
  const token = crypto.randomUUID().replace(/-/g, "");
  grants.set(token, { token, target, action, expires_at: Date.now() + GRANT_TTL_MS });
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
        action: "scope_check",
        args: { target },
        verdict: verdict.allowed ? "allowed" : "denied",
        reason: verdict.reason,
      });
      return text(verdict);
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
    ({ entry }) => {
      const error = scope.add(entry);
      audit.append({
        actor: "human-via-agent",
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
    ({ entry }) => {
      const removed = scope.remove(entry);
      audit.append({
        actor: "human-via-agent",
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
        + "The harness pauses this call for explicit human Allow/Deny before it executes; on approval the guard verifies the target is in scope and returns a single-use grant token that must be included in the scan command as SENTINEL_GRANT=<token>.",
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
      const token = mintGrant(target, action);
      audit.append({
        actor: "human-via-agent",
        action: "intrusive_request",
        args: { target, action, grant: token },
        verdict: "allowed",
        reason: `human Allow/Deny enforced upstream by the harness checkpoint on this call; in-scope verified, single-use grant minted (${GRANT_TTL_MS / 60000} min)${GUARD_TOKEN ? "" : "; WARNING: no GUARD_TOKEN set - boundary open to local callers"}`,
      });
      const result: Record<string, unknown> = {
        approved: true,
        grant_token: token,
        expires_in_minutes: GRANT_TTL_MS / 60000,
        note: "single-use; embed as SENTINEL_GRANT=<token> in the command and confirm with verify_grant (network-layer enforcement is roadmap)",
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
        "Consumes a single-use grant token for a target. Returns valid:false on reuse, expiry, or target mismatch. "
        + "NOTE: today this verifies consent bookkeeping; scanning commands are expected to embed SENTINEL_GRANT but nothing network-level forces them to yet (see policy_get residual risks).",
      inputSchema: {
        token: z.string().describe("The SENTINEL_GRANT value returned by request_intrusive_approval"),
        target: z.string().describe("The exact target the grant was issued for"),
      },
      annotations: { readOnlyHint: false },
    },
    ({ token, target }) => {
      const result = consumeGrant(token, target);
      audit.append({
        actor: "agent",
        action: "grant_verify",
        args: { target, token: `${token.slice(0, 8)}…` },
        verdict: result.valid ? "allowed" : "denied",
        reason: result.reason,
      });
      return text(result);
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
    () => text({ allow: scope.list(), file: scope.file }),
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
          "public-scoped hostnames are DNS-resolved at check time; resolution into private/link-local space is denied as a rebinding attempt",
          "residual risk: the target may re-resolve between scope_check and the actual connection - check-time resolution narrows but does not eliminate rebinding; an egress proxy is the complete fix (roadmap)",
          "cloud metadata endpoints (169.254.169.254, metadata.google.internal) are hard-denied, including by DNS resolution",
          "link-local space is hard-denied, including CIDR entries that overlap it",
          "intrusive actions: the TrueForge harness pauses request_intrusive_approval for a human Allow/Deny BEFORE it executes; the guard then mints a single-use 10-minute grant token",
          "trust boundary: set GUARD_TOKEN here + header auth on the harness connector so ONLY the harness can call this server; REQUIRE_GUARD_TOKEN=1 fails closed when that invariant cannot be verified",
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
