// ─────────────────────────────────────────────
//  src/http-server.ts  –  HTTP entry point for Docker / self-hosted
//  Runs the MCP Streamable HTTP transport over plain Node.js http
// ─────────────────────────────────────────────
import * as http from "http";
import * as dotenv from "dotenv";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server";

dotenv.config();

// ── Config ────────────────────────────────────────────────────────
const PORT            = parseInt(process.env.PORT          ?? "3000",  10);
const API_KEY         = process.env.MCP_API_KEY?.trim()    ?? "";
const MAX_BODY_BYTES  = parseInt(process.env.MAX_BODY_BYTES ?? String(1 * 1024 * 1024), 10); // 1 MB
const REQ_TIMEOUT_MS  = parseInt(process.env.REQ_TIMEOUT_MS ?? "55000", 10);                 // 55 s
const RATE_LIMIT_RPM  = parseInt(process.env.RATE_LIMIT_RPM ?? "60",    10);                 // per IP

// ── Structured logger ─────────────────────────────────────────────
function log(level: "INFO" | "WARN" | "ERROR", msg: string, extra?: Record<string, unknown>): void {
  const entry = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra });
  (level === "ERROR" ? process.stderr : process.stdout).write(entry + "\n");
}

// ── Per-IP rate limiter (sliding window, in-memory) ───────────────
interface RateBucket { count: number; windowStart: number; }
const rateBuckets = new Map<string, RateBucket>();
const WINDOW_MS = 60_000;

// Prune stale buckets every 5 minutes to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of rateBuckets) {
    if (now - b.windowStart > WINDOW_MS) rateBuckets.delete(ip);
  }
}, 5 * 60_000).unref();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    rateBuckets.set(ip, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_RPM;
}

function getClientIP(req: http.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (raw?.split(",")[0]?.trim()) ?? req.socket.remoteAddress ?? "unknown";
}

// ── Security ──────────────────────────────────────────────────────
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAuthorized(req: http.IncomingMessage): boolean {
  if (!API_KEY) return false;
  const header = (req.headers["authorization"] ?? "") as string;
  if (!header.startsWith("Bearer ")) return false;
  return safeCompare(header.slice(7), API_KEY);
}

// ── Helpers ───────────────────────────────────────────────────────
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options":  "nosniff",
  "X-Frame-Options":         "DENY",
  "X-XSS-Protection":        "1; mode=block",
  "Referrer-Policy":         "no-referrer",
  "Content-Security-Policy": "default-src 'none'",
};

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, mcp-session-id, Accept, Authorization",
  "Access-Control-Max-Age":       "86400",
};

function applyHeaders(res: http.ServerResponse): void {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  for (const [k, v] of Object.entries(CORS_HEADERS))     res.setHeader(k, v);
}

function sendJSON(res: http.ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type":   "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;

    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        req.destroy(new Error("PAYLOAD_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) { resolve(undefined); return; }
      try { resolve(JSON.parse(raw)); } catch { resolve(undefined); }
    });

    req.on("error", reject);
  });
}

