#!/usr/bin/env node
/**
 * Sentinel Console server — serves the UI and proxies /api/* to the harness.
 * Same-origin => no CORS pain. No dependencies.
 *
 *   node console/serve.mjs          # UI on http://localhost:8792
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 8792);
const HARNESS = process.env.HARNESS ?? "http://localhost:8790";
const ROOT = join(dirname(fileURLToPath(import.meta.url)));
const GUARD = process.env.GUARD ?? "http://127.0.0.1:9930";
// Console access token. When set, every request must present it as a
// `sentineltok` cookie (set via /login) or `Authorization: Bearer` header;
// the same GUARD_TOKEN is injected upstream to the scope-guard.
const CONSOLE_TOKEN = process.env.CONSOLE_TOKEN ?? "";
const GUARD_TOKEN = process.env.GUARD_TOKEN ?? "";

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function consoleAuthed(req) {
  if (!CONSOLE_TOKEN) return true;
  if (parseCookies(req)["sentineltok"] === CONSOLE_TOKEN) return true;
  return req.headers["authorization"] === `Bearer ${CONSOLE_TOKEN}`;
}
const LOGIN_PAGE = `<!doctype html><html><body style="font-family:sans-serif;background:#0d1117;color:#e6edf3;display:flex;height:100vh;align-items:center;justify-content:center">
<form method="GET" action="/login" style="background:#161b22;padding:28px;border-radius:12px;border:1px solid #30363d">
<h2>Sentinel Console</h2><p style="color:#8b949e">access token required</p>
<input name="token" type="password" placeholder="access token" style="display:block;width:260px;padding:8px;margin:10px 0;border-radius:7px;border:1px solid #30363d;background:#0d1117;color:#e6edf3">
<button style="width:100%;padding:8px;background:#58a6ff;border:none;border-radius:7px;font-weight:600">Enter</button>
</form></body></html>`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ---- console login ----
  if (url.pathname === "/login") {
    if (!CONSOLE_TOKEN || url.searchParams.get("token") === CONSOLE_TOKEN) {
      res.writeHead(302, {
        "set-cookie": `sentineltok=${encodeURIComponent(url.searchParams.get("token") ?? CONSOLE_TOKEN)}; HttpOnly; SameSite=Strict; Path=/`,
        location: "/",
      });
      res.end();
    } else {
      res.writeHead(401, { "content-type": "text/html" }).end(LOGIN_PAGE.replace("type=\"password\"","type=\"password\" value=\"\"\""));
    }
    return;
  }

  // ---- console access gate ----
  if (!consoleAuthed(req)) {
    if (req.method === "GET" && !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/guard/")) {
      res.writeHead(401, { "content-type": "text/html" }).end(LOGIN_PAGE);
    } else {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorized - open /login?token=<your-token>" }));
    }
    return;
  }

  // ---- proxy /api/* -> harness ----
  if (url.pathname.startsWith("/api/")) {
    const target = HARNESS + url.pathname.replace(/^\/api/, "") + url.search;
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const upstream = await fetch(target, {
        method: req.method,
        headers: { "content-type": req.headers["content-type"] ?? "application/json", accept: req.headers.accept ?? "*/*" },
        body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
      });
      res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (err) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err?.message ?? err) }));
    }
    return;
  }

  // ---- proxy /guard/mcp -> scope-guard JSON-RPC ----
  if (url.pathname === "/guard/mcp" && req.method === "POST") {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const fwdHeaders = {
        "content-type": req.headers["content-type"] ?? "application/json",
        accept: req.headers.accept ?? "*/*",
      };
      if (req.headers["authorization"]) fwdHeaders["authorization"] = String(req.headers["authorization"]);
      else if (GUARD_TOKEN && consoleAuthed(req)) fwdHeaders["authorization"] = `Bearer ${GUARD_TOKEN}`;
      const upstream = await fetch(GUARD + "/mcp", {
        method: "POST",
        headers: fwdHeaders,
        body: Buffer.concat(chunks),
      });
      const ct = upstream.headers.get("content-type") ?? "application/json";
      const text = await upstream.text();
      // unwrap SSE envelope if the guard answered event-stream
      if (ct.includes("text/event-stream")) {
        const line = text.split("\n").find((l) => l.startsWith("data:"));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(line ? line.slice(5) : "{}");
      } else {
        res.writeHead(upstream.status, { "content-type": ct });
        res.end(text);
      }
    } catch (err) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err?.message ?? err) }));
    }
    return;
  }

  // ---- static ----
  let path = url.pathname === "/" ? "/index.html" : url.pathname;
  try {
    const data = await readFile(join(ROOT, path));
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(data);
  } catch (err) {
    console.error("[static]", path, err.message);
    res.writeHead(404);
    res.end("not found");
  }
});

process.on("uncaughtException", (err) => {
  console.error("[sentinel-console] uncaught:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("[sentinel-console] unhandled rejection:", err);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[sentinel-console] http://localhost:${PORT}  (harness ${HARNESS}, guard ${GUARD})`);
});
