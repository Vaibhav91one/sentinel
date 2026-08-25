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

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

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
      const upstream = await fetch(GUARD + "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
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

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[sentinel-console] http://localhost:${PORT}  (harness ${HARNESS}, guard ${GUARD})`);
});