// ── Request handler ───────────────────────────────────────────────
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const start  = Date.now();
  const ip     = getClientIP(req);
  const method = req.method ?? "?";
  const url    = req.url    ?? "/";

  applyHeaders(res);

  // Per-IP rate limit (applied to all endpoints except health)
  if (url !== "/health" && isRateLimited(ip)) {
    res.setHeader("Retry-After", "60");
    sendJSON(res, 429, { error: "Too Many Requests", message: "Rate limit: 60 req/min per IP" });
    log("WARN", "rate_limited", { ip, method, url });
    return;
  }

  // ── Route: health check ──────────────────────────────────────
  if (method === "GET" && url === "/health") {
    sendJSON(res, 200, { status: "ok", service: "keywords-mcp", uptime: process.uptime() });
    return;
  }

  // ── Route: info ──────────────────────────────────────────────
  if (method === "GET" && (url === "/" || url === "/api/info")) {
    sendJSON(res, 200, {
      name: "Keywords MCP",
      version: "1.0.0",
      mcpEndpoint: "/api/mcp",
      transport: "Streamable HTTP (stateless)",
      auth: "Authorization: Bearer <MCP_API_KEY>",
    });
    return;
  }

  // ── Route: CORS preflight ────────────────────────────────────
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── Route: MCP endpoint ──────────────────────────────────────
  if (url === "/api/mcp") {
    if (method !== "POST") {
      sendJSON(res, 405, { error: "Method Not Allowed", message: "Use POST /api/mcp" });
      return;
    }

    if (!isAuthorized(req)) {
      sendJSON(res, 401, {
        error: "Unauthorized",
        message: "Required: Authorization: Bearer <MCP_API_KEY>",
      });
      log("WARN", "unauthorized", { ip, method, url });
      return;
    }

    // Request timeout watchdog
    const timeout = setTimeout(() => {
      if (!res.writableEnded) {
        sendJSON(res, 504, { error: "Gateway Timeout", message: "Request exceeded time limit" });
        log("WARN", "request_timeout", { ip, url, ms: Date.now() - start });
      }
    }, REQ_TIMEOUT_MS);

    let body: unknown;
    try {
      body = await parseBody(req);
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "PAYLOAD_TOO_LARGE") {
        sendJSON(res, 413, { error: "Payload Too Large", message: `Body exceeds ${MAX_BODY_BYTES} bytes` });
      } else {
        sendJSON(res, 400, { error: "Bad Request", message: "Could not read request body" });
      }
      log("WARN", "body_parse_error", { ip, msg });
      return;
    }

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcpServer = createServer();

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      clearTimeout(timeout);
      if (!res.writableEnded) {
        sendJSON(res, 500, { error: "Internal Server Error" });
      }
      log("ERROR", "mcp_handler_error", { ip, err: String(err) });
      return;
    } finally {
      clearTimeout(timeout);
      res.on("finish", () => {
        void transport.close();
        void mcpServer.close();
        log("INFO", "request", { ip, method, url, status: res.statusCode, ms: Date.now() - start });
      });
    }
    return;
  }

  sendJSON(res, 404, { error: "Not Found" });
  log("INFO", "request", { ip, method, url, status: 404, ms: Date.now() - start });
}

// ── HTTP server ───────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err: unknown) => {
    if (!res.writableEnded) sendJSON(res, 500, { error: "Internal Server Error" });
    log("ERROR", "unhandled_request_error", { err: String(err) });
  });
});

server.keepAliveTimeout = 65_000; // slightly above common load-balancer 60 s
server.headersTimeout   = 66_000;

server.on("error", (err: NodeJS.ErrnoException) => {
  log("ERROR", "server_error", { code: err.code, msg: err.message });
  process.exit(1);
});

// ── Graceful shutdown ─────────────────────────────────────────────
let isShuttingDown = false;

function gracefulShutdown(signal: string): void {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log("INFO", "shutdown_started", { signal });

  server.close((err) => {
    if (err) log("ERROR", "shutdown_error", { err: String(err) });
    else     log("INFO",  "shutdown_complete", {});
    process.exit(err ? 1 : 0);
  });

  // Force-kill after 10 s if connections are still open
  setTimeout(() => {
    log("WARN", "shutdown_forced", {});
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));

// ── Safety nets ───────────────────────────────────────────────────
process.on("uncaughtException", (err: Error) => {
  log("ERROR", "uncaught_exception", { err: err.message, stack: err.stack });
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason: unknown) => {
  log("ERROR", "unhandled_rejection", { reason: String(reason) });
  // Don't exit — rejections can be transient per-request errors
});

// ── Start ─────────────────────────────────────────────────────────
server.listen(PORT, () => {
  log("INFO", "server_started", { port: PORT, pid: process.pid });
  log("INFO", "mcp_endpoint",   { url: `http://localhost:${PORT}/api/mcp` });
  if (!API_KEY) log("WARN", "no_api_key", { msg: "MCP_API_KEY not set — all requests will be rejected" });
});
